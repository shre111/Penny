import { Router } from 'express'
import { Invoice } from '../models/Invoice.js'
import { Client } from '../models/Client.js'
import { requireUserOrService } from '../auth/middleware.js'

export const metricsRouter = Router()
metricsRouter.use(requireUserOrService)

// Round summed money to whole cents so float drift doesn't surface long tails
// in the KPI cards or the agent's get_business_metrics.
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// SMB datasets are small; computing in JS keeps balance/overdue logic in one
// place (the Invoice virtuals) instead of duplicating it in aggregations.
async function loadInvoices(userId) {
  const invoices = await Invoice.find({ userId }).populate('clientId', 'name email')
  return invoices.map((i) => i.toObject({ virtuals: true }))
}

/**
 * Payment personalities: how late does each client actually pay?
 * avgDaysLate = mean(final payment date − due date) over their paid invoices.
 * Needs ≥2 paid invoices before we claim to know someone's habits.
 */
export async function paymentBehavior(userId) {
  const paid = await Invoice.find({ userId, status: 'paid' }).lean()
  const samples = {}
  for (const inv of paid) {
    const last = inv.payments?.length ? inv.payments[inv.payments.length - 1].date : null
    if (!last || !inv.dueDate) continue
    const days = Math.round((new Date(last) - new Date(inv.dueDate)) / 86400000)
    const key = String(inv.clientId)
    ;(samples[key] ||= []).push(days)
  }
  const behavior = {}
  for (const [clientId, days] of Object.entries(samples)) {
    const avg = Math.round(days.reduce((s, d) => s + d, 0) / days.length)
    let label = null
    if (days.length >= 2) {
      if (avg <= 0) label = 'pays on time'
      else if (avg <= 7) label = 'usually a few days late'
      else label = `usually ~${avg} days late`
    }
    behavior[clientId] = { paidCount: days.length, avgDaysLate: avg, label }
  }
  return behavior
}

metricsRouter.get('/summary', async (req, res) => {
  const invoices = await loadInvoices(req.userId)
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const open = invoices.filter((i) => i.status === 'sent' && i.balance > 0)
  const overdue = open.filter((i) => i.effectiveStatus === 'overdue')
  // Skip voided invoices — a cancelled invoice's past payment isn't revenue, and
  // the /charts cashflow already excludes void; the two must report the same money.
  const collectedThisMonth = invoices
    .filter((i) => i.status !== 'void')
    .flatMap((i) => i.payments || [])
    .filter((p) => new Date(p.date) >= monthStart)
    .reduce((s, p) => s + p.amount, 0)

  res.json({
    summary: {
      outstandingTotal: round2(open.reduce((s, i) => s + i.balance, 0)),
      outstandingCount: open.length,
      overdueTotal: round2(overdue.reduce((s, i) => s + i.balance, 0)),
      overdueCount: overdue.length,
      collectedThisMonth: round2(collectedThisMonth),
      invoiceCount: invoices.length,
      clientCount: await Client.countDocuments({ userId: req.userId }),
    },
  })
})

metricsRouter.get('/charts', async (req, res) => {
  const invoices = await loadInvoices(req.userId)
  const now = new Date()

  // A/R aging buckets over unpaid 'sent' invoices
  const buckets = [
    { name: 'Not due yet', min: -Infinity, max: 0 },
    { name: '1–30 days late', min: 1, max: 30 },
    { name: '31–60 days late', min: 31, max: 60 },
    { name: '60+ days late', min: 61, max: Infinity },
  ]
  const aging = buckets.map((b) => ({ name: b.name, value: 0 }))
  for (const inv of invoices) {
    if (inv.status !== 'sent' || inv.balance <= 0) continue
    const daysLate = Math.floor((now - new Date(inv.dueDate)) / 86400000)
    const idx = buckets.findIndex((b) => daysLate >= b.min && daysLate <= b.max)
    if (idx >= 0) aging[idx].value += inv.balance
  }

  // Money in vs billed, last 6 calendar months
  const months = []
  for (let m = 5; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1)
    months.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      name: d.toLocaleString('en-US', { month: 'short' }),
      billed: 0,
      collected: 0,
    })
  }
  const monthOf = (date) => {
    const d = new Date(date)
    return `${d.getFullYear()}-${d.getMonth()}`
  }
  for (const inv of invoices) {
    // Skip void (cancelled) and draft (never sent to the client) — a draft isn't
    // billed money, matching how /summary, aging and the retainer insight all
    // treat drafts as not-yet-billed.
    if (inv.status === 'void' || inv.status === 'draft') continue
    const mk = monthOf(inv.issueDate)
    const slot = months.find((m) => m.key === mk)
    if (slot) slot.billed += inv.amount
    for (const p of inv.payments || []) {
      const pk = monthOf(p.date)
      const pslot = months.find((m) => m.key === pk)
      if (pslot) pslot.collected += p.amount
    }
  }

  res.json({ aging, cashflow: months.map(({ key, ...rest }) => rest) })
})

/**
 * The crystal ball: when is money actually going to arrive?
 * Expected payment date = due date shifted by the client's payment personality;
 * already-slipped invoices are assumed to land a few days out.
 */
metricsRouter.get('/forecast', async (req, res) => {
  const HORIZON_DAYS = 56 // 8 weeks
  const invoices = await loadInvoices(req.userId)
  const behavior = await paymentBehavior(req.userId)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const expectedPayments = []
  for (const inv of invoices) {
    if (inv.status !== 'sent' || inv.balance <= 0) continue
    const clientKey = String(inv.clientId?._id || inv.clientId)
    const b = behavior[clientKey]
    // Only shift by a client's habit once it's confident (>=2 paid invoices → a
    // label is set). With fewer samples, assume on-time so the shift matches the
    // "no payment history yet — assuming on time" basis instead of contradicting it.
    const shiftDays = b?.label ? Math.max(0, b.avgDaysLate) : 0
    let expected = new Date(new Date(inv.dueDate).getTime() + shiftDays * 86400000)
    let basis = b?.label ? `${inv.clientId?.name} ${b.label}` : 'no payment history yet — assuming on time'
    // a client's own promise (made to the concierge) beats any inference
    if (inv.promisedDate) {
      const promised = new Date(inv.promisedDate)
      if (promised >= startOfToday) {
        expected = promised
        basis = 'the client promised this date'
      } else {
        expected = new Date(startOfToday.getTime() + 3 * 86400000)
        basis = 'promised date slipped — worth a follow-up'
      }
    } else if (expected < new Date(startOfToday.getTime() + 2 * 86400000)) {
      // overdue or imminent-but-slipping: assume it lands a few days from now
      expected = new Date(startOfToday.getTime() + 3 * 86400000)
    }
    expectedPayments.push({
      invoiceId: inv._id,
      number: inv.number,
      client: inv.clientId?.name || '—',
      amount: inv.balance,
      dueDate: inv.dueDate,
      expectedDate: expected,
      basis,
      promised: Boolean(inv.promisedDate),
      overdue: inv.effectiveStatus === 'overdue',
    })
  }
  expectedPayments.sort((a, b) => a.expectedDate - b.expectedDate)

  const weeks = []
  for (let w = 0; w < HORIZON_DAYS / 7; w++) {
    const start = new Date(startOfToday.getTime() + w * 7 * 86400000)
    const end = new Date(start.getTime() + 7 * 86400000)
    const expected = expectedPayments
      .filter((p) => p.expectedDate >= start && p.expectedDate < end)
      .reduce((s, p) => s + p.amount, 0)
    weeks.push({
      name: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      expected: Math.round(expected),
    })
  }
  const horizonEnd = new Date(startOfToday.getTime() + HORIZON_DAYS * 86400000)
  const within = expectedPayments.filter((p) => p.expectedDate < horizonEnd)

  res.json({
    forecast: {
      weeks,
      totalExpected: Math.round(within.reduce((s, p) => s + p.amount, 0)),
      expectedPayments: within.slice(0, 8),
      beyond: expectedPayments.length - within.length,
    },
  })
})

/**
 * The guardian: things a sharp bookkeeper would tap you on the shoulder about.
 * Pure heuristics over the user's own books — explainable, no model calls.
 */
metricsRouter.get('/insights', async (req, res) => {
  const invoices = await loadInvoices(req.userId)
  const now = new Date()
  const insights = []

  // 1) possible duplicates: same client + amount, both still unpaid, issued close together
  const open = invoices.filter((i) => i.status === 'sent' && i.balance > 0)
  for (let a = 0; a < open.length; a++) {
    for (let b = a + 1; b < open.length; b++) {
      const x = open[a]
      const y = open[b]
      if (
        String(x.clientId?._id) === String(y.clientId?._id) &&
        x.amount === y.amount &&
        Math.abs(new Date(x.issueDate) - new Date(y.issueDate)) < 30 * 86400000
      ) {
        insights.push({
          type: 'duplicate',
          message: `${x.number} and ${y.number} to ${x.clientId?.name} are both $${x.amount.toLocaleString('en-US')} — possible duplicate?`,
          invoices: [x.number, y.number],
        })
      }
    }
  }

  // 2) retainer gap: a client you bill on retainer, but nothing recent
  const byClient = {}
  for (const inv of invoices) {
    const key = String(inv.clientId?._id || inv.clientId)
    ;(byClient[key] ||= []).push(inv)
  }
  for (const list of Object.values(byClient)) {
    const retainers = list.filter((i) => /retainer/i.test((i.lineItems || []).map((li) => li.description).join(' ') + ' ' + (i.notes || '')))
    if (retainers.length === 0) continue
    // drafts don't count — they were never sent to the client
    const billed = list.filter((i) => i.status !== 'draft')
    if (billed.length === 0) continue
    const lastIssue = Math.max(...billed.map((i) => new Date(i.issueDate).getTime()))
    const daysSince = Math.floor((now - lastIssue) / 86400000)
    if (daysSince > 35) {
      const client = list[0].clientId?.name
      insights.push({
        type: 'retainer-gap',
        message: `You bill ${client} on retainer, but nothing has gone out in ${daysSince} days — forgot this month's invoice?`,
        client,
      })
    }
  }

  // 3) broken promises: the client said a date, the date passed, still unpaid
  for (const inv of open) {
    if (inv.promisedDate && new Date(inv.promisedDate) < now) {
      insights.push({
        type: 'broken-promise',
        message: `${inv.clientId?.name} promised to pay ${inv.number} by ${new Date(inv.promisedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — that's passed and it's still open.`,
        invoices: [inv.number],
      })
    }
  }

  res.json({ insights: insights.slice(0, 5) })
})

// Powers Penny's proactive opening message
metricsRouter.get('/briefing', async (req, res) => {
  const invoices = await loadInvoices(req.userId)
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 86400000)

  const overdue = invoices.filter((i) => i.effectiveStatus === 'overdue')
  const newlyOverdue = overdue.filter((i) => new Date(i.dueDate) >= weekAgo)
  const dueSoon = invoices.filter(
    (i) =>
      i.status === 'sent' &&
      i.balance > 0 &&
      new Date(i.dueDate) >= now &&
      new Date(i.dueDate) <= new Date(now.getTime() + 7 * 86400000)
  )
  const recentPayments = invoices
    .flatMap((i) => (i.payments || []).map((p) => ({ ...p, client: i.clientId?.name, number: i.number })))
    .filter((p) => new Date(p.date) >= weekAgo)

  res.json({
    briefing: {
      overdueCount: overdue.length,
      overdueTotal: overdue.reduce((s, i) => s + i.balance, 0),
      newlyOverdueCount: newlyOverdue.length,
      newlyOverdueTotal: newlyOverdue.reduce((s, i) => s + i.balance, 0),
      dueSoonCount: dueSoon.length,
      dueSoonTotal: dueSoon.reduce((s, i) => s + i.balance, 0),
      paymentsReceivedCount: recentPayments.length,
      paymentsReceivedTotal: recentPayments.reduce((s, p) => s + p.amount, 0),
      overdueInvoices: overdue.slice(0, 5).map((i) => ({
        id: i._id,
        number: i.number,
        client: i.clientId?.name,
        balance: i.balance,
        daysOverdue: i.daysOverdue,
      })),
    },
  })
})

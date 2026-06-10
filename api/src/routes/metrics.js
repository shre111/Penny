import { Router } from 'express'
import { Invoice } from '../models/Invoice.js'
import { Client } from '../models/Client.js'
import { requireUserOrService } from '../auth/middleware.js'

export const metricsRouter = Router()
metricsRouter.use(requireUserOrService)

// SMB datasets are small; computing in JS keeps balance/overdue logic in one
// place (the Invoice virtuals) instead of duplicating it in aggregations.
async function loadInvoices(userId) {
  const invoices = await Invoice.find({ userId }).populate('clientId', 'name email')
  return invoices.map((i) => i.toObject({ virtuals: true }))
}

metricsRouter.get('/summary', async (req, res) => {
  const invoices = await loadInvoices(req.userId)
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const open = invoices.filter((i) => i.status === 'sent' && i.balance > 0)
  const overdue = open.filter((i) => i.effectiveStatus === 'overdue')
  const collectedThisMonth = invoices
    .flatMap((i) => i.payments || [])
    .filter((p) => new Date(p.date) >= monthStart)
    .reduce((s, p) => s + p.amount, 0)

  res.json({
    summary: {
      outstandingTotal: open.reduce((s, i) => s + i.balance, 0),
      outstandingCount: open.length,
      overdueTotal: overdue.reduce((s, i) => s + i.balance, 0),
      overdueCount: overdue.length,
      collectedThisMonth,
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
    if (inv.status === 'void') continue
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

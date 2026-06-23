import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { Invoice } from '../models/Invoice.js'
import { User } from '../models/User.js'
import { renderInvoicePdf } from './invoicePdf.js'
import { config } from '../config.js'
import { isLockedOut, recordFailure, clearFailures } from '../rateLimit.js'

/**
 * The public face of an invoice — no login, the share token IS the auth.
 * Exposes only what the billed client should see, plus a chat with Penny's
 * client-concierge persona (strictly scoped to this one invoice).
 */
export const publicRouter = Router()

// gentle in-memory rate limit per token: the page is public, the LLM is not free
const buckets = new Map()
function allow(token, limit = 30, windowMs = 60 * 60 * 1000) {
  const now = Date.now()
  const b = buckets.get(token) || { count: 0, resetAt: now + windowMs }
  if (now > b.resetAt) {
    b.count = 0
    b.resetAt = now + windowMs
  }
  b.count += 1
  buckets.set(token, b)
  return b.count <= limit
}

async function loadByToken(token) {
  if (!token || token.length < 10) return null
  const invoice = await Invoice.findOne({ shareToken: token }).populate('clientId', 'name contactName')
  if (!invoice) return null
  const owner = await User.findById(invoice.userId)
  return { invoice, owner }
}

/**
 * If the invoice link is PIN-protected, require a matching PIN (sent as the
 * `x-invoice-pin` header or `?pin=` / body `pin`). Returns null when access is
 * allowed, or a { status, body } to send back. Wrong attempts are throttled per
 * token (5 / 15 min) so a short numeric PIN can't be brute-forced.
 */
async function pinGate(invoice, token, provided) {
  if (!invoice.sharePinHash) return null
  const key = `pin:${token}`
  if (isLockedOut(key)) {
    return { status: 429, body: { pinRequired: true, error: 'Too many incorrect PINs — please wait a few minutes.' } }
  }
  if (provided && (await bcrypt.compare(String(provided), invoice.sharePinHash))) {
    clearFailures(key)
    return null
  }
  if (provided) recordFailure(key) // only count actual wrong guesses, not the first prompt
  return { status: 401, body: { pinRequired: true, error: provided ? 'That PIN is not correct' : undefined } }
}

const readPin = (req) => req.get('x-invoice-pin') || req.query.pin || (req.body && req.body.pin)

function publicView(invoice, owner) {
  const inv = invoice.toObject({ virtuals: true })
  return {
    number: inv.number,
    businessName: owner?.businessName || owner?.name || 'the business',
    clientName: inv.clientId?.name || 'Customer',
    lineItems: inv.lineItems || [],
    amount: inv.amount,
    amountPaid: inv.amountPaid,
    balance: inv.balance,
    currency: inv.currency,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    status: inv.effectiveStatus,
    promisedDate: inv.promisedDate || null,
    installmentPlan: inv.installmentPlan || null,
    notes: inv.notes,
    conciergeEnabled: owner?.concierge?.enabled ?? true,
  }
}

publicRouter.get('/invoice/:token', async (req, res) => {
  const found = await loadByToken(req.params.token)
  if (!found) return res.status(404).json({ error: 'This invoice link is not valid' })
  const gate = await pinGate(found.invoice, req.params.token, readPin(req))
  if (gate) return res.status(gate.status).json(gate.body)
  res.json({ invoice: publicView(found.invoice, found.owner) })
})

publicRouter.get('/invoice/:token/pdf', async (req, res) => {
  const found = await loadByToken(req.params.token)
  if (!found) return res.status(404).json({ error: 'This invoice link is not valid' })
  const gate = await pinGate(found.invoice, req.params.token, readPin(req))
  if (gate) return res.status(gate.status).json(gate.body)
  renderInvoicePdf(found.invoice, found.owner, res)
})

// The client talks to Penny about this invoice — SSE relay to the concierge agent
publicRouter.post('/invoice/:token/chat', async (req, res) => {
  const { content, visitorId } = req.body || {}
  if (!content?.trim()) return res.status(400).json({ error: 'Say something first' })
  const found = await loadByToken(req.params.token)
  if (!found) return res.status(404).json({ error: 'This invoice link is not valid' })
  const { invoice, owner } = found
  const gate = await pinGate(invoice, req.params.token, readPin(req))
  if (gate) return res.status(gate.status).json(gate.body)
  if (!(owner?.concierge?.enabled ?? true)) {
    return res.status(403).json({ error: 'Chat is not available on this invoice' })
  }
  if (!allow(req.params.token)) {
    return res.status(429).json({ error: 'This conversation is taking a break — please try again in a little while' })
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const abort = new AbortController()
  req.on('close', () => abort.abort())

  const inv = invoice.toObject({ virtuals: true })
  try {
    const upstream = await fetch(`${config.aiUrl}/concierge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Token': config.serviceToken },
      body: JSON.stringify({
        thread_id: `concierge:${invoice._id}:${String(visitorId || 'anon').slice(0, 40)}`,
        user_id: String(invoice.userId),
        content: content.trim().slice(0, 1500),
        invoice: {
          id: String(invoice._id),
          number: inv.number,
          client_name: inv.clientId?.name || 'Customer',
          line_items: inv.lineItems,
          amount: inv.amount,
          balance: inv.balance,
          currency: inv.currency,
          issue_date: inv.issueDate ? new Date(inv.issueDate).toISOString().slice(0, 10) : '',
          due_date: new Date(inv.dueDate).toISOString().slice(0, 10),
          status: inv.effectiveStatus,
          days_overdue: inv.daysOverdue,
          promised_date: inv.promisedDate ? new Date(inv.promisedDate).toISOString().slice(0, 10) : null,
          notes: inv.notes,
        },
        business_name: owner?.businessName || owner?.name || '',
        owner_name: owner?.name || '',
        share_token: req.params.token,
        guardrails: {
          max_extension_days: owner?.concierge?.maxExtensionDays ?? 14,
          max_installments: owner?.concierge?.maxInstallments ?? 3,
        },
      }),
      signal: abort.signal,
      duplex: 'half',
    })
    if (!upstream.ok || !upstream.body) throw new Error(`AI service ${upstream.status}`)
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(decoder.decode(value, { stream: true }))
    }
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error('[public chat]', err.message)
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Penny stepped away — please try again in a moment.' })}\n\n`)
      res.write(`event: done\ndata: {}\n\n`)
    }
  }
  res.end()
})

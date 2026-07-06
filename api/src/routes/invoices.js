import { Router } from 'express'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Invoice, nextInvoiceNumber } from '../models/Invoice.js'
import { Client } from '../models/Client.js'
import { requireUserOrService } from '../auth/middleware.js'
import { emitChange } from '../realtime.js'
import { escapeRegex } from '../util.js'

export const invoicesRouter = Router()
invoicesRouter.use(requireUserOrService)

function serialize(inv) {
  const o = inv.toObject({ virtuals: true })
  delete o.sharePinHash // never expose the PIN hash, even to the owner's client
  o.sharePinProtected = Boolean(inv.sharePinHash)
  return o
}

// status filter accepts the derived 'overdue' and 'open' (= sent, any balance) pseudo-statuses
invoicesRouter.get('/', async (req, res) => {
  const { status, clientId, limit = 100 } = req.query
  const filter = { userId: req.userId }
  if (clientId) filter.clientId = clientId
  if (status === 'overdue') {
    filter.status = 'sent'
    filter.dueDate = { $lt: new Date() }
  } else if (status === 'open') {
    filter.status = 'sent'
  } else if (status && status !== 'all') {
    filter.status = status
  }
  let invoices = await Invoice.find(filter)
    .sort({ dueDate: 1 })
    .limit(Number(limit))
    .populate('clientId', 'name email contactName')
  invoices = invoices.map(serialize)
  // 'overdue' also requires unpaid balance, which is virtual — final filter in JS
  if (status === 'overdue') invoices = invoices.filter((i) => i.effectiveStatus === 'overdue')
  res.json({ invoices })
})

// Look up a single invoice by its human number (e.g. INV-0042). Direct,
// case-insensitive lookup — avoids fetching and scanning the whole list, and
// works regardless of how many invoices the account has. Declared before
// '/:id' so the literal path wins over the id param.
invoicesRouter.get('/by-number/:number', async (req, res) => {
  const invoice = await Invoice.findOne({ userId: req.userId, number: req.params.number.trim() })
    .collation({ locale: 'en', strength: 2 }) // case-insensitive exact match
    .populate('clientId', 'name email contactName')
  if (!invoice) return res.status(404).json({ error: `No invoice found with number ${req.params.number}` })
  res.json({ invoice: serialize(invoice) })
})

invoicesRouter.get('/:id', async (req, res) => {
  const invoice = await Invoice.findOne({ _id: req.params.id, userId: req.userId }).populate(
    'clientId',
    'name email contactName'
  )
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
  res.json({ invoice: serialize(invoice) })
})

invoicesRouter.post('/', async (req, res) => {
  const { clientId, clientName, lineItems, amount, currency, issueDate, dueDate, status, notes, source } =
    req.body || {}

  // The agent may pass a client name instead of an id; resolve or auto-create.
  let client = null
  if (clientId) {
    client = await Client.findOne({ _id: clientId, userId: req.userId })
    if (!client) return res.status(404).json({ error: 'Client not found' })
  } else if (clientName?.trim()) {
    client = await Client.findOne({ userId: req.userId, name: { $regex: `^${escapeRegex(clientName.trim())}$`, $options: 'i' } })
    if (!client) {
      client = await Client.create({ userId: req.userId, name: clientName.trim() })
      emitChange(req.userId, { entity: 'client', action: 'created', id: client._id, actor: req.actor, doc: client })
    }
  } else {
    return res.status(400).json({ error: 'clientId or clientName is required' })
  }

  const items = Array.isArray(lineItems) ? lineItems : []
  const computed = items.reduce((s, li) => s + (li.quantity ?? 1) * (li.unitPrice ?? 0), 0)
  const finalAmount = amount ?? computed
  if (!finalAmount || finalAmount <= 0) return res.status(400).json({ error: 'Invoice amount must be greater than zero' })
  if (!dueDate) return res.status(400).json({ error: 'A due date is required' })

  const invoice = await Invoice.create({
    userId: req.userId,
    clientId: client._id,
    number: await nextInvoiceNumber(req.userId),
    lineItems: items,
    amount: finalAmount,
    currency: currency || 'USD',
    issueDate: issueDate || new Date(),
    dueDate,
    status: status && ['draft', 'sent'].includes(status) ? status : 'sent',
    notes: notes || '',
    source: source || (req.actor === 'agent' ? 'chat' : 'manual'),
  })
  await invoice.populate('clientId', 'name email contactName')
  emitChange(req.userId, { entity: 'invoice', action: 'created', id: invoice._id, actor: req.actor, doc: serialize(invoice) })
  res.status(201).json({ invoice: serialize(invoice) })
})

invoicesRouter.patch('/:id', async (req, res) => {
  const allowed = ['status', 'dueDate', 'notes', 'amount', 'lineItems', 'lastReminderAt']
  const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)))
  const invoice = await Invoice.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, updates, {
    new: true,
  }).populate('clientId', 'name email contactName')
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
  emitChange(req.userId, { entity: 'invoice', action: 'updated', id: invoice._id, actor: req.actor, doc: serialize(invoice) })
  res.json({ invoice: serialize(invoice) })
})

invoicesRouter.post('/:id/payments', async (req, res) => {
  const { amount, date, method } = req.body || {}
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Payment amount must be greater than zero' })
  const invoice = await Invoice.findOne({ _id: req.params.id, userId: req.userId })
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
  invoice.payments.push({ amount, date: date || new Date(), method: method || 'bank transfer' })
  if (invoice.balance <= 0) invoice.status = 'paid'
  await invoice.save()
  await invoice.populate('clientId', 'name email contactName')
  emitChange(req.userId, { entity: 'invoice', action: 'updated', id: invoice._id, actor: req.actor, doc: serialize(invoice) })
  res.json({ invoice: serialize(invoice) })
})

// Mint (or return) the public share link for the client-facing concierge page.
// Optional `pin` (4–8 digits): set it to require a PIN, '' to remove it.
invoicesRouter.post('/:id/share', async (req, res) => {
  const invoice = await Invoice.findOne({ _id: req.params.id, userId: req.userId })
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' })

  let changed = false
  if (!invoice.shareToken) {
    invoice.shareToken = crypto.randomBytes(18).toString('base64url')
    changed = true
  }

  const { pin } = req.body || {}
  if (typeof pin === 'string') {
    const trimmed = pin.trim()
    if (trimmed === '') {
      if (invoice.sharePinHash) {
        invoice.sharePinHash = undefined
        changed = true
      }
    } else if (!/^\d{4,8}$/.test(trimmed)) {
      return res.status(400).json({ error: 'PIN must be 4 to 8 digits' })
    } else {
      invoice.sharePinHash = await bcrypt.hash(trimmed, 10)
      changed = true
    }
  }

  if (changed) await invoice.save()
  res.json({ url: `/invoice/${invoice.shareToken}`, token: invoice.shareToken, pinProtected: Boolean(invoice.sharePinHash) })
})

// The client's payment promise (recorded by the concierge on their behalf)
invoicesRouter.post('/:id/promise', async (req, res) => {
  const { date, note } = req.body || {}
  if (!date || Number.isNaN(Date.parse(date))) return res.status(400).json({ error: 'A valid date is required' })
  const invoice = await Invoice.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { promisedDate: new Date(date), promiseNote: (note || '').slice(0, 300), promisedAt: new Date() },
    { returnDocument: 'after' }
  ).populate('clientId', 'name email contactName')
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
  emitChange(req.userId, { entity: 'invoice', action: 'updated', id: invoice._id, actor: req.actor, doc: serialize(invoice) })
  res.json({ invoice: serialize(invoice) })
})

invoicesRouter.delete('/:id', async (req, res) => {
  const invoice = await Invoice.findOneAndDelete({ _id: req.params.id, userId: req.userId })
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
  emitChange(req.userId, { entity: 'invoice', action: 'deleted', id: invoice._id, actor: req.actor })
  res.json({ ok: true })
})

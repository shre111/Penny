import { Router } from 'express'
import { Client } from '../models/Client.js'
import { Invoice } from '../models/Invoice.js'
import { requireUserOrService } from '../auth/middleware.js'
import { emitChange } from '../realtime.js'
import { paymentBehavior } from './metrics.js'
import { escapeRegex } from '../util.js'

export const clientsRouter = Router()
clientsRouter.use(requireUserOrService)

clientsRouter.get('/', async (req, res) => {
  const { q } = req.query
  const filter = { userId: req.userId }
  if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' }
  const [clients, behavior] = await Promise.all([
    Client.find(filter).sort({ name: 1 }).lean(),
    paymentBehavior(req.userId),
  ])
  res.json({ clients: clients.map((c) => ({ ...c, behavior: behavior[String(c._id)] || null })) })
})

clientsRouter.post('/', async (req, res) => {
  const { name, contactName, email, phone, notes } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'Client name is required' })
  // Match existing names case-insensitively — invoice creation and CSV import
  // both resolve clients this way, so an exact-case check here would let
  // "acme" slip in beside "Acme" and split one client into two.
  const existing = await Client.findOne({
    userId: req.userId,
    name: { $regex: `^${escapeRegex(name.trim())}$`, $options: 'i' },
  })
  if (existing) return res.status(409).json({ error: `A client named "${name.trim()}" already exists`, client: existing })
  const client = await Client.create({
    userId: req.userId,
    name: name.trim(),
    contactName: contactName || '',
    email: email || '',
    phone: phone || '',
    notes: notes || '',
  })
  emitChange(req.userId, { entity: 'client', action: 'created', id: client._id, actor: req.actor, doc: client })
  res.status(201).json({ client })
})

clientsRouter.patch('/:id', async (req, res) => {
  const allowed = ['name', 'contactName', 'email', 'phone', 'notes']
  const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)))
  const client = await Client.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, updates, { new: true })
  if (!client) return res.status(404).json({ error: 'Client not found' })
  emitChange(req.userId, { entity: 'client', action: 'updated', id: client._id, actor: req.actor, doc: client })
  res.json({ client })
})

clientsRouter.delete('/:id', async (req, res) => {
  const invoiceCount = await Invoice.countDocuments({ userId: req.userId, clientId: req.params.id })
  if (invoiceCount > 0) {
    return res.status(409).json({ error: `This client has ${invoiceCount} invoice(s). Delete or reassign those first.` })
  }
  const client = await Client.findOneAndDelete({ _id: req.params.id, userId: req.userId })
  if (!client) return res.status(404).json({ error: 'Client not found' })
  emitChange(req.userId, { entity: 'client', action: 'deleted', id: client._id, actor: req.actor })
  res.json({ ok: true })
})

import { Router } from 'express'
import { Proposal } from '../models/Proposal.js'
import { Invoice } from '../models/Invoice.js'
import { requireAuth, requireUserOrService } from '../auth/middleware.js'
import { emitChange } from '../realtime.js'

export const proposalsRouter = Router()
proposalsRouter.use(requireUserOrService)

proposalsRouter.get('/', async (req, res) => {
  const filter = { userId: req.userId }
  if (req.query.status) filter.status = req.query.status
  if (req.query.invoiceId) filter.invoiceId = req.query.invoiceId
  const proposals = await Proposal.find(filter)
    .sort({ createdAt: -1 })
    .limit(30)
    .populate('invoiceId', 'number amount dueDate')
    .lean()
  res.json({ proposals })
})

// Created by the concierge agent after negotiating with the client (service auth)
proposalsRouter.post('/', async (req, res) => {
  const { invoiceId, type, details, clientReason } = req.body || {}
  if (!invoiceId || !['extension', 'installments'].includes(type) || !details) {
    return res.status(400).json({ error: 'invoiceId, type and details are required' })
  }
  const invoice = await Invoice.findOne({ _id: invoiceId, userId: req.userId })
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
  // one pending proposal per invoice keeps the owner's queue sane
  const existing = await Proposal.findOne({ userId: req.userId, invoiceId, status: 'pending' })
  if (existing) return res.status(409).json({ error: 'A request for this invoice is already waiting for the owner' })

  const proposal = await Proposal.create({
    userId: req.userId,
    invoiceId,
    type,
    details,
    clientReason: (clientReason || '').slice(0, 400),
  })
  emitChange(req.userId, {
    entity: 'proposal',
    action: 'created',
    id: proposal._id,
    actor: req.actor,
    doc: { ...proposal.toObject(), invoiceNumber: invoice.number },
  })
  res.status(201).json({ proposal })
})

// Owner approves → the arrangement is applied to the books
proposalsRouter.post('/:id/approve', requireAuth, async (req, res) => {
  const proposal = await Proposal.findOne({ _id: req.params.id, userId: req.userId, status: 'pending' })
  if (!proposal) return res.status(409).json({ error: 'This request was already handled' })
  const invoice = await Invoice.findOne({ _id: proposal.invoiceId, userId: req.userId })
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' })

  if (proposal.type === 'extension') {
    invoice.dueDate = new Date(proposal.details.newDueDate)
    invoice.notes = `${invoice.notes ? invoice.notes + ' · ' : ''}Extension agreed via Penny`
  } else {
    const plan = (proposal.details.installments || []).map((i) => ({ amount: i.amount, date: new Date(i.date) }))
    invoice.installmentPlan = plan
    if (plan.length) invoice.dueDate = plan[0].date // next money expected = first installment
    invoice.notes = `${invoice.notes ? invoice.notes + ' · ' : ''}Installment plan agreed via Penny`
  }
  await invoice.save()
  await invoice.populate('clientId', 'name email contactName')

  proposal.status = 'approved'
  proposal.decidedAt = new Date()
  await proposal.save()

  emitChange(req.userId, { entity: 'invoice', action: 'updated', id: invoice._id, actor: 'user', doc: invoice.toObject({ virtuals: true }) })
  emitChange(req.userId, { entity: 'proposal', action: 'updated', id: proposal._id, actor: 'user', doc: { ...proposal.toObject(), invoiceNumber: invoice.number } })
  res.json({ proposal })
})

proposalsRouter.post('/:id/decline', requireAuth, async (req, res) => {
  const proposal = await Proposal.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId, status: 'pending' },
    { status: 'declined', decidedAt: new Date() },
    { returnDocument: 'after' }
  ).populate('invoiceId', 'number')
  if (!proposal) return res.status(409).json({ error: 'This request was already handled' })
  emitChange(req.userId, {
    entity: 'proposal',
    action: 'updated',
    id: proposal._id,
    actor: 'user',
    doc: { ...proposal.toObject(), invoiceNumber: proposal.invoiceId?.number },
  })
  res.json({ proposal })
})

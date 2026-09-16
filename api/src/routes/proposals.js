import { Router } from 'express'
import { Proposal } from '../models/Proposal.js'
import { Invoice } from '../models/Invoice.js'
import { requireAuth, requireUserOrService } from '../auth/middleware.js'
import { emitChange } from '../realtime.js'
import { isObjectId } from '../util.js'

export const proposalsRouter = Router()
proposalsRouter.use(requireUserOrService)

const PROPOSAL_STATUSES = ['pending', 'approved', 'declined']

proposalsRouter.get('/', async (req, res) => {
  const { status, invoiceId } = req.query
  if (status !== undefined && !PROPOSAL_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${PROPOSAL_STATUSES.join(', ')}` })
  }
  if (invoiceId !== undefined && !isObjectId(invoiceId)) {
    return res.status(400).json({ error: 'invoiceId is not a valid id' })
  }
  const filter = { userId: req.userId }
  if (status) filter.status = status
  if (invoiceId) filter.invoiceId = invoiceId
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
  // Atomically claim the proposal so two concurrent approvals can't both apply
  // the arrangement (and double the activity/broadcast). Loser gets null → 409.
  const proposal = await Proposal.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId, status: 'pending' },
    { status: 'approved', decidedAt: new Date() },
    { new: true }
  )
  if (!proposal) return res.status(409).json({ error: 'This request was already handled' })
  // Put the proposal back in the owner's queue when the approval can't actually
  // be carried out — otherwise it reads 'approved' with nothing applied, and
  // can't be retried because it's no longer 'pending'. Same helper shape as the
  // undo route in activities.js.
  const revertClaim = async () => {
    proposal.status = 'pending'
    proposal.decidedAt = undefined
    await proposal.save().catch(() => {})
  }

  const invoice = await Invoice.findOne({ _id: proposal.invoiceId, userId: req.userId })
  if (!invoice) {
    // invoice vanished between request and approval
    await revertClaim()
    return res.status(404).json({ error: 'Invoice not found' })
  }

  // `details` is a Mixed field. The concierge tool checks its own arguments, but
  // POST /api/proposals stores whatever it is handed, so this is the first place
  // the values are actually validated. An unreadable date would otherwise reach
  // invoice.save() as an Invalid Date and throw.
  if (proposal.type === 'extension') {
    const newDueDate = new Date(proposal.details?.newDueDate)
    if (Number.isNaN(newDueDate.getTime())) {
      await revertClaim()
      return res.status(400).json({ error: "This request's new due date is unreadable — ask your client to send it again" })
    }
    invoice.dueDate = newDueDate
    invoice.notes = `${invoice.notes ? invoice.notes + ' · ' : ''}Extension agreed via Penny`
  } else {
    const plan = (proposal.details?.installments || []).map((i) => ({ amount: Number(i?.amount), date: new Date(i?.date) }))
    const unusable = (i) => !Number.isFinite(i.amount) || i.amount <= 0 || Number.isNaN(i.date.getTime())
    if (!plan.length || plan.some(unusable)) {
      await revertClaim()
      return res.status(400).json({ error: "This payment plan's amounts or dates are unreadable — ask your client to send it again" })
    }
    invoice.installmentPlan = plan
    invoice.dueDate = plan[0].date // next money expected = first installment
    invoice.notes = `${invoice.notes ? invoice.notes + ' · ' : ''}Installment plan agreed via Penny`
  }
  // Anything that still fails while writing the invoice (a schema violation, a
  // dropped connection) must not leave the proposal claimed 'approved' with the
  // books untouched: the owner would read it as settled and have no way to try
  // again, since it is no longer 'pending'. Rethrow so the app's JSON error
  // handler maps it as usual (CastError/ValidationError → 400, else 500).
  try {
    await invoice.save()
  } catch (err) {
    await revertClaim()
    throw err
  }
  await invoice.populate('clientId', 'name email contactName')

  // proposal was already marked 'approved' by the atomic claim above

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

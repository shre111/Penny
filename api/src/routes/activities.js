import { Router } from 'express'
import { Activity } from '../models/Activity.js'
import { Invoice } from '../models/Invoice.js'
import { Client } from '../models/Client.js'
import { requireAuth } from '../auth/middleware.js'
import { emitChange } from '../realtime.js'

export const activitiesRouter = Router()
activitiesRouter.use(requireAuth)

activitiesRouter.get('/', async (req, res) => {
  const filter = { userId: req.userId }
  if (req.query.entityId) filter.entityId = req.query.entityId
  const activities = await Activity.find(filter).sort({ createdAt: -1 }).limit(60).lean()
  res.json({ activities })
})

// Undo an agent-made creation ("what did Penny change while I was out?" → take it back)
activitiesRouter.post('/:id/undo', async (req, res) => {
  // Atomically claim the undo first — a plain find-then-save left the same
  // check-then-act window already fixed on proposals, email approval and
  // chat resume: two concurrent clicks could both pass the undoneAt check
  // before either write landed. If the undo turns out not to be possible
  // (invoice already gone, has a payment, etc.), revert the claim below.
  const activity = await Activity.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId, undo: { $exists: true }, undoneAt: { $exists: false } },
    { $set: { undoneAt: new Date() } },
    { new: true }
  )
  if (!activity) {
    const existing = await Activity.findOne({ _id: req.params.id, userId: req.userId })
    if (!existing || !existing.undo) return res.status(400).json({ error: 'This action cannot be undone' })
    return res.status(409).json({ error: 'Already undone' })
  }
  const revertClaim = async () => {
    activity.undoneAt = undefined
    await activity.save().catch(() => {})
  }

  if (activity.undo.type === 'delete-invoice') {
    // Don't silently destroy money history: if a payment was recorded on this
    // invoice after Penny created it, undoing (deleting) it would lose that too.
    const target = await Invoice.findOne({ _id: activity.entityId, userId: req.userId })
    if (!target) {
      await revertClaim()
      return res.status(404).json({ error: 'That invoice is already gone' })
    }
    if ((target.payments?.length || 0) > 0) {
      await revertClaim()
      return res.status(409).json({ error: "This invoice has a payment recorded on it — undoing would erase that. Delete it manually if you're sure." })
    }
    const invoice = await Invoice.findOneAndDelete({ _id: activity.entityId, userId: req.userId })
    if (!invoice) {
      await revertClaim()
      return res.status(404).json({ error: 'That invoice is already gone' })
    }
    emitChange(req.userId, { entity: 'invoice', action: 'deleted', id: invoice._id, actor: 'user', doc: invoice })
  } else if (activity.undo.type === 'delete-client') {
    const invoiceCount = await Invoice.countDocuments({ userId: req.userId, clientId: activity.entityId })
    if (invoiceCount > 0) {
      await revertClaim()
      return res.status(409).json({ error: `This client now has ${invoiceCount} invoice(s) — remove those first` })
    }
    const client = await Client.findOneAndDelete({ _id: activity.entityId, userId: req.userId })
    if (!client) {
      await revertClaim()
      return res.status(404).json({ error: 'That client is already gone' })
    }
    emitChange(req.userId, { entity: 'client', action: 'deleted', id: client._id, actor: 'user', doc: client })
  }

  res.json({ ok: true })
})

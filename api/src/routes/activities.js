import { Router } from 'express'
import { Activity } from '../models/Activity.js'
import { Invoice } from '../models/Invoice.js'
import { Client } from '../models/Client.js'
import { requireAuth } from '../auth/middleware.js'
import { emitChange } from '../realtime.js'

export const activitiesRouter = Router()
activitiesRouter.use(requireAuth)

activitiesRouter.get('/', async (req, res) => {
  const activities = await Activity.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(60).lean()
  res.json({ activities })
})

// Undo an agent-made creation ("what did Penny change while I was out?" → take it back)
activitiesRouter.post('/:id/undo', async (req, res) => {
  const activity = await Activity.findOne({ _id: req.params.id, userId: req.userId })
  if (!activity || !activity.undo) return res.status(400).json({ error: 'This action cannot be undone' })
  if (activity.undoneAt) return res.status(409).json({ error: 'Already undone' })

  if (activity.undo.type === 'delete-invoice') {
    const invoice = await Invoice.findOneAndDelete({ _id: activity.entityId, userId: req.userId })
    if (!invoice) return res.status(404).json({ error: 'That invoice is already gone' })
    emitChange(req.userId, { entity: 'invoice', action: 'deleted', id: invoice._id, actor: 'user', doc: invoice })
  } else if (activity.undo.type === 'delete-client') {
    const invoiceCount = await Invoice.countDocuments({ userId: req.userId, clientId: activity.entityId })
    if (invoiceCount > 0) {
      return res.status(409).json({ error: `This client now has ${invoiceCount} invoice(s) — remove those first` })
    }
    const client = await Client.findOneAndDelete({ _id: activity.entityId, userId: req.userId })
    if (!client) return res.status(404).json({ error: 'That client is already gone' })
    emitChange(req.userId, { entity: 'client', action: 'deleted', id: client._id, actor: 'user', doc: client })
  }

  activity.undoneAt = new Date()
  await activity.save()
  res.json({ ok: true })
})

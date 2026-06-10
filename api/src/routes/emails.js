import { Router } from 'express'
import { Email } from '../models/Email.js'
import { Invoice } from '../models/Invoice.js'
import { requireUserOrService } from '../auth/middleware.js'
import { emitChange } from '../realtime.js'

export const emailsRouter = Router()
emailsRouter.use(requireUserOrService)

emailsRouter.get('/', async (req, res) => {
  const emails = await Email.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50).lean()
  res.json({ emails })
})

// Recorded by the AI service after a send attempt (real or simulated)
emailsRouter.post('/', async (req, res) => {
  const { to, subject, body, status, provider, invoiceId, clientId, error } = req.body || {}
  if (!to || !subject || !body || !status) {
    return res.status(400).json({ error: 'to, subject, body and status are required' })
  }
  const email = await Email.create({
    userId: req.userId,
    to,
    subject,
    body,
    status,
    provider: provider || 'simulated',
    invoiceId: invoiceId || undefined,
    clientId: clientId || undefined,
    error: error || undefined,
  })
  if (invoiceId && status !== 'failed') {
    await Invoice.findOneAndUpdate({ _id: invoiceId, userId: req.userId }, { lastReminderAt: new Date() })
  }
  emitChange(req.userId, { entity: 'email', action: 'created', id: email._id, actor: req.actor, doc: email })
  res.status(201).json({ email })
})

import { Router } from 'express'
import { Email } from '../models/Email.js'
import { Invoice } from '../models/Invoice.js'
import { User } from '../models/User.js'
import { requireAuth, requireUserOrService } from '../auth/middleware.js'
import { emitChange } from '../realtime.js'
import { config } from '../config.js'


export const AUTO_SEND_DELAY_MS = 15 * 60 * 1000 // the cancel window

export const emailsRouter = Router()
emailsRouter.use(requireUserOrService)

emailsRouter.get('/', async (req, res) => {
  const filter = { userId: req.userId }
  if (req.query.status) filter.status = req.query.status
  if (req.query.invoiceId) filter.invoiceId = req.query.invoiceId
  const emails = await Email.find(filter).sort({ createdAt: -1 }).limit(50).lean()
  res.json({ emails })
})

// Recorded by the AI service after a send attempt (real or simulated),
// or queued ('queued') by the overnight agent for the owner to approve.
emailsRouter.post('/', async (req, res) => {
  const { to, subject, body, status, provider, invoiceId, clientId, error } = req.body || {}
  if (!to || !subject || !body || !status) {
    return res.status(400).json({ error: 'to, subject, body and status are required' })
  }
  // Earned autonomy: when the owner has unlocked auto-send, overnight drafts
  // skip the approval queue — but wait in a 15-minute cancel window first.
  // (Eligibility is checked when the owner flips the switch, not per email:
  // an explicitly granted permission shouldn't silently stop applying.)
  let finalStatus = status
  let sendAt
  if (status === 'queued') {
    const user = await User.findById(req.userId)
    if (user?.autonomy?.autoSendReminders) {
      finalStatus = 'scheduled'
      sendAt = new Date(Date.now() + AUTO_SEND_DELAY_MS)
    }
  }

  const email = await Email.create({
    userId: req.userId,
    to,
    subject,
    body,
    status: finalStatus,
    provider: provider || 'simulated',
    invoiceId: invoiceId || undefined,
    clientId: clientId || undefined,
    error: error || undefined,
    sendAt,
  })
  if (invoiceId && ['sent', 'simulated'].includes(status)) {
    await Invoice.findOneAndUpdate({ _id: invoiceId, userId: req.userId }, { lastReminderAt: new Date() })
  }
  emitChange(req.userId, { entity: 'email', action: 'created', id: email._id, actor: req.actor, doc: email })
  res.status(201).json({ email })
})

// Owner approves an overnight draft (optionally edited) → it actually sends.
emailsRouter.post('/:id/approve', requireAuth, async (req, res) => {
  const email = await Email.findOne({ _id: req.params.id, userId: req.userId, status: 'queued' })
  if (!email) return res.status(409).json({ error: 'This draft was already handled' })

  // trust signal: did the owner ship her words, or rewrite them?
  if (req.body?.subject?.trim() && req.body.subject.trim() !== email.subject) {
    email.subject = req.body.subject.trim()
    email.editedByOwner = true
  }
  if (req.body?.body?.trim() && req.body.body.trim() !== email.body) {
    email.body = req.body.body.trim()
    email.editedByOwner = true
  }

  let result = { status: 'simulated', error: null }
  try {
    const upstream = await fetch(`${config.aiUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Token': config.serviceToken },
      body: JSON.stringify({ to: email.to, subject: email.subject, body: email.body }),
    })
    if (upstream.ok) result = await upstream.json()
  } catch {
    /* AI service down → record as simulated rather than losing the approval */
  }

  if (result.status === 'failed') {
    // keep the draft approvable — a transient send failure shouldn't eat it
    email.error = result.error || 'send failed'
    await email.save()
    emitChange(req.userId, { entity: 'email', action: 'updated', id: email._id, actor: 'user', doc: email })
    return res.status(502).json({ error: `Couldn't send via Gmail: ${(result.error || '').slice(0, 180)}` })
  }

  email.status = result.status
  email.provider = result.status === 'sent' ? 'composio-gmail' : 'simulated'
  email.error = result.error || undefined
  await email.save()

  if (email.invoiceId && ['sent', 'simulated'].includes(email.status)) {
    await Invoice.findOneAndUpdate({ _id: email.invoiceId, userId: req.userId }, { lastReminderAt: new Date() })
  }
  emitChange(req.userId, { entity: 'email', action: 'updated', id: email._id, actor: 'user', doc: email })
  res.json({ email })
})

// Owner skips an overnight draft.
emailsRouter.post('/:id/dismiss', requireAuth, async (req, res) => {
  const email = await Email.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId, status: 'queued' },
    { status: 'dismissed' },
    { returnDocument: 'after' }
  )
  if (!email) return res.status(409).json({ error: 'This draft was already handled' })
  emitChange(req.userId, { entity: 'email', action: 'updated', id: email._id, actor: 'user', doc: email })
  res.json({ email })
})

// Owner pulls back an auto-scheduled send inside its cancel window.
emailsRouter.post('/:id/cancel', requireAuth, async (req, res) => {
  const email = await Email.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId, status: 'scheduled' },
    { status: 'dismissed', sendAt: undefined },
    { returnDocument: 'after' }
  )
  if (!email) return res.status(409).json({ error: 'Too late — this one already went out (or was handled)' })
  emitChange(req.userId, { entity: 'email', action: 'updated', id: email._id, actor: 'user', doc: email })
  res.json({ email })
})

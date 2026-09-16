import { Router } from 'express'
import { requireAuth } from '../auth/middleware.js'
import { seedDemoData } from '../seedData.js'
import { emitChange } from '../realtime.js'
import { rateLimit } from '../rateLimit.js'

export const demoRouter = Router()
demoRouter.use(requireAuth)

// "Load sample data" — lets a reviewer with a fresh account see Penny at her
// best without typing 18 invoices. Replaces the account's current data.
const loadLimiter = rateLimit({
  max: 5,
  windowMs: 15 * 60 * 1000,
  key: (r) => `demo-load:${r.userId}`,
  message: 'Too many reloads — please wait a few minutes and try again.',
})

demoRouter.post('/load', loadLimiter, async (req, res) => {
  const result = await seedDemoData(req.userId)
  emitChange(req.userId, { entity: 'invoice', action: 'reloaded', id: null, actor: 'user' })
  emitChange(req.userId, { entity: 'client', action: 'reloaded', id: null, actor: 'user' })
  res.json({ ok: true, ...result })
})

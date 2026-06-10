import { Router } from 'express'
import { requireAuth } from '../auth/middleware.js'
import { seedDemoData } from '../seedData.js'
import { emitChange } from '../realtime.js'

export const demoRouter = Router()
demoRouter.use(requireAuth)

// "Load sample data" — lets a reviewer with a fresh account see Penny at her
// best without typing 18 invoices. Replaces the account's current data.
demoRouter.post('/load', async (req, res) => {
  const result = await seedDemoData(req.userId)
  emitChange(req.userId, { entity: 'invoice', action: 'reloaded', id: null, actor: 'user' })
  emitChange(req.userId, { entity: 'client', action: 'reloaded', id: null, actor: 'user' })
  res.json({ ok: true, ...result })
})

import { Router } from 'express'
import { requireAuth } from '../auth/middleware.js'
import { runOvernightForUser } from '../overnight.js'

export const overnightRouter = Router()
overnightRouter.use(requireAuth)

// Manual trigger ("Run the overnight check now") — same job the 6am cron runs.
overnightRouter.post('/run', async (req, res) => {
  try {
    const result = await runOvernightForUser(req.userId)
    res.json(result)
  } catch (err) {
    console.error('[overnight/run]', err.message)
    res.status(502).json({ error: 'Penny could not run the overnight check — is the AI service up?' })
  }
})

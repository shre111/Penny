import { Router } from 'express'
import { requireAuth } from '../auth/middleware.js'
import { runOvernightForUser, runDigestForUser } from '../overnight.js'
import { config } from '../config.js'
import { rateLimit } from '../rateLimit.js'

export const overnightRouter = Router()
overnightRouter.use(requireAuth)

// These trigger real LLM calls and (when Composio is configured) real Gmail
// sends — unlike the rest of this router, a signed-in user could otherwise
// loop-trigger them with no cost. Keyed per-user since requireAuth runs first.
const overnightActionLimiter = rateLimit({
  max: 10,
  windowMs: 15 * 60 * 1000,
  key: (r) => `overnight:${r.userId}`,
  message: 'Too many requests — please wait a few minutes and try again.',
})

// Manual trigger ("Run the overnight check now") — same job the 6am cron runs.
overnightRouter.post('/run', overnightActionLimiter, async (req, res) => {
  try {
    const result = await runOvernightForUser(req.userId)
    res.json(result)
  } catch (err) {
    console.error('[overnight/run]', err.message)
    res.status(502).json({ error: 'Penny could not run the overnight check — is the AI service up?' })
  }
})

// Manual digest ("Email me my weekly digest now") — same as the Sunday cron.
overnightRouter.post('/digest', overnightActionLimiter, async (req, res) => {
  try {
    const result = await runDigestForUser(req.userId)
    res.json(result)
  } catch (err) {
    console.error('[digest/run]', err.message)
    res.status(502).json({ error: 'Penny could not write the digest — is the AI service up?' })
  }
})

// Scan the connected Gmail inbox for client replies to reminders.
overnightRouter.post('/check-replies', overnightActionLimiter, async (req, res) => {
  try {
    const upstream = await fetch(`${config.aiUrl}/check-replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Token': config.serviceToken },
      body: JSON.stringify({ user_id: req.userId }),
    })
    if (!upstream.ok) throw new Error(`AI ${upstream.status}`)
    res.json(await upstream.json())
  } catch (err) {
    console.error('[check-replies]', err.message)
    res.status(502).json({ error: 'Could not check the inbox — is Composio configured?' })
  }
})

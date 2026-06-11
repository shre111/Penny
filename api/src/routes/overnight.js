import { Router } from 'express'
import { requireAuth } from '../auth/middleware.js'
import { runOvernightForUser, runDigestForUser } from '../overnight.js'
import { config } from '../config.js'

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

// Manual digest ("Email me my weekly digest now") — same as the Sunday cron.
overnightRouter.post('/digest', async (req, res) => {
  try {
    const result = await runDigestForUser(req.userId)
    res.json(result)
  } catch (err) {
    console.error('[digest/run]', err.message)
    res.status(502).json({ error: 'Penny could not write the digest — is the AI service up?' })
  }
})

// Scan the connected Gmail inbox for client replies to reminders.
overnightRouter.post('/check-replies', async (req, res) => {
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

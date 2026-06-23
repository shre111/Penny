import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { OAuth2Client } from 'google-auth-library'
import { User } from '../models/User.js'
import { config } from '../config.js'
import { requireAuth, setAuthCookie, clearAuthCookie } from './middleware.js'
import { rateLimit, isLockedOut, recordFailure, clearFailures } from '../rateLimit.js'

export const authRouter = Router()
const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null

// Throttle the unauthenticated auth endpoints by client IP to stop brute force
// and mass account creation. (req.ip is the real client — app trusts the proxy.)
const loginLimiter = rateLimit({
  max: 20,
  windowMs: 15 * 60 * 1000,
  key: (r) => `login:${r.ip}`,
  message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
})
const signupLimiter = rateLimit({
  max: 10,
  windowMs: 60 * 60 * 1000,
  key: (r) => `signup:${r.ip}`,
  message: 'Too many sign-up attempts. Please wait a little while and try again.',
})
const googleLimiter = rateLimit({
  max: 30,
  windowMs: 15 * 60 * 1000,
  key: (r) => `google:${r.ip}`,
  message: 'Too many attempts. Please wait a moment and try again.',
})

authRouter.post('/signup', signupLimiter, async (req, res) => {
  const { name, email, password, businessName } = req.body || {}
  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }
  const existing = await User.findOne({ email: email.toLowerCase().trim() })
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' })

  const user = await User.create({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    businessName: (businessName || '').trim(),
    passwordHash: await bcrypt.hash(password, 10),
  })
  setAuthCookie(res, user._id)
  res.status(201).json({ user: user.toSafeJSON() })
})

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {}
  const normEmail = (email || '').toLowerCase().trim()
  if (isLockedOut(normEmail)) {
    return res
      .status(429)
      .json({ error: 'Too many failed attempts for this account. Please wait a few minutes before trying again.' })
  }
  const user = await User.findOne({ email: normEmail })
  if (!user || !user.passwordHash || !(await bcrypt.compare(password || '', user.passwordHash))) {
    recordFailure(normEmail)
    return res.status(401).json({ error: 'Incorrect email or password' })
  }
  clearFailures(normEmail)
  setAuthCookie(res, user._id)
  res.json({ user: user.toSafeJSON() })
})

// Google Identity Services: client sends the ID-token credential, we verify it
// server-side and issue the same first-party session cookie as password login.
authRouter.post('/google', googleLimiter, async (req, res) => {
  if (!googleClient) return res.status(501).json({ error: 'Google sign-in is not configured' })
  const { credential } = req.body || {}
  if (!credential) return res.status(400).json({ error: 'Missing credential' })
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: config.googleClientId })
    const { sub, email, name, picture } = ticket.getPayload()
    let user = await User.findOne({ $or: [{ googleId: sub }, { email }] })
    if (!user) {
      user = await User.create({ email, name: name || email.split('@')[0], googleId: sub, avatarUrl: picture || '' })
    } else if (!user.googleId) {
      user.googleId = sub
      if (!user.avatarUrl && picture) user.avatarUrl = picture
      await user.save()
    }
    setAuthCookie(res, user._id)
    res.json({ user: user.toSafeJSON() })
  } catch {
    res.status(401).json({ error: 'Google sign-in could not be verified' })
  }
})

authRouter.post('/logout', (_req, res) => {
  clearAuthCookie(res)
  res.json({ ok: true })
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId)
  if (!user) return res.status(401).json({ error: 'Account not found' })
  res.json({ user: user.toSafeJSON(), googleClientId: config.googleClientId || null })
})

// Expose to the login page whether Google sign-in is configured
authRouter.get('/config', (_req, res) => {
  res.json({ googleClientId: config.googleClientId || null })
})

// Earned autonomy: flip auto-send on/off — ON requires the trust bar to be met
authRouter.patch('/autonomy', requireAuth, async (req, res) => {
  const { trustStats } = await import('../trust.js')
  const user = await User.findById(req.userId)
  if (!user) return res.status(401).json({ error: 'Account not found' })
  const wantOn = Boolean(req.body?.autoSendReminders)
  if (wantOn) {
    const stats = await trustStats(req.userId)
    if (!stats.eligible) {
      return res.status(409).json({
        error: `Penny hasn't earned this yet — she needs ${stats.cleanNeeded} untouched approvals in your last ${stats.window || 0} decisions (currently ${stats.clean}, with ${stats.skipped} skipped).`,
      })
    }
  }
  user.autonomy.autoSendReminders = wantOn
  await user.save()
  res.json({ user: user.toSafeJSON() })
})

// Concierge guardrails: what Penny may agree to with clients on public pages
authRouter.patch('/concierge', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId)
  if (!user) return res.status(401).json({ error: 'Account not found' })
  const { enabled, maxExtensionDays, maxInstallments } = req.body || {}
  if (enabled !== undefined) user.concierge.enabled = Boolean(enabled)
  if (maxExtensionDays !== undefined) {
    user.concierge.maxExtensionDays = Math.max(0, Math.min(90, Number(maxExtensionDays) || 0))
  }
  if (maxInstallments !== undefined) {
    user.concierge.maxInstallments = Math.max(1, Math.min(12, Number(maxInstallments) || 1))
  }
  await user.save()
  res.json({ user: user.toSafeJSON() })
})

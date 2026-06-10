import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { OAuth2Client } from 'google-auth-library'
import { User } from '../models/User.js'
import { config } from '../config.js'
import { requireAuth, setAuthCookie, clearAuthCookie } from './middleware.js'

export const authRouter = Router()
const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null

authRouter.post('/signup', async (req, res) => {
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

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {}
  const user = await User.findOne({ email: (email || '').toLowerCase().trim() })
  if (!user || !user.passwordHash || !(await bcrypt.compare(password || '', user.passwordHash))) {
    return res.status(401).json({ error: 'Incorrect email or password' })
  }
  setAuthCookie(res, user._id)
  res.json({ user: user.toSafeJSON() })
})

// Google Identity Services: client sends the ID-token credential, we verify it
// server-side and issue the same first-party session cookie as password login.
authRouter.post('/google', async (req, res) => {
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

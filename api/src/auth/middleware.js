import jwt from 'jsonwebtoken'
import { config } from '../config.js'

export const COOKIE_NAME = 'penny_token'

export function signToken(userId) {
  return jwt.sign({ sub: userId.toString() }, config.jwtSecret, { expiresIn: '7d' })
}

export function setAuthCookie(res, userId) {
  res.cookie(COOKIE_NAME, signToken(userId), {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600 * 1000,
  })
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME)
}

// Browser auth via JWT cookie
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) return res.status(401).json({ error: 'Not signed in' })
  try {
    const payload = jwt.verify(token, config.jwtSecret)
    req.userId = payload.sub
    req.actor = 'user'
    next()
  } catch {
    return res.status(401).json({ error: 'Session expired, please sign in again' })
  }
}

// AI service auth: shared secret + acts on behalf of the user it names.
// Agent-made mutations are tagged so the UI can highlight "Penny did this".
export function requireUserOrService(req, res, next) {
  const serviceToken = req.headers['x-service-token']
  if (serviceToken) {
    if (serviceToken !== config.serviceToken) {
      return res.status(401).json({ error: 'Bad service token' })
    }
    const userId = req.headers['x-user-id']
    if (!userId) return res.status(400).json({ error: 'X-User-Id required' })
    req.userId = userId
    req.actor = req.headers['x-actor'] === 'agent' ? 'agent' : 'service'
    return next()
  }
  return requireAuth(req, res, next)
}

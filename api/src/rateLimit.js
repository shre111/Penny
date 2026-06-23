/**
 * Tiny in-memory rate limiter + failed-login lockout. Same single-instance
 * caveat as the public concierge limiter (resets on restart, not shared across
 * instances) — fine at this scale; Redis is the scale path. Closes the
 * brute-force hole on the unauthenticated auth endpoints.
 */

const hits = new Map() // key -> { count, resetAt }

export function rateLimit({ max, windowMs, key, message }) {
  return (req, res, next) => {
    const k = key(req)
    const now = Date.now()
    const e = hits.get(k) || { count: 0, resetAt: now + windowMs }
    if (now > e.resetAt) {
      e.count = 0
      e.resetAt = now + windowMs
    }
    e.count += 1
    hits.set(k, e)
    if (e.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((e.resetAt - now) / 1000)))
      return res.status(429).json({ error: message || 'Too many attempts. Please wait a little while and try again.' })
    }
    next()
  }
}

// ── failed-login lockout (per email) ────────────────────────────────────────
const LOCK_THRESHOLD = 5
const LOCK_WINDOW_MS = 15 * 60 * 1000
const failures = new Map() // email -> { count, firstAt }

export function isLockedOut(email) {
  if (!email) return false
  const f = failures.get(email)
  if (!f) return false
  if (Date.now() - f.firstAt > LOCK_WINDOW_MS) {
    failures.delete(email)
    return false
  }
  return f.count >= LOCK_THRESHOLD
}

export function recordFailure(email) {
  if (!email) return
  const now = Date.now()
  const f = failures.get(email)
  if (!f || now - f.firstAt > LOCK_WINDOW_MS) {
    failures.set(email, { count: 1, firstAt: now })
  } else {
    f.count += 1
  }
}

export function clearFailures(email) {
  if (email) failures.delete(email)
}

// periodic cleanup so the maps don't grow unbounded; unref so it never blocks exit
setInterval(() => {
  const now = Date.now()
  for (const [k, e] of hits) if (now > e.resetAt) hits.delete(k)
  for (const [k, f] of failures) if (now - f.firstAt > LOCK_WINDOW_MS) failures.delete(k)
}, 10 * 60 * 1000).unref()

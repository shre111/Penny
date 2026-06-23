/**
 * Defense-in-depth HTTP hardening, dependency-free:
 *  - securityHeaders: baseline response headers (the high-value subset of what
 *    Helmet would set), with no CSP so the SPA, Google Identity script and SSE
 *    streaming are unaffected.
 *  - csrfGuard: rejects cross-site state-changing requests on top of the
 *    SameSite=Lax auth cookie. Service-to-service calls (X-Service-Token) and
 *    non-browser clients (no Origin/Referer — curl, the eval suite) are exempt.
 */
import { config } from './config.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  if (config.isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  }
  next()
}

function originAllowed(origin, req) {
  if (!origin) return true // not a browser-credentialed request → not a CSRF vector
  let host
  try {
    host = new URL(origin).host
  } catch {
    return false // malformed Origin
  }
  if (host === req.headers.host) return true // same-origin (covers single-origin prod + local proxy target)
  return config.allowedOrigins.includes(origin)
}

export function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next()
  if (req.headers['x-service-token']) return next() // shared-secret callers, not cookie auth

  const origin = req.headers.origin
  if (origin) {
    return originAllowed(origin, req) ? next() : res.status(403).json({ error: 'Cross-origin request blocked' })
  }
  // No Origin: fall back to Referer if the browser sent one; otherwise allow
  // (server-to-server / CLI / tests don't carry ambient cookies cross-site).
  const referer = req.headers.referer
  if (!referer) return next()
  try {
    return originAllowed(new URL(referer).origin, req)
      ? next()
      : res.status(403).json({ error: 'Cross-origin request blocked' })
  } catch {
    return next()
  }
}

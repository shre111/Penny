import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Load api/.env first, then fall back to repo-root .env (shared in dev)
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true })
dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true })

const required = (name, fallback) => {
  const v = process.env[name] ?? fallback
  if (v === undefined) {
    console.error(`Missing required env var ${name}`)
    process.exit(1)
  }
  return v
}

export const config = {
  port: Number(process.env.PORT || 4001),
  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/penny'),
  jwtSecret: required('JWT_SECRET', 'dev-only-secret-change-me'),
  aiUrl: process.env.AI_URL || 'http://localhost:8400', // AI service runs on 8400; 8000 is squatted by a local Chroma container
  serviceToken: required('SERVICE_TOKEN', 'dev-service-token'),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  isProd: process.env.NODE_ENV === 'production',
  // Extra browser origins allowed to make state-changing requests (CSRF guard).
  // Same-origin is always allowed; add cross-origin frontends here (e.g. a
  // Vercel domain proxying to this API). Comma-separated.
  allowedOrigins: [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4001',
    ...(process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ],
}

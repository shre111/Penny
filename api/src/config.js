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
  aiUrl: process.env.AI_URL || 'http://localhost:8000',
  serviceToken: required('SERVICE_TOKEN', 'dev-service-token'),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  isProd: process.env.NODE_ENV === 'production',
}

import express from 'express'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cookieParser from 'cookie-parser'
import { config } from './config.js'
import { connectDb } from './db.js'
import { attachRealtime } from './realtime.js'
import { authRouter } from './auth/routes.js'
import { clientsRouter } from './routes/clients.js'
import { invoicesRouter } from './routes/invoices.js'
import { metricsRouter } from './routes/metrics.js'
import { emailsRouter } from './routes/emails.js'
import { memoriesRouter } from './routes/memories.js'
import { chatRouter } from './routes/chat.js'
import { uploadsRouter } from './routes/uploads.js'
import { importsRouter } from './routes/imports.js'
import { demoRouter } from './routes/demo.js'
import { activitiesRouter } from './routes/activities.js'
import { proposalsRouter } from './routes/proposals.js'
import { publicRouter } from './routes/public.js'
import { knowledgeRouter } from './routes/knowledge.js'
import { overnightRouter } from './routes/overnight.js'
import { invoicePdfHandler } from './routes/invoicePdf.js'
import { requireAuth } from './auth/middleware.js'
import { trustStats } from './trust.js'
import { startOvernightSchedule } from './overnight.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

await connectDb()

const app = express()
app.set('trust proxy', 1) // Render sits behind a proxy; needed for secure cookies
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'penny-api' }))
app.use('/api/auth', authRouter)
app.use('/api/clients', clientsRouter)
app.use('/api/invoices', invoicesRouter)
app.use('/api/metrics', metricsRouter)
app.use('/api/emails', emailsRouter)
app.use('/api/memories', memoriesRouter)
app.use('/api/chat', chatRouter)
app.use('/api/uploads', uploadsRouter)
app.use('/api/import', importsRouter)
app.use('/api/demo', demoRouter)
app.use('/api/activities', activitiesRouter)
app.use('/api/proposals', proposalsRouter)
app.use('/api/public', publicRouter)
app.use('/api/knowledge', knowledgeRouter)
app.use('/api/overnight', overnightRouter)
app.get('/api/invoices/:id/pdf', requireAuth, invoicePdfHandler)
app.get('/api/trust', requireAuth, async (req, res) => res.json(await trustStats(req.userId)))

// Production: serve the built SPA from the same origin
const webDist = path.join(__dirname, '..', '..', 'web', 'dist')
app.use(express.static(webDist))
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(webDist, 'index.html'), (err) => {
    if (err) res.status(200).send('Penny API is running. Build the web app for the full UI.')
  })
})

// JSON error handler (multer size limits, body parse errors, anything thrown)
app.use((err, _req, res, _next) => {
  console.error('[api]', err.message)
  if (res.headersSent) return res.end()
  const status = err.status || (err.name === 'MulterError' ? 400 : 500)
  res.status(status).json({ error: err.message || 'Something went wrong' })
})

const server = http.createServer(app)
attachRealtime(server)

startOvernightSchedule()

server.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`)
})

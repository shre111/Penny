import { Router } from 'express'
import multer from 'multer'
import { KnowledgeChunk } from '../models/Knowledge.js'
import { requireAuth, requireUserOrService } from '../auth/middleware.js'
import { config } from '../config.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })

export const knowledgeRouter = Router()

// ── owner side ────────────────────────────────────────────────────────────

// Sources overview (grouped)
knowledgeRouter.get('/', requireAuth, async (req, res) => {
  const sources = await KnowledgeChunk.aggregate([
    { $match: { userId: new KnowledgeChunk.base.Types.ObjectId(req.userId) } },
    { $group: { _id: '$source', chunks: { $sum: 1 }, addedAt: { $min: '$createdAt' } } },
    { $sort: { addedAt: -1 } },
  ])
  res.json({ sources: sources.map((s) => ({ source: s._id, chunks: s.chunks, addedAt: s.addedAt })) })
})

// Teach via paste or .txt/.md upload → AI service chunks + embeds → stored here
knowledgeRouter.post('/', requireAuth, upload.single('file'), async (req, res) => {
  let text = (req.body?.text || '').trim()
  let source = (req.body?.source || '').trim()
  if (req.file) {
    if (!/\.(txt|md)$/i.test(req.file.originalname)) {
      return res.status(400).json({ error: 'Upload a .txt or .md file, or paste the text directly' })
    }
    text = req.file.buffer.toString('utf8').trim()
    source = source || req.file.originalname
  }
  if (!text) return res.status(400).json({ error: 'Nothing to learn — paste some text or upload a file' })
  if (!source) return res.status(400).json({ error: 'Give this knowledge a name (e.g. "Payment terms")' })
  if (text.length > 60_000) return res.status(400).json({ error: 'That is a lot — keep each source under 60k characters' })

  const upstream = await fetch(`${config.aiUrl}/knowledge/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Service-Token': config.serviceToken },
    body: JSON.stringify({ user_id: req.userId, source, text }),
  })
  if (!upstream.ok) {
    const detail = await upstream.json().catch(() => ({}))
    return res.status(502).json({ error: detail?.detail || 'Penny could not study that right now — is an embedding model configured?' })
  }
  const { chunks } = await upstream.json()

  await KnowledgeChunk.deleteMany({ userId: req.userId, source }) // re-teaching replaces
  await KnowledgeChunk.insertMany(
    chunks.map((c) => ({ userId: req.userId, source, chunk: c.chunk, embedding: c.embedding }))
  )
  res.status(201).json({ source, chunks: chunks.length })
})

knowledgeRouter.delete('/:source', requireAuth, async (req, res) => {
  const { deletedCount } = await KnowledgeChunk.deleteMany({ userId: req.userId, source: req.params.source })
  if (!deletedCount) return res.status(404).json({ error: 'No knowledge source by that name' })
  res.json({ ok: true, removed: deletedCount })
})

// ── service side (the agents' retrieval path) ─────────────────────────────

// All chunks for a user — the AI service embeds the query and ranks these.
knowledgeRouter.get('/chunks', requireUserOrService, async (req, res) => {
  const chunks = await KnowledgeChunk.find({ userId: req.userId })
    .select('source chunk embedding')
    .limit(500)
    .lean()
  res.json({ chunks })
})

import { Router } from 'express'
import multer from 'multer'
import { ChatSession, Message } from '../models/Chat.js'
import { requireAuth } from '../auth/middleware.js'
import { config } from '../config.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

export const uploadsRouter = Router()
uploadsRouter.use(requireAuth)

/**
 * Invoice/receipt extraction: file → AI service (Gemini vision) → structured
 * proposal persisted as an 'extraction' artifact in the chat. The user
 * confirms in the UI, which then hits POST /api/invoices with source:'document'.
 */
uploadsRouter.post('/extract/:sessionId', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' })
  const okTypes = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
  if (!okTypes.includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'Please upload a photo (PNG/JPG) or a PDF' })
  }
  const session = await ChatSession.findOne({ _id: req.params.sessionId, userId: req.userId })
  if (!session) return res.status(404).json({ error: 'Conversation not found' })

  await Message.create({
    sessionId: session._id,
    userId: req.userId,
    role: 'user',
    content: `📎 Uploaded ${req.file.originalname}`,
  })

  try {
    const form = new FormData()
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname)
    const upstream = await fetch(`${config.aiUrl}/extract`, {
      method: 'POST',
      headers: { 'X-Service-Token': config.serviceToken, 'X-User-Id': req.userId },
      body: form,
    })
    if (!upstream.ok) throw new Error(`AI service ${upstream.status}`)
    const { extraction } = await upstream.json()

    const assistantMsg = await Message.create({
      sessionId: session._id,
      userId: req.userId,
      role: 'assistant',
      content: extraction.summary || 'Here is what I could read from your document. Look right?',
      events: [{ id: 'extract', label: `Read ${req.file.originalname}`, tool: 'extract_document', status: 'done' }],
      artifacts: [{ type: 'extraction', data: { ...extraction, fileName: req.file.originalname, status: 'pending' } }],
    })
    session.lastMessageAt = new Date()
    if (session.title === 'New conversation') session.title = `Invoice from ${req.file.originalname}`
    await session.save()
    res.json({ message: assistantMsg })
  } catch (err) {
    console.error('[extract]', err.message)
    const assistantMsg = await Message.create({
      sessionId: session._id,
      userId: req.userId,
      role: 'assistant',
      content: "I couldn't read that document, sorry. You can try a clearer photo, or just tell me the details and I'll log it.",
    })
    res.status(200).json({ message: assistantMsg })
  }
})

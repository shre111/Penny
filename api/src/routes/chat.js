import { Router } from 'express'
import { ChatSession, Message } from '../models/Chat.js'
import { User } from '../models/User.js'
import { requireAuth } from '../auth/middleware.js'
import { config } from '../config.js'

export const chatRouter = Router()
chatRouter.use(requireAuth)

chatRouter.get('/sessions', async (req, res) => {
  const sessions = await ChatSession.find({ userId: req.userId }).sort({ lastMessageAt: -1 }).limit(50).lean()
  res.json({ sessions })
})

chatRouter.post('/sessions', async (req, res) => {
  const session = await ChatSession.create({ userId: req.userId })
  res.status(201).json({ session })
})

chatRouter.delete('/sessions/:id', async (req, res) => {
  const session = await ChatSession.findOneAndDelete({ _id: req.params.id, userId: req.userId })
  if (!session) return res.status(404).json({ error: 'Conversation not found' })
  await Message.deleteMany({ sessionId: session._id })
  res.json({ ok: true })
})

chatRouter.get('/sessions/:id/messages', async (req, res) => {
  const session = await ChatSession.findOne({ _id: req.params.id, userId: req.userId })
  if (!session) return res.status(404).json({ error: 'Conversation not found' })
  const messages = await Message.find({ sessionId: session._id }).sort({ createdAt: 1 }).lean()
  res.json({ messages })
})

/**
 * The streaming relay. Browser POSTs a message; we persist it, then proxy the
 * AI service's SSE stream straight through while also parsing it so the final
 * assistant message (text + activity + artifacts + any pending approval) can
 * be persisted when the stream ends. SSE because EventSource can't POST —
 * the client reads this with fetch + ReadableStream.
 */
chatRouter.post('/sessions/:id/messages', async (req, res) => {
  const { content } = req.body || {}
  if (!content?.trim()) return res.status(400).json({ error: 'Say something first' })
  const session = await ChatSession.findOne({ _id: req.params.id, userId: req.userId })
  if (!session) return res.status(404).json({ error: 'Conversation not found' })

  await Message.create({ sessionId: session._id, userId: req.userId, role: 'user', content: content.trim() })
  if (session.title === 'New conversation') {
    session.title = content.trim().slice(0, 60)
  }
  session.lastMessageAt = new Date()
  await session.save()

  const user = await User.findById(req.userId)
  await relayAgentStream(req, res, session, '/chat', {
    thread_id: session._id.toString(),
    user_id: req.userId,
    content: content.trim(),
    user_name: user?.name || '',
    business_name: user?.businessName || '',
  })
})

/** Resume a paused (human-in-the-loop) run with the user's decisions. */
chatRouter.post('/sessions/:id/resume', async (req, res) => {
  const { decisions, messageId } = req.body || {}
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return res.status(400).json({ error: 'decisions are required' })
  }
  const session = await ChatSession.findOne({ _id: req.params.id, userId: req.userId })
  if (!session) return res.status(404).json({ error: 'Conversation not found' })

  // Guard against double-resume: the card must still be pending
  const msg = await Message.findOne({ _id: messageId, sessionId: session._id, 'interrupt.status': 'pending' })
  if (!msg) return res.status(409).json({ error: 'This request was already handled' })
  msg.interrupt.status = 'resolved'
  msg.interrupt.decisions = decisions.map((d) => d.type)
  msg.markModified('interrupt')
  await msg.save()

  session.lastMessageAt = new Date()
  await session.save()

  await relayAgentStream(req, res, session, '/resume', {
    thread_id: session._id.toString(),
    user_id: req.userId,
    decisions,
  })
})

async function relayAgentStream(req, res, session, aiPath, payload) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const abort = new AbortController()
  req.on('close', () => abort.abort())

  // Accumulators so the assistant turn survives in Mongo after the stream ends
  let text = ''
  const events = []
  const artifacts = []
  let interrupt = null
  let upstreamError = null

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const upstream = await fetch(`${config.aiUrl}${aiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Token': config.serviceToken },
      body: JSON.stringify(payload),
      signal: abort.signal,
      duplex: 'half',
    })
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '')
      throw new Error(`AI service ${upstream.status}: ${detail.slice(0, 300)}`)
    }

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunkText = decoder.decode(value, { stream: true })
      res.write(chunkText) // forward immediately, untouched — latency first

      // ...then parse complete SSE frames for persistence
      buffer += chunkText
      let sep
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const eventLine = frame.split('\n').find((l) => l.startsWith('event: '))
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
        if (!eventLine || !dataLine) continue
        const eventName = eventLine.slice(7).trim()
        let data
        try {
          data = JSON.parse(dataLine.slice(6))
        } catch {
          continue
        }
        if (eventName === 'token') text += data.text || ''
        else if (eventName === 'activity') {
          const existing = events.find((e) => e.id === data.id)
          if (existing) Object.assign(existing, data)
          else events.push(data)
        } else if (eventName === 'artifact') artifacts.push(data)
        else if (eventName === 'interrupt') interrupt = data
        else if (eventName === 'error') upstreamError = data.message || 'The assistant hit a problem'
      }
    }
  } catch (err) {
    if (!abort.signal.aborted) {
      upstreamError = 'Penny could not be reached. Please try again in a moment.'
      console.error('[chat relay]', err.message)
    }
  }

  // Persist whatever the agent produced this turn (even partial on error)
  try {
    if (text || events.length || artifacts.length || interrupt || upstreamError) {
      const assistantMsg = await Message.create({
        sessionId: session._id,
        userId: session.userId,
        role: 'assistant',
        content: upstreamError && !text ? upstreamError : text,
        events,
        artifacts,
        interrupt: interrupt ? { actions: interrupt.actions || [], status: 'pending' } : undefined,
      })
      if (!res.writableEnded && !abort.signal.aborted) {
        if (upstreamError && !text) send('error', { message: upstreamError })
        send('done', { messageId: assistantMsg._id })
      }
    } else if (!res.writableEnded && !abort.signal.aborted) {
      if (upstreamError) send('error', { message: upstreamError })
      send('done', {})
    }
  } catch (err) {
    console.error('[chat persist]', err.message)
  }
  res.end()
}

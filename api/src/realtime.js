import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { COOKIE_NAME } from './auth/middleware.js'
import { config } from './config.js'

let io = null

export function attachRealtime(httpServer) {
  io = new Server(httpServer, { cors: { origin: true, credentials: true } })

  io.use((socket, next) => {
    // Authenticate the websocket with the same JWT cookie the API uses
    const cookies = Object.fromEntries(
      (socket.handshake.headers.cookie || '')
        .split(';')
        .map((c) => c.trim().split('=').map(decodeURIComponent))
        .filter((p) => p.length === 2)
    )
    try {
      const payload = jwt.verify(cookies[COOKIE_NAME], config.jwtSecret)
      socket.data.userId = payload.sub
      next()
    } catch {
      next(new Error('unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`)
  })

  return io
}

// Every data mutation (human or agent) flows through this — the live
// dashboard, outbox, highlight animations AND the audit trail all hang off it.
export function emitChange(userId, { entity, action, id, actor = 'user', doc = null }) {
  if (io) {
    io.to(`user:${userId}`).emit('entity:changed', { entity, action, id, actor, doc, at: Date.now() })
  }
  recordActivity(userId, { entity, action, id, actor, doc }).catch((err) =>
    console.error('[activity]', err.message)
  )
}

async function recordActivity(userId, { entity, action, id, actor, doc }) {
  if (action === 'reloaded') return // bulk demo reloads aren't individual actions
  const { Activity } = await import('./models/Activity.js')
  const summary = buildSummary(entity, action, doc)
  if (!summary) return
  const undoable =
    actor === 'agent' && action === 'created' && (entity === 'invoice' || entity === 'client')
      ? { type: entity === 'invoice' ? 'delete-invoice' : 'delete-client' }
      : undefined
  await Activity.create({ userId, entity, action, entityId: id || undefined, summary, actor, undo: undoable })
}

function buildSummary(entity, action, doc) {
  const verb = { created: 'added', updated: 'updated', deleted: 'deleted' }[action] || action
  if (entity === 'invoice') {
    const client = doc?.clientId?.name ? ` for ${doc.clientId.name}` : ''
    const amount = doc?.amount != null ? ` — $${Number(doc.amount).toLocaleString('en-US')}` : ''
    return `Invoice ${doc?.number || ''}${client}${amount} ${verb}`.replace(/\s+/g, ' ').trim()
  }
  if (entity === 'client') {
    return `Client ${doc?.name || ''} ${verb}`.replace(/\s+/g, ' ').trim()
  }
  if (entity === 'email') {
    const state =
      { queued: 'drafted overnight, waiting for your OK', sent: 'sent', simulated: 'saved to the outbox', dismissed: 'skipped', failed: 'failed to send' }[
        doc?.status
      ] || verb
    return `Email to ${doc?.to || 'a client'} (“${(doc?.subject || '').slice(0, 60)}”) ${state}`
  }
  return null
}

export function emitToUser(userId, event, payload) {
  if (!io) return
  io.to(`user:${userId}`).emit(event, payload)
}

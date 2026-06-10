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
// dashboard, outbox and highlight animations all hang off these events.
export function emitChange(userId, { entity, action, id, actor = 'user', doc = null }) {
  if (!io) return
  io.to(`user:${userId}`).emit('entity:changed', { entity, action, id, actor, doc, at: Date.now() })
}

export function emitToUser(userId, event, payload) {
  if (!io) return
  io.to(`user:${userId}`).emit(event, payload)
}

import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

/** Same-origin socket: Vite proxies /socket.io in dev; Express serves us in prod. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io({ withCredentials: true })
  }
  return socket
}

export function disconnectSocket() {
  socket?.disconnect()
  socket = null
}

export interface EntityChange {
  entity: 'invoice' | 'client' | 'email'
  action: 'created' | 'updated' | 'deleted' | 'reloaded'
  id: string | null
  actor: 'user' | 'agent' | 'service'
  doc?: any
  at: number
}

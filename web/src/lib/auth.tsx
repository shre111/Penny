import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import { disconnectSocket } from './socket'

export interface User {
  id: string
  email: string
  name: string
  businessName: string
  avatarUrl: string
  isDemo: boolean
  hasGoogle: boolean
  concierge?: { enabled: boolean; maxExtensionDays: number; maxInstallments: number }
}

interface AuthCtx {
  user: User | null
  loading: boolean
  setUser: (u: User | null) => void
  logout: () => Promise<void>
}

const Ctx = createContext<AuthCtx>({ user: null, loading: true, setUser: () => {}, logout: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<{ user: User }>('/api/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' })
    disconnectSocket()
    setUser(null)
  }

  return <Ctx.Provider value={{ user, loading, setUser, logout }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)

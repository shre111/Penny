import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google'
import { api } from '../lib/api'
import { useAuth, type User } from '../lib/auth'
import { Wordmark, Spinner } from '../components/ui'

export default function Login() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleClientId, setGoogleClientId] = useState<string | null>(null)

  useEffect(() => {
    api<{ googleClientId: string | null }>('/api/auth/config')
      .then((d) => setGoogleClientId(d.googleClientId))
      .catch(() => {})
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const d = await api<{ user: User }>('/api/auth/login', { method: 'POST', json: { email, password } })
      setUser(d.user)
      navigate('/')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onGoogle = async (credential?: string) => {
    if (!credential) return
    setBusy(true)
    setError('')
    try {
      const d = await api<{ user: User }>('/api/auth/google', { method: 'POST', json: { credential } })
      setUser(d.user)
      navigate('/')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      headline="Welcome back"
      sub="Sign in and let Penny catch you up on your money."
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="rounded-xl bg-red-50 border border-red-200 text-danger-600 px-4 py-3 text-sm">{error}</p>}
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" className="input"
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourbusiness.com" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" required autoComplete="current-password" className="input"
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <button className="btn-primary w-full py-3 text-base" disabled={busy}>
          {busy ? <Spinner /> : 'Sign in'}
        </button>
        {googleClientId && (
          <>
            <Divider />
            <GoogleOAuthProvider clientId={googleClientId}>
              <div className="flex justify-center">
                <GoogleLogin onSuccess={(r) => onGoogle(r.credential)} onError={() => setError('Google sign-in failed')} width="320" text="continue_with" />
              </div>
            </GoogleOAuthProvider>
          </>
        )}
        <p className="text-center text-sm text-ink-soft pt-2">
          New here?{' '}
          <Link to="/signup" className="font-semibold text-brand-700 hover:underline">Create your account</Link>
        </p>
        <p className="text-center text-xs text-ink-soft/80 border-t border-line pt-3 mt-1">
          Just looking around? Try the demo: <span className="font-mono">demo@penny.app</span> / <span className="font-mono">demo1234</span>
        </p>
      </form>
    </AuthLayout>
  )
}

export function Divider() {
  return (
    <div className="flex items-center gap-3 text-xs text-ink-soft/70">
      <span className="h-px flex-1 bg-line" />
      or
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

export function AuthLayout({ headline, sub, children }: { headline: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-brand-900 text-white p-12 relative overflow-hidden">
        <div className="absolute -right-24 -top-24 w-96 h-96 rounded-full bg-brand-800" />
        <div className="absolute -right-10 bottom-20 w-64 h-64 rounded-full bg-copper-500/20" />
        <div className="relative"><Wordmark size="text-3xl" /></div>
        <div className="relative max-w-md">
          <h2 className="font-display text-4xl leading-snug mb-4">The back office that runs itself.</h2>
          <p className="text-brand-200 text-lg leading-relaxed">
            Penny keeps your invoices, clients and cash flow in order — you just talk to her.
            Ask who owes you money. Have her chase late payments, politely. Watch your books
            update while you chat.
          </p>
        </div>
        <p className="relative text-brand-300 text-sm">Built for business owners, not bookkeepers.</p>
      </div>
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8"><Wordmark /></div>
          <h1 className="font-display text-3xl mb-2">{headline}</h1>
          <p className="text-ink-soft mb-8">{sub}</p>
          {children}
        </div>
      </div>
    </div>
  )
}

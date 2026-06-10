import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google'
import { api } from '../lib/api'
import { useAuth, type User } from '../lib/auth'
import { Spinner } from '../components/ui'
import { AuthLayout, Divider } from './Login'

export default function Signup() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', businessName: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleClientId, setGoogleClientId] = useState<string | null>(null)

  useEffect(() => {
    api<{ googleClientId: string | null }>('/api/auth/config')
      .then((d) => setGoogleClientId(d.googleClientId))
      .catch(() => {})
  }, [])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const d = await api<{ user: User }>('/api/auth/signup', { method: 'POST', json: form })
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
    <AuthLayout headline="Meet your new back office" sub="Two minutes to set up. No spreadsheets required.">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="rounded-xl bg-red-50 border border-red-200 text-danger-600 px-4 py-3 text-sm">{error}</p>}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="name">Your name</label>
            <input id="name" required className="input" value={form.name} onChange={set('name')} placeholder="Jordan Avery" />
          </div>
          <div>
            <label className="label" htmlFor="businessName">Business name <span className="font-normal text-ink-soft">(optional)</span></label>
            <input id="businessName" className="input" value={form.businessName} onChange={set('businessName')} placeholder="Bluepeak Studio" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" className="input" value={form.email} onChange={set('email')} placeholder="you@yourbusiness.com" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" required minLength={8} autoComplete="new-password" className="input" value={form.password} onChange={set('password')} placeholder="At least 8 characters" />
        </div>
        <button className="btn-primary w-full py-3 text-base" disabled={busy}>
          {busy ? <Spinner /> : 'Create my account'}
        </button>
        {googleClientId && (
          <>
            <Divider />
            <GoogleOAuthProvider clientId={googleClientId}>
              <div className="flex justify-center">
                <GoogleLogin onSuccess={(r) => onGoogle(r.credential)} onError={() => setError('Google sign-up failed')} width="320" text="signup_with" />
              </div>
            </GoogleOAuthProvider>
          </>
        )}
        <p className="text-center text-sm text-ink-soft pt-2">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-700 hover:underline">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  )
}

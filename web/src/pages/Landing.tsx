import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BellRing, CheckCircle2, FileScan, MessageCircle, MoonStar, ShieldCheck, TrendingUp } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth, type User } from '../lib/auth'
import { Spinner, Wordmark } from '../components/ui'

const FEATURES = [
  {
    icon: <MessageCircle className="h-5 w-5" />,
    title: 'Just talk to her',
    body: '“Who owes me money?” “Log an invoice for Acme, $450.” Penny answers from your real books — and does the work while you watch your dashboard update.',
  },
  {
    icon: <BellRing className="h-5 w-5" />,
    title: 'She chases, politely',
    body: 'Penny drafts warm payment reminders for overdue invoices. You approve, edit or skip every single one — nothing is ever sent without your OK.',
  },
  {
    icon: <FileScan className="h-5 w-5" />,
    title: 'Snap a photo, it’s booked',
    body: 'Drop a photo or PDF of an invoice into the chat. Penny reads it, you confirm, and it’s in your books with every line item.',
  },
  {
    icon: <MoonStar className="h-5 w-5" />,
    title: 'She works the night shift',
    body: 'Every morning Penny has already checked who slipped overdue and queued reminder drafts — waiting for your one-tap approval with your coffee.',
  },
  {
    icon: <TrendingUp className="h-5 w-5" />,
    title: 'Your money, at a glance',
    body: 'A live dashboard of what’s owed, what’s late and what came in — with charts a human can actually read.',
  },
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: 'Every change on the record',
    body: 'A full activity trail of what changed and who changed it — you or Penny. One-click undo on anything she added.',
  },
]

export default function Landing() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [demoBusy, setDemoBusy] = useState(false)

  const tryDemo = async () => {
    setDemoBusy(true)
    try {
      const d = await api<{ user: User }>('/api/auth/login', {
        method: 'POST',
        json: { email: 'demo@penny.app', password: 'demo1234' },
      })
      setUser(d.user)
      navigate('/')
    } catch {
      navigate('/signup') // demo account not seeded in this environment
    } finally {
      setDemoBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="max-w-6xl mx-auto flex items-center justify-between px-6 py-5">
        <Wordmark />
        <nav className="flex items-center gap-2">
          <Link to="/login" className="btn-ghost text-sm">Sign in</Link>
          <Link to="/signup" className="btn-primary text-sm">Create account</Link>
        </nav>
      </header>

      <section className="max-w-6xl mx-auto px-6 pt-12 pb-16 text-center">
        <p className="inline-block rounded-full bg-copper-100 text-copper-700 text-xs font-bold px-3 py-1 mb-5">
          For small businesses with better things to do than bookkeeping
        </p>
        <h1 className="font-display text-4xl sm:text-6xl leading-tight max-w-3xl mx-auto">
          The back office that <span className="text-brand-700">runs itself.</span>
        </h1>
        <p className="text-lg text-ink-soft max-w-2xl mx-auto mt-5 leading-relaxed">
          Penny keeps your invoices, clients and cash flow in order — you just talk to her.
          She drafts the awkward “please pay me” emails, reads invoices from photos, and
          works the night shift. You stay in charge: nothing happens without your OK.
        </p>
        <div className="flex items-center justify-center gap-3 mt-8 flex-wrap">
          <button className="btn-copper text-base px-7 py-3" onClick={tryDemo} disabled={demoBusy}>
            {demoBusy ? <Spinner /> : 'Try the live demo'}
          </button>
          <Link to="/signup" className="btn-ghost text-base px-7 py-3">Start fresh — it’s free</Link>
        </div>
        <p className="text-xs text-ink-soft/70 mt-3">The demo opens a sample design studio with real, live data. Poke anything.</p>

        <div className="mt-12 rounded-2xl border border-line shadow-[0_24px_60px_-24px_rgba(36,52,48,0.35)] overflow-hidden bg-white max-w-5xl mx-auto">
          <div className="flex items-center gap-1.5 bg-stone-100 px-4 py-2.5 border-b border-line">
            <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-200" />
            <span className="h-2.5 w-2.5 rounded-full bg-brand-300" />
            <span className="text-[11px] text-ink-soft/70 ml-3">penny — your books, live</span>
          </div>
          <img
            src="/app-shot.png"
            alt="Penny: live dashboard on the left, chat with Penny on the right"
            className="w-full block"
            loading="lazy"
          />
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-5">
              <span className="inline-flex rounded-xl bg-brand-50 text-brand-700 p-2.5 mb-3">{f.icon}</span>
              <h3 className="font-semibold mb-1.5">{f.title}</h3>
              <p className="text-sm text-ink-soft leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-brand-900 text-white">
        <div className="max-w-6xl mx-auto px-6 py-16 text-center">
          <h2 className="font-display text-3xl mb-3">Five minutes to a tidier business.</h2>
          <p className="text-brand-200 max-w-xl mx-auto mb-7">
            Sign up, load the sample business or add your first client, and ask Penny the question
            every owner asks: <em>“Who owes me money?”</em>
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link to="/signup" className="btn-copper text-base px-7 py-3">Create your account</Link>
            <button className="btn text-base px-7 py-3 bg-white/10 text-white hover:bg-white/20" onClick={tryDemo} disabled={demoBusy}>
              {demoBusy ? <Spinner /> : 'Or try the demo first'}
            </button>
          </div>
          <p className="flex items-center justify-center gap-1.5 text-brand-300 text-xs mt-6">
            <CheckCircle2 className="h-3.5 w-3.5" /> Free · no card · your data stays yours
          </p>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between text-xs text-ink-soft/70">
        <Wordmark size="text-base" />
        <p>Built with care for people who run real businesses.</p>
      </footer>
    </div>
  )
}

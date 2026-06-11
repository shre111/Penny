import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth, type User } from '../../lib/auth'
import type { TrustStats } from '../../lib/types'
import { useLiveData } from '../../hooks/useLiveData'
import { Spinner } from '../ui'

/**
 * Earned autonomy. Penny doesn't ask for trust — she earns it, visibly:
 * approve her drafts untouched and the auto-send option unlocks. Even then,
 * every auto-send waits 15 minutes in the Outbox where one tap cancels it.
 */
export function TrustCard() {
  const { setUser } = useAuth()
  const trust = useLiveData<TrustStats>('/api/trust', ['email'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const stats = trust.data
  if (!stats) return null

  const toggle = async () => {
    setBusy(true)
    setError('')
    try {
      const d = await api<{ user: User }>('/api/auth/autonomy', {
        method: 'PATCH',
        json: { autoSendReminders: !stats.autoSendReminders },
      })
      setUser(d.user)
      trust.refetch()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const pct = Math.min(100, Math.round((stats.clean / stats.cleanNeeded) * 100))

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className={`h-4 w-4 ${stats.eligible ? 'text-brand-600' : 'text-ink-soft'}`} />
        <h3 className="font-semibold">Trust & autonomy</h3>
        {stats.autoSendReminders && (
          <span className="rounded-full bg-brand-100 text-brand-800 px-2 py-0.5 text-[10px] font-bold">AUTO-SEND ON</span>
        )}
      </div>
      <p className="text-xs text-ink-soft mb-3 max-w-xl">
        Penny earns the right to send routine reminders by herself: approve {stats.cleanNeeded} of her drafts untouched
        (skipping resets her progress). Even on auto, every send waits <strong>15 minutes</strong> in the Outbox where
        you can cancel it — and everything stays on the Activity record.
      </p>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="min-w-44">
          <div className="flex justify-between text-[11px] text-ink-soft mb-1">
            <span>
              {stats.clean}/{stats.cleanNeeded} untouched approvals
            </span>
            <span>
              {stats.edited > 0 && `${stats.edited} edited · `}
              {stats.skipped > 0 ? `${stats.skipped} skipped ✗` : 'none skipped ✓'}
            </span>
          </div>
          <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${stats.eligible ? 'bg-brand-500' : 'bg-copper-300'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <button
          className={stats.autoSendReminders ? 'btn-ghost text-sm py-2' : 'btn-primary text-sm py-2'}
          onClick={toggle}
          disabled={busy || (!stats.eligible && !stats.autoSendReminders)}
          title={!stats.eligible && !stats.autoSendReminders ? "She hasn't earned this yet" : undefined}
        >
          {busy ? <Spinner /> : stats.autoSendReminders ? 'Turn auto-send off' : stats.eligible ? 'Let Penny send on her own' : 'Locked — not earned yet'}
        </button>
      </div>
      {error && <p className="text-xs text-danger-600 mt-2">{error}</p>}
    </div>
  )
}

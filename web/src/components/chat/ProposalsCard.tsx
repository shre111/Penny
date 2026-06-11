import { useState } from 'react'
import { CalendarClock, Check, Handshake, X } from 'lucide-react'
import type { Proposal } from '../../lib/types'
import { api } from '../../lib/api'
import { fmtDate, fmtMoney } from '../../lib/format'
import { Spinner } from '../ui'

/**
 * Arrangements a client negotiated with Penny on their invoice page.
 * The owner has the final word — approve applies it to the books.
 */
export function ProposalsCard({ proposals, onHandled }: { proposals: Proposal[]; onHandled: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const act = async (p: Proposal, action: 'approve' | 'decline') => {
    setBusy(p._id)
    setErrors((prev) => ({ ...prev, [p._id]: '' }))
    try {
      await api(`/api/proposals/${p._id}/${action}`, { method: 'POST' })
      setDone((prev) => ({ ...prev, [p._id]: action === 'approve' ? 'approved' : 'declined' }))
      onHandled()
    } catch (err: any) {
      setErrors((prev) => ({ ...prev, [p._id]: err?.message || 'Try again' }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-(--radius-card) border-2 border-copper-300 bg-copper-100/40 overflow-hidden animate-pop-in">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line/70">
        <Handshake className="h-4 w-4 text-copper-600" />
        <p className="font-semibold text-sm">
          {proposals.length === 1 ? 'A client asked for an arrangement' : `${proposals.length} clients asked for arrangements`} — your call
        </p>
      </div>
      <div className="divide-y divide-line/60">
        {proposals.map((p) => {
          const state = done[p._id]
          return (
            <div key={p._id} className={`px-4 py-3 ${state === 'declined' ? 'opacity-60' : ''}`}>
              <p className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                <CalendarClock className="h-3.5 w-3.5 text-copper-600" />
                {p.invoiceId?.number || 'Invoice'}:{' '}
                {p.type === 'extension'
                  ? `extend the due date to ${fmtDate(p.details.newDueDate!)}`
                  : `split into ${p.details.installments?.length} payments`}
                {state && (
                  <span className={`rounded-full px-2 py-px text-[10px] font-bold ${state === 'approved' ? 'bg-brand-700 text-white' : 'bg-stone-200 text-ink-soft'}`}>
                    {state === 'approved' ? 'Approved & applied ✓' : 'Declined'}
                  </span>
                )}
              </p>
              {p.type === 'installments' && (
                <p className="text-xs text-ink-soft mt-1">
                  {p.details.installments?.map((i, idx) => `${idx + 1}) ${fmtMoney(i.amount)} by ${fmtDate(i.date)}`).join(' · ')}
                </p>
              )}
              {p.clientReason && <p className="text-xs text-ink-soft mt-1 italic">“{p.clientReason.slice(0, 160)}”</p>}
              {errors[p._id] && <p className="text-xs text-danger-600 mt-1">{errors[p._id]}</p>}
              {!state && (
                <div className="flex gap-1.5 mt-2.5">
                  <button
                    className="rounded-full px-3 py-1 text-xs font-semibold bg-brand-700 text-white hover:bg-brand-800 cursor-pointer disabled:opacity-50"
                    onClick={() => act(p, 'approve')}
                    disabled={busy !== null}
                  >
                    {busy === p._id ? <Spinner className="h-3 w-3" /> : <Check className="inline h-3 w-3 mr-1" />}
                    Approve — update the invoice
                  </button>
                  <button
                    className="rounded-full px-3 py-1 text-xs font-semibold bg-card border border-line text-ink-soft hover:bg-stone-50 cursor-pointer"
                    onClick={() => act(p, 'decline')}
                    disabled={busy !== null}
                  >
                    <X className="inline h-3 w-3 mr-1" />
                    Decline
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

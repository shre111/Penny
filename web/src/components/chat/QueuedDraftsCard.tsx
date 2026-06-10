import { useState } from 'react'
import { Check, MoonStar, Pencil, X } from 'lucide-react'
import type { EmailRecord } from '../../lib/types'
import { api } from '../../lib/api'
import { Spinner } from '../ui'

/**
 * "While you were away" — drafts the overnight agent queued for approval.
 * Each draft sends / edits / skips individually; nothing moves without a yes.
 */
export function QueuedDraftsCard({ drafts, onHandled }: { drafts: EmailRecord[]; onHandled: () => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({}) // id -> 'sent' | 'skipped'
  const [errors, setErrors] = useState<Record<string, string>>({})

  const fieldsFor = (d: EmailRecord) => edits[d._id] ?? { subject: d.subject, body: d.body }

  const act = async (d: EmailRecord, action: 'approve' | 'dismiss') => {
    setBusy(d._id)
    setErrors((prev) => ({ ...prev, [d._id]: '' }))
    try {
      const payload = action === 'approve' ? { json: fieldsFor(d) } : {}
      const res = await api<{ email: EmailRecord }>(`/api/emails/${d._id}/${action}`, { method: 'POST', ...payload })
      setDone((prev) => ({ ...prev, [d._id]: action === 'approve' ? res.email.status : 'skipped' }))
      onHandled()
    } catch (err: any) {
      // card stays actionable; show why so a retry makes sense
      setErrors((prev) => ({ ...prev, [d._id]: err?.message || 'Something went wrong — try again' }))
    } finally {
      setBusy(null)
      setEditing(null)
    }
  }

  const pending = drafts.filter((d) => !done[d._id])

  return (
    <div className="rounded-(--radius-card) border-2 border-brand-200 bg-brand-50/60 overflow-hidden animate-pop-in">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-brand-100">
        <MoonStar className="h-4 w-4 text-brand-700" />
        <p className="font-semibold text-sm">
          While you were away, Penny drafted {drafts.length} payment reminder{drafts.length === 1 ? '' : 's'} —
          nothing sends without your OK
        </p>
      </div>
      <div className="divide-y divide-brand-100/80">
        {drafts.map((d) => {
          const f = fieldsFor(d)
          const state = done[d._id]
          return (
            <div key={d._id} className={`px-4 py-3 ${state === 'skipped' ? 'opacity-50' : ''}`}>
              <p className="text-xs text-ink-soft mb-0.5">
                To: <span className="font-semibold text-ink">{d.to}</span>
                {state && (
                  <span className={`ml-2 rounded-full px-2 py-px text-[10px] font-bold ${state === 'skipped' ? 'bg-stone-200 text-ink-soft' : 'bg-brand-700 text-white'}`}>
                    {state === 'skipped' ? 'Skipped' : state === 'sent' ? 'Sent via Gmail ✓' : 'Saved to outbox ✓'}
                  </span>
                )}
              </p>
              {editing === d._id ? (
                <div className="space-y-2 mt-2">
                  <input
                    className="input text-sm py-2"
                    value={f.subject}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [d._id]: { ...f, subject: e.target.value } }))}
                  />
                  <textarea
                    className="input text-sm py-2 min-h-32 resize-y"
                    value={f.body}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [d._id]: { ...f, body: e.target.value } }))}
                  />
                </div>
              ) : (
                <>
                  <p className="font-semibold text-sm">{f.subject}</p>
                  {!state && (
                    <pre className="whitespace-pre-wrap font-sans text-[13px] text-ink-soft mt-1 max-h-36 overflow-y-auto">{f.body}</pre>
                  )}
                </>
              )}
              {errors[d._id] && !state && (
                <p className="text-xs text-danger-600 mt-1.5">{errors[d._id]}</p>
              )}
              {!state && (
                <div className="flex gap-1.5 mt-2.5">
                  <button
                    className="rounded-full px-3 py-1 text-xs font-semibold bg-brand-700 text-white hover:bg-brand-800 cursor-pointer disabled:opacity-50"
                    onClick={() => act(d, 'approve')}
                    disabled={busy !== null}
                  >
                    {busy === d._id ? <Spinner className="h-3 w-3" /> : <Check className="inline h-3 w-3 mr-1" />}
                    {editing === d._id ? 'Send edited' : 'Send'}
                  </button>
                  <button
                    className="rounded-full px-3 py-1 text-xs font-semibold bg-card border border-line text-ink-soft hover:bg-stone-50 cursor-pointer"
                    onClick={() => setEditing(editing === d._id ? null : d._id)}
                    disabled={busy !== null}
                  >
                    <Pencil className="inline h-3 w-3 mr-1" />
                    {editing === d._id ? 'Preview' : 'Edit first'}
                  </button>
                  <button
                    className="rounded-full px-3 py-1 text-xs font-semibold bg-card border border-line text-ink-soft hover:bg-stone-50 cursor-pointer"
                    onClick={() => act(d, 'dismiss')}
                    disabled={busy !== null}
                  >
                    <X className="inline h-3 w-3 mr-1" />
                    Skip
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {pending.length === 0 && (
        <p className="px-4 py-2.5 text-xs text-brand-800 bg-brand-100/60 font-medium">All handled — nice work. ✓</p>
      )}
    </div>
  )
}

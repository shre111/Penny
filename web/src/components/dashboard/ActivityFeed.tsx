import { useState } from 'react'
import { FileText, History, Mail, RotateCcw, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { CoinMark, EmptyState, Spinner } from '../ui'

interface ActivityItem {
  _id: string
  entity: string
  action: string
  summary: string
  actor: 'user' | 'agent' | 'service'
  undo?: { type: string }
  undoneAt?: string
  createdAt: string
}

const ENTITY_ICON: Record<string, React.ReactNode> = {
  invoice: <FileText className="h-4 w-4" />,
  client: <Users className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/**
 * The audit trail: every change with who made it (you vs Penny) and when —
 * with Undo on the agent's creations. "What did Penny do while I was out?"
 */
export function ActivityFeed({ activities, refetch }: { activities: ActivityItem[]; refetch: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const undo = async (a: ActivityItem) => {
    setBusy(a._id)
    setErrors((prev) => ({ ...prev, [a._id]: '' }))
    try {
      await api(`/api/activities/${a._id}/undo`, { method: 'POST' })
      refetch()
    } catch (err: any) {
      setErrors((prev) => ({ ...prev, [a._id]: err.message }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card overflow-hidden">
      <h3 className="font-semibold px-4 pt-4 pb-1">Recent activity</h3>
      <p className="text-xs text-ink-soft px-4 pb-3">
        Everything that changed in your books — by you or by Penny. Agent actions can be undone.
      </p>
      {activities.length === 0 ? (
        <EmptyState icon={<History className="h-8 w-8" />} title="Nothing yet">
          Changes you or Penny make will show up here, newest first.
        </EmptyState>
      ) : (
        <ul>
          {activities.map((a) => (
            <li key={a._id} className="flex items-center gap-3 px-4 py-2.5 border-t border-line/60">
              <span className={`shrink-0 rounded-lg p-1.5 ${a.actor === 'agent' ? 'bg-copper-100 text-copper-600' : 'bg-stone-100 text-ink-soft'}`}>
                {ENTITY_ICON[a.entity] || <History className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm truncate ${a.undoneAt ? 'line-through text-ink-soft/60' : ''}`}>{a.summary}</p>
                <p className="text-[11px] text-ink-soft/80 flex items-center gap-1.5">
                  {a.actor === 'agent' ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-copper-600">
                      <CoinMark size={12} /> Penny
                    </span>
                  ) : (
                    'You'
                  )}
                  · {timeAgo(a.createdAt)}
                  {a.undoneAt && ' · undone'}
                  {errors[a._id] && <span className="text-danger-600 font-medium">· {errors[a._id]}</span>}
                </p>
              </div>
              {a.undo && !a.undoneAt && (
                <button
                  className="btn-ghost text-xs py-1 px-2.5 shrink-0"
                  onClick={() => undo(a)}
                  disabled={busy !== null}
                >
                  {busy === a._id ? <Spinner className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
                  Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

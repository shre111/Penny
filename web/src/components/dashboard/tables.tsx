import { useState } from 'react'
import { BellRing, Camera, ChevronDown, FileDown, FileText, Mail, MessageCircle, MoonStar } from 'lucide-react'
import type { Client, EmailRecord, Invoice } from '../../lib/types'
import { dueLabel, fmtDate, fmtMoney, STATUS_LABELS, STATUS_STYLES } from '../../lib/format'
import { askPenny } from '../../lib/askPenny'
import { api } from '../../lib/api'
import { EmptyState, Spinner } from '../ui'

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_STYLES[status] || ''}`}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

const SOURCE_BADGE: Record<string, { label: string; icon: React.ReactNode }> = {
  chat: { label: 'via chat', icon: null },
  document: { label: 'from photo', icon: <Camera className="h-3 w-3" /> },
}

export function InvoiceTable({ invoices, highlights }: { invoices: Invoice[]; highlights: Set<string> }) {
  const [filter, setFilter] = useState<'all' | 'overdue' | 'open' | 'paid' | 'draft'>('all')
  // urgency first: overdue (latest first), then awaiting by due date, drafts, then paid history
  const URGENCY: Record<string, number> = { overdue: 0, sent: 1, draft: 2, void: 3, paid: 4 }
  const filtered = invoices
    .filter((i) => {
      if (filter === 'all') return true
      if (filter === 'open') return i.effectiveStatus === 'sent'
      return i.effectiveStatus === filter
    })
    .sort((a, b) => {
      const ua = URGENCY[a.effectiveStatus] ?? 9
      const ub = URGENCY[b.effectiveStatus] ?? 9
      if (ua !== ub) return ua - ub
      if (a.effectiveStatus === 'overdue') return (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0)
      if (a.effectiveStatus === 'paid') return new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    })
  const filters: { key: typeof filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'open', label: 'Awaiting' },
    { key: 'paid', label: 'Paid' },
    { key: 'draft', label: 'Drafts' },
  ]
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3 flex-wrap">
        <h3 className="font-semibold">Invoices</h3>
        <div className="flex gap-1.5 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                filter === f.key ? 'bg-brand-700 text-white' : 'bg-stone-100 text-ink-soft hover:bg-stone-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={<FileText className="h-8 w-8" />} title="No invoices here yet">
          Ask Penny to log one — try “Log an invoice for Acme, $450, due next Friday”.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-soft border-y border-line bg-paper/60">
                <th className="px-4 py-2.5 font-semibold">Invoice</th>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold text-right">Amount</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold text-right">Due</th>
                <th className="px-4 py-2.5" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr
                  key={inv._id}
                  className={`group border-b border-line/60 last:border-0 hover:bg-paper/50 transition-colors ${
                    highlights.has(inv._id) ? 'animate-glow' : ''
                  }`}
                >
                  <td className="px-4 py-3 font-semibold whitespace-nowrap">
                    {inv.number}
                    {SOURCE_BADGE[inv.source] && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-copper-100 text-copper-700 px-2 py-0.5 text-[10px] font-semibold align-middle">
                        {SOURCE_BADGE[inv.source].icon}
                        {SOURCE_BADGE[inv.source].label}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{inv.clientId?.name || '—'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <span className="font-semibold">{fmtMoney(inv.balance > 0 ? inv.balance : inv.amount)}</span>
                    {inv.amountPaid > 0 && inv.balance > 0 && (
                      <span className="block text-[11px] text-ink-soft">of {fmtMoney(inv.amount)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><StatusPill status={inv.effectiveStatus} /></td>
                  <td className={`px-4 py-3 text-right whitespace-nowrap text-xs ${inv.effectiveStatus === 'overdue' ? 'text-danger-600 font-semibold' : 'text-ink-soft'}`}>
                    {dueLabel(inv)}
                    <span className="block text-[11px] text-ink-soft/70">{fmtDate(inv.dueDate)}</span>
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap text-right">
                    <span className="inline-flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="p-1.5 rounded-lg text-ink-soft hover:text-brand-700 hover:bg-brand-50 cursor-pointer"
                        title={`Ask Penny about ${inv.number}`}
                        aria-label={`Ask Penny about ${inv.number}`}
                        onClick={() => askPenny(`Tell me about invoice ${inv.number} — where it stands and what you'd do next.`)}
                      >
                        <MessageCircle className="h-4 w-4" />
                      </button>
                      {inv.effectiveStatus === 'overdue' && (
                        <button
                          className="p-1.5 rounded-lg text-ink-soft hover:text-copper-600 hover:bg-copper-100 cursor-pointer"
                          title={`Have Penny chase ${inv.number}`}
                          aria-label={`Have Penny chase ${inv.number}`}
                          onClick={() => askPenny(`Draft a payment reminder for invoice ${inv.number}.`)}
                        >
                          <BellRing className="h-4 w-4" />
                        </button>
                      )}
                      <a
                        className="p-1.5 rounded-lg text-ink-soft hover:text-brand-700 hover:bg-brand-50 cursor-pointer"
                        title={`Download ${inv.number} as PDF`}
                        aria-label={`Download ${inv.number} as PDF`}
                        href={`/api/invoices/${inv._id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <FileDown className="h-4 w-4" />
                      </a>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function ClientsTable({ clients, highlights }: { clients: Client[]; highlights: Set<string> }) {
  return (
    <div className="card overflow-hidden">
      <h3 className="font-semibold px-4 pt-4 pb-3">Clients</h3>
      {clients.length === 0 ? (
        <EmptyState title="No clients yet">Tell Penny about your first client and she'll set them up.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-soft border-y border-line bg-paper/60">
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Contact</th>
                <th className="px-4 py-2.5 font-semibold">Email</th>
                <th className="px-4 py-2.5 font-semibold">Phone</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c._id} className={`border-b border-line/60 last:border-0 hover:bg-paper/50 ${highlights.has(c._id) ? 'animate-glow' : ''}`}>
                  <td className="px-4 py-3 font-semibold">{c.name}</td>
                  <td className="px-4 py-3">{c.contactName || '—'}</td>
                  <td className="px-4 py-3 text-ink-soft">{c.email || '—'}</td>
                  <td className="px-4 py-3 text-ink-soft">{c.phone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const EMAIL_PILL: Record<string, { label: string; cls: string }> = {
  sent: { label: 'Sent via Gmail', cls: 'bg-brand-100 text-brand-800' },
  simulated: { label: 'Saved (not sent)', cls: 'bg-stone-100 text-ink-soft' },
  queued: { label: 'Waiting for your OK', cls: 'bg-copper-100 text-copper-700' },
  dismissed: { label: 'Skipped', cls: 'bg-stone-100 text-ink-soft/70' },
  failed: { label: 'Failed', cls: 'bg-red-50 text-danger-600' },
}

export function Outbox({ emails, highlights }: { emails: EmailRecord[]; highlights: Set<string> }) {
  const [open, setOpen] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState('')

  const runOvernight = async () => {
    setRunning(true)
    setRunResult('')
    try {
      const r = await api<{ queued: number; skipped: number }>('/api/overnight/run', { method: 'POST' })
      setRunResult(
        r.queued > 0
          ? `Queued ${r.queued} new draft${r.queued === 1 ? '' : 's'} — review them in the chat`
          : 'Nothing new to chase — everyone is either current or recently reminded'
      )
    } catch (err: any) {
      setRunResult(err.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-1">
        <div>
          <h3 className="font-semibold">Outbox</h3>
          <p className="text-xs text-ink-soft pb-2">Every email Penny has drafted or sent for you</p>
        </div>
        <div className="text-right">
          <button className="btn-ghost text-xs py-1.5 px-3" onClick={runOvernight} disabled={running}>
            {running ? <Spinner className="h-3.5 w-3.5" /> : <MoonStar className="h-3.5 w-3.5" />}
            Run the overnight check now
          </button>
          <p className="text-[10.5px] text-ink-soft/70 mt-1">runs by itself every morning at 6:00</p>
          {runResult && <p className="text-[11px] text-brand-700 font-medium mt-0.5 max-w-56">{runResult}</p>}
        </div>
      </div>
      {emails.length === 0 ? (
        <EmptyState icon={<Mail className="h-8 w-8" />} title="Nothing sent yet">
          Try “Chase my overdue invoices” — you'll approve every email before it goes anywhere.
        </EmptyState>
      ) : (
        <ul>
          {emails.map((e) => (
            <li key={e._id} className={`border-t border-line/60 ${highlights.has(e._id) ? 'animate-glow' : ''}`}>
              <button
                className="w-full text-left px-4 py-3 hover:bg-paper/50 cursor-pointer"
                onClick={() => setOpen(open === e._id ? null : e._id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{e.subject}</p>
                    <p className="text-xs text-ink-soft truncate">to {e.to} · {fmtDate(e.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${(EMAIL_PILL[e.status] || EMAIL_PILL.simulated).cls}`}>
                      {(EMAIL_PILL[e.status] || EMAIL_PILL.simulated).label}
                    </span>
                    <ChevronDown className={`h-4 w-4 text-ink-soft transition-transform ${open === e._id ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </button>
              {open === e._id && (
                <pre className="whitespace-pre-wrap font-sans text-sm text-ink-soft bg-paper/60 border-t border-line/60 px-4 py-3">{e.body}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

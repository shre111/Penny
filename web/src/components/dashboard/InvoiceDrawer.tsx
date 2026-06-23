import { useEffect, useState } from 'react'
import { BellRing, FileDown, Link2, Lock, MessageCircle, X } from 'lucide-react'
import { api } from '../../lib/api'
import { askPenny } from '../../lib/askPenny'
import { dueLabel, fmtDate, fmtMoney, STATUS_LABELS, STATUS_STYLES } from '../../lib/format'
import type { EmailRecord, Invoice, Proposal } from '../../lib/types'
import { CoinMark, Spinner } from '../ui'

/** The full story of one invoice: numbers, plan, reminders, requests, history. */
export function InvoiceDrawer({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const [emails, setEmails] = useState<EmailRecord[] | null>(null)
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [activities, setActivities] = useState<any[] | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [sharePin, setSharePin] = useState('')
  const [shareMsg, setShareMsg] = useState('')
  const [sharing, setSharing] = useState(false)
  const [pinProtected, setPinProtected] = useState(Boolean(invoice.sharePinProtected))

  const share = async (pin?: string) => {
    setSharing(true)
    setShareMsg('')
    try {
      const r = await api<{ url: string; pinProtected: boolean }>(`/api/invoices/${invoice._id}/share`, {
        method: 'POST',
        json: pin === undefined ? {} : { pin },
      })
      setPinProtected(r.pinProtected)
      if (pin === '') {
        setShareMsg('PIN removed.')
        return
      }
      await navigator.clipboard.writeText(`${window.location.origin}${r.url}`).catch(() => {})
      setShareMsg(
        r.pinProtected
          ? 'Link copied — PIN-protected. Share the PIN with your client separately.'
          : 'Link copied to clipboard.'
      )
    } catch (e: any) {
      setShareMsg(e?.message || 'Could not create the link')
    } finally {
      setSharing(false)
    }
  }

  useEffect(() => {
    api<{ emails: EmailRecord[] }>(`/api/emails?invoiceId=${invoice._id}`).then((d) => setEmails(d.emails)).catch(() => setEmails([]))
    api<{ proposals: Proposal[] }>(`/api/proposals?invoiceId=${invoice._id}`).then((d) => setProposals(d.proposals)).catch(() => setProposals([]))
    api<{ activities: any[] }>(`/api/activities?entityId=${invoice._id}`).then((d) => setActivities(d.activities)).catch(() => setActivities([]))
  }, [invoice._id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-label={`Invoice ${invoice.number}`}>
      <button className="absolute inset-0 bg-ink/30 cursor-default" onClick={onClose} aria-label="Close" />
      <aside className="absolute right-0 inset-y-0 w-full sm:w-[460px] bg-card border-l border-line shadow-2xl overflow-y-auto animate-fade-up">
        <header className="sticky top-0 bg-card border-b border-line px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-xl font-semibold">{invoice.number}</p>
            <p className="text-sm text-ink-soft">{invoice.clientId?.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[invoice.effectiveStatus] || ''}`}>
              {STATUS_LABELS[invoice.effectiveStatus] || invoice.effectiveStatus}
            </span>
            <button className="p-1.5 text-ink-soft hover:text-ink cursor-pointer" onClick={onClose} aria-label="Close drawer">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="px-5 py-4 space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink-soft">Amount</p>
              <p className="font-bold text-lg">{fmtMoney(invoice.amount)}</p>
              {invoice.amountPaid > 0 && <p className="text-xs text-ink-soft">paid {fmtMoney(invoice.amountPaid)} · owed {fmtMoney(invoice.balance)}</p>}
            </div>
            <div>
              <p className="text-xs text-ink-soft">Due</p>
              <p className="font-semibold">{fmtDate(invoice.dueDate)}</p>
              <p className={`text-xs ${invoice.effectiveStatus === 'overdue' ? 'text-danger-600 font-semibold' : 'text-ink-soft'}`}>{dueLabel(invoice)}</p>
            </div>
          </div>

          {invoice.promisedDate && invoice.balance > 0 && (
            <p className="rounded-xl bg-brand-50 border border-brand-200 text-brand-800 text-sm px-3.5 py-2">
              🤝 Client promised payment by <strong>{fmtDate(invoice.promisedDate)}</strong>
              {invoice.promiseNote && <span className="block text-xs text-ink-soft mt-0.5">“{invoice.promiseNote.slice(0, 120)}”</span>}
            </p>
          )}
          {invoice.installmentPlan && invoice.installmentPlan.length > 0 && (
            <div className="rounded-xl bg-copper-100/50 border border-copper-300 text-sm px-3.5 py-2">
              <p className="font-semibold text-xs mb-1">Agreed payment plan</p>
              {invoice.installmentPlan.map((p, i) => (
                <p key={i} className="text-ink-soft text-xs">{i + 1}. {fmtMoney(p.amount)} by {fmtDate(p.date)}</p>
              ))}
            </div>
          )}

          {(invoice.lineItems?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">Line items</p>
              <ul className="text-sm divide-y divide-line/50">
                {invoice.lineItems.map((li, i) => (
                  <li key={i} className="py-1.5 flex justify-between gap-3">
                    <span className="min-w-0 truncate">{li.description}</span>
                    <span className="shrink-0 text-ink-soft">{li.quantity} × {fmtMoney(li.unitPrice)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-1.5 flex-wrap">
            <button className="btn-ghost text-xs py-1.5" onClick={() => { askPenny(`Tell me about invoice ${invoice.number} — where it stands and what you'd do next.`); onClose() }}>
              <MessageCircle className="h-3.5 w-3.5" /> Ask Penny
            </button>
            {invoice.effectiveStatus === 'overdue' && (
              <button className="btn-ghost text-xs py-1.5" onClick={() => { askPenny(`Draft a payment reminder for invoice ${invoice.number}.`); onClose() }}>
                <BellRing className="h-3.5 w-3.5" /> Chase
              </button>
            )}
            <a className="btn-ghost text-xs py-1.5" href={`/api/invoices/${invoice._id}/pdf`} target="_blank" rel="noreferrer">
              <FileDown className="h-3.5 w-3.5" /> PDF
            </a>
            <button className="btn-ghost text-xs py-1.5" onClick={() => setShareOpen((o) => !o)}>
              <Link2 className="h-3.5 w-3.5" /> Client link
              {pinProtected && <Lock className="h-3 w-3 text-copper-600" />}
            </button>
          </div>

          {shareOpen && (
            <div className="rounded-xl border border-line/60 p-3 space-y-2.5">
              <p className="text-xs text-ink-soft">
                Share a private link to this invoice. Add an optional PIN for a second layer — your client enters it
                to open the page.
              </p>
              <div className="flex gap-2">
                <input
                  className="input py-1.5 text-sm flex-1"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="Optional PIN (4–8 digits)"
                  value={sharePin}
                  onChange={(e) => setSharePin(e.target.value.replace(/\D/g, ''))}
                  aria-label="Optional PIN"
                />
                <button className="btn-primary text-sm py-1.5" onClick={() => share(sharePin)} disabled={sharing}>
                  {sharing ? <Spinner /> : 'Copy link'}
                </button>
              </div>
              {pinProtected && (
                <button className="text-xs text-ink-soft hover:text-danger-500 cursor-pointer" onClick={() => share('')} disabled={sharing}>
                  Remove PIN protection
                </button>
              )}
              {shareMsg && <p className="text-xs font-medium text-brand-700">{shareMsg}</p>}
            </div>
          )}

          <Section title="Reminders & emails" empty="No emails about this invoice yet" items={emails} render={(e: EmailRecord) => (
            <li key={e._id} className="py-2">
              <p className="text-sm font-medium truncate">{e.subject}</p>
              <p className="text-[11px] text-ink-soft">{e.status} · {fmtDate(e.createdAt)}</p>
            </li>
          )} />

          <Section title="Client requests" empty="No arrangement requests" items={proposals} render={(p: Proposal) => (
            <li key={p._id} className="py-2">
              <p className="text-sm font-medium">{p.type === 'extension' ? `Extension to ${p.details.newDueDate ? fmtDate(p.details.newDueDate) : '—'}` : `${p.details.installments?.length}-part plan`}</p>
              <p className="text-[11px] text-ink-soft">{p.status} · {fmtDate(p.createdAt)}</p>
            </li>
          )} />

          <Section title="History" empty="No recorded activity" items={activities} render={(a: any) => (
            <li key={a._id} className="py-2 flex items-start gap-2">
              {a.actor === 'agent' ? <CoinMark size={16} /> : <span className="h-4 w-4 rounded-full bg-stone-200 inline-block shrink-0 mt-0.5" />}
              <div className="min-w-0">
                <p className="text-[13px] leading-snug">{a.summary}</p>
                <p className="text-[11px] text-ink-soft">{fmtDate(a.createdAt)}</p>
              </div>
            </li>
          )} />
        </div>
      </aside>
    </div>
  )
}

function Section<T>({ title, empty, items, render }: { title: string; empty: string; items: T[] | null; render: (item: T) => React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">{title}</p>
      {items === null ? (
        <Spinner className="h-4 w-4 text-ink-soft" />
      ) : items.length === 0 ? (
        <p className="text-xs text-ink-soft/70">{empty}</p>
      ) : (
        <ul className="divide-y divide-line/50">{items.map(render)}</ul>
      )}
    </div>
  )
}

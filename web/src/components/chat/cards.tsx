import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell } from 'recharts'
import { Check, Mail, Pencil, X, FileCheck } from 'lucide-react'
import type { InterruptAction } from '../../lib/types'
import { fmtMoney } from '../../lib/format'
import { api } from '../../lib/api'
import { Spinner } from '../ui'
import { useChartColors } from '../../lib/theme'
import { useTooltipStyle } from '../dashboard/widgets'

const AGING_COLORS = ['#3a8c61', '#b88323', '#c2543e', '#82492a']

/** Charts the agent asked to show (make_chart tool result). */
export function ChartCard({ data }: { data: { kind: string; title: string; data: any[] } }) {
  const c = useChartColors()
  const tooltip = useTooltipStyle()
  return (
    <div className="card p-4 mt-2 animate-pop-in">
      <h4 className="font-semibold text-sm mb-3">{data.title}</h4>
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={data.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: c.tick }} axisLine={false} tickLine={false} interval={0} />
          <YAxis tickFormatter={(v) => `$${v >= 1000 ? `${v / 1000}k` : v}`} tick={{ fontSize: 10.5, fill: c.tick }} axisLine={false} tickLine={false} width={42} />
          <Tooltip formatter={(v) => fmtMoney(Number(v))} {...tooltip} />
          {data.kind === 'cashflow' ? (
            <>
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="billed" name="Billed" fill="#bcdfc9" radius={[5, 5, 0, 0]} maxBarSize={22} />
              <Bar dataKey="collected" name="Collected" fill="#2a7350" radius={[5, 5, 0, 0]} maxBarSize={22} />
            </>
          ) : data.kind === 'forecast' ? (
            <Bar dataKey="value" name="Expected" fill="#5ba980" radius={[5, 5, 0, 0]} maxBarSize={30} />
          ) : (
            <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={48}>
              {data.data.map((_: any, i: number) => (
                <Cell key={i} fill={AGING_COLORS[i % AGING_COLORS.length]} />
              ))}
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Compact invoice list the agent looked up. */
export function InvoiceListCard({ data }: { data: { invoices: any[] } }) {
  return (
    <div className="card mt-2 overflow-hidden animate-pop-in">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] text-ink-soft border-b border-line bg-paper/60">
            <th className="px-3 py-2 font-semibold">Invoice</th>
            <th className="px-3 py-2 font-semibold">Client</th>
            <th className="px-3 py-2 font-semibold text-right">Owed</th>
            <th className="px-3 py-2 font-semibold text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.invoices.map((inv) => (
            <tr key={inv.number} className="border-b border-line/50 last:border-0">
              <td className="px-3 py-2 font-semibold whitespace-nowrap">{inv.number}</td>
              <td className="px-3 py-2">{inv.client}</td>
              <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">{fmtMoney(inv.balance ?? inv.amount)}</td>
              <td className={`px-3 py-2 text-right text-xs whitespace-nowrap ${inv.status === 'overdue' ? 'text-danger-600 font-semibold' : 'text-ink-soft'}`}>
                {inv.status === 'overdue' ? `${inv.days_overdue}d late` : inv.status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface EmailDecision {
  choice: 'approve' | 'reject' | 'edit'
  subject: string
  body: string
}

/**
 * The HITL card: Penny paused before sending email(s). The owner approves,
 * edits, or skips each one — nothing leaves the building without a yes.
 */
export function ApprovalCard({
  actions,
  status,
  resolvedNote,
  onResolve,
}: {
  actions: InterruptAction[]
  status: 'pending' | 'resolved'
  resolvedNote?: string
  onResolve: (decisions: any[]) => void
}) {
  const [decisions, setDecisions] = useState<EmailDecision[]>(
    actions.map((a) => ({ choice: 'approve', subject: a.args.subject || '', body: a.args.body || '' }))
  )
  const [editing, setEditing] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const resolved = status === 'resolved'
  const approvedCount = decisions.filter((d) => d.choice !== 'reject').length

  const setChoice = (i: number, choice: EmailDecision['choice']) =>
    setDecisions((prev) => prev.map((d, idx) => (idx === i ? { ...d, choice } : d)))

  const submit = () => {
    setSubmitting(true)
    const payload = actions.map((a, i) => {
      const d = decisions[i]
      if (d.choice === 'reject') {
        return { type: 'reject', message: 'The owner chose not to send this email.' }
      }
      const edited = d.subject !== (a.args.subject || '') || d.body !== (a.args.body || '')
      if (edited) {
        return { type: 'edit', edited_action: { name: a.tool, args: { ...a.args, subject: d.subject, body: d.body } } }
      }
      return { type: 'approve' }
    })
    onResolve(payload)
  }

  return (
    <div className={`mt-2 rounded-(--radius-card) border-2 ${resolved ? 'border-line bg-paper/50' : 'border-copper-300 bg-copper-100/40'} overflow-hidden animate-pop-in`}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line/70">
        <Mail className="h-4 w-4 text-copper-600" />
        <p className="font-semibold text-sm">
          {resolved
            ? resolvedNote || 'Handled'
            : actions.length === 1
              ? 'Penny wants to send this email — okay?'
              : `Penny prepared ${actions.length} emails — review before they go out`}
        </p>
      </div>
      <div className="divide-y divide-line/60">
        {actions.map((a, i) => (
          <div key={a.id ?? i} className={`px-4 py-3 ${decisions[i].choice === 'reject' ? 'opacity-50' : ''}`}>
            <p className="text-xs text-ink-soft mb-0.5">
              To: <span className="font-semibold text-ink">{a.args.to}</span>
            </p>
            {editing === i ? (
              <div className="space-y-2 mt-2">
                <input
                  className="input text-sm py-2"
                  value={decisions[i].subject}
                  onChange={(e) => setDecisions((prev) => prev.map((d, idx) => (idx === i ? { ...d, subject: e.target.value } : d)))}
                />
                <textarea
                  className="input text-sm py-2 min-h-36 resize-y"
                  value={decisions[i].body}
                  onChange={(e) => setDecisions((prev) => prev.map((d, idx) => (idx === i ? { ...d, body: e.target.value } : d)))}
                />
                <button className="btn-ghost text-xs py-1.5 px-3" onClick={() => setEditing(null)}>
                  <Check className="h-3.5 w-3.5" /> Done editing
                </button>
              </div>
            ) : (
              <>
                <p className="font-semibold text-sm">{decisions[i].subject}</p>
                <pre className="whitespace-pre-wrap font-sans text-[13px] text-ink-soft mt-1 max-h-40 overflow-y-auto">{decisions[i].body}</pre>
              </>
            )}
            {!resolved && editing !== i && (
              <div className="flex gap-1.5 mt-2.5">
                <button
                  className={`rounded-full px-3 py-1 text-xs font-semibold cursor-pointer transition-colors ${decisions[i].choice !== 'reject' ? 'bg-brand-700 text-white' : 'bg-stone-100 text-ink-soft'}`}
                  onClick={() => setChoice(i, 'approve')}
                >
                  <Check className="inline h-3 w-3 mr-1" />Send
                </button>
                <button
                  className="rounded-full px-3 py-1 text-xs font-semibold bg-stone-100 text-ink-soft hover:bg-stone-200 cursor-pointer"
                  onClick={() => setEditing(i)}
                >
                  <Pencil className="inline h-3 w-3 mr-1" />Edit first
                </button>
                <button
                  className={`rounded-full px-3 py-1 text-xs font-semibold cursor-pointer transition-colors ${decisions[i].choice === 'reject' ? 'bg-danger-500 text-white' : 'bg-stone-100 text-ink-soft hover:bg-stone-200'}`}
                  onClick={() => setChoice(i, decisions[i].choice === 'reject' ? 'approve' : 'reject')}
                >
                  <X className="inline h-3 w-3 mr-1" />{decisions[i].choice === 'reject' ? 'Skipped' : 'Skip'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {!resolved && (
        <div className="px-4 py-3 bg-card/60 border-t border-line/70">
          <button className="btn-copper w-full text-sm" onClick={submit} disabled={submitting || editing !== null}>
            {submitting ? <Spinner /> : approvedCount === 0 ? 'Don’t send anything' : `Confirm (${approvedCount} of ${actions.length} will send)`}
          </button>
        </div>
      )}
    </div>
  )
}

/** Document extraction proposal → confirm to create the invoice. */
export function ExtractionCard({
  data,
  onAdded,
}: {
  data: any
  onAdded: (patch: Record<string, any>) => void
}) {
  const [fields, setFields] = useState({
    clientName: data.client_name || '',
    amount: data.amount || 0,
    dueDate: (data.due_date || '').slice(0, 10),
    notes: data.notes || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const added = data.status === 'added'

  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await api<{ invoice: any }>('/api/invoices', {
        method: 'POST',
        json: {
          clientName: fields.clientName,
          amount: Number(fields.amount),
          dueDate: fields.dueDate,
          notes: fields.notes,
          lineItems: data.line_items || [],
          source: 'document',
        },
      })
      onAdded({ status: 'added', invoiceNumber: res.invoice.number })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`mt-2 rounded-(--radius-card) border-2 ${added ? 'border-brand-200 bg-brand-50/50' : 'border-copper-300 bg-copper-100/40'} px-4 py-3 animate-pop-in`}>
      <div className="flex items-center gap-2 mb-2">
        <FileCheck className="h-4 w-4 text-copper-600" />
        <p className="font-semibold text-sm">{added ? `Added to your books as ${data.invoiceNumber} ✓` : `Here's what I read${data.fileName ? ` from ${data.fileName}` : ''}`}</p>
        {!added && data.confidence && data.confidence !== 'high' && (
          <span className="text-[11px] rounded-full bg-amber-50 text-amber-flag border border-amber-200 px-2 py-0.5 font-semibold">worth double-checking</span>
        )}
      </div>
      {!added && (
        <>
          <div className="grid sm:grid-cols-2 gap-2.5 mb-2">
            <div>
              <label className="label text-xs">Client</label>
              <input className="input py-2 text-sm" value={fields.clientName} onChange={(e) => setFields((f) => ({ ...f, clientName: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">Amount</label>
              <input className="input py-2 text-sm" type="number" step="0.01" value={fields.amount} onChange={(e) => setFields((f) => ({ ...f, amount: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="label text-xs">Due date {!fields.dueDate && <span className="text-amber-flag">(couldn't read it — pick one)</span>}</label>
              <input className="input py-2 text-sm" type="date" value={fields.dueDate} onChange={(e) => setFields((f) => ({ ...f, dueDate: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">Notes</label>
              <input className="input py-2 text-sm" value={fields.notes} onChange={(e) => setFields((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          {(data.line_items?.length ?? 0) > 0 && (
            <ul className="text-xs text-ink-soft mb-2 space-y-0.5">
              {data.line_items.map((li: any, i: number) => (
                <li key={i}>· {li.description} — {li.quantity} × {fmtMoney(li.unitPrice)}</li>
              ))}
            </ul>
          )}
          {error && <p className="text-xs text-danger-600 mb-2">{error}</p>}
          <button className="btn-copper w-full text-sm" onClick={confirm} disabled={busy || !fields.clientName || !fields.amount || !fields.dueDate}>
            {busy ? <Spinner /> : 'Looks right — add to my books'}
          </button>
        </>
      )}
    </div>
  )
}

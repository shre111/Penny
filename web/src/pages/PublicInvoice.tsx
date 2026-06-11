import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileDown, SendHorizonal } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../lib/api'
import { dueLabel, fmtDate, fmtMoney, STATUS_LABELS, STATUS_STYLES } from '../lib/format'
import { CoinMark, Spinner, Wordmark } from '../components/ui'
import type { ActivityEvent } from '../lib/types'

interface PublicInvoiceData {
  number: string
  businessName: string
  clientName: string
  lineItems: { description: string; quantity: number; unitPrice: number }[]
  amount: number
  amountPaid: number
  balance: number
  currency: string
  issueDate: string
  dueDate: string
  status: string
  promisedDate: string | null
  installmentPlan: { amount: number; date: string }[] | null
  conciergeEnabled: boolean
}

interface ConciergeMessage {
  role: 'user' | 'assistant'
  content: string
  events: ActivityEvent[]
}

const CHIPS = ['What is this invoice for?', 'Send me the PDF', "I'll pay it by next Friday", 'Could I split this in two?']

function visitorId(): string {
  let id = sessionStorage.getItem('penny:visitor')
  if (!id) {
    id = Math.random().toString(36).slice(2, 12)
    sessionStorage.setItem('penny:visitor', id)
  }
  return id
}

/** The public, tokenized invoice page — where YOUR client meets YOUR Penny. */
export default function PublicInvoice() {
  const { token } = useParams()
  const [invoice, setInvoice] = useState<PublicInvoiceData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [messages, setMessages] = useState<ConciergeMessage[]>([])
  const [streaming, setStreaming] = useState<ConciergeMessage | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const refreshInvoice = () => {
    api<{ invoice: PublicInvoiceData }>(`/api/public/invoice/${token}`)
      .then((d) => setInvoice(d.invoice))
      .catch(() => setNotFound(true))
  }
  useEffect(refreshInvoice, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  const send = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || busy) return
    setInput('')
    setBusy(true)
    setMessages((prev) => [...prev, { role: 'user', content, events: [] }])
    const acc: ConciergeMessage = { role: 'assistant', content: '', events: [] }
    setStreaming({ ...acc })
    try {
      const res = await fetch(`/api/public/invoice/${token}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, visitorId: visitorId() }),
      })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || 'Penny stepped away — try again in a moment')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let sep
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          const eventLine = frame.split('\n').find((l) => l.startsWith('event: '))
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
          if (!eventLine || !dataLine) continue
          try {
            const event = eventLine.slice(7).trim()
            const data = JSON.parse(dataLine.slice(6))
            if (event === 'token') acc.content += data.text || ''
            else if (event === 'activity') {
              const existing = acc.events.find((e) => e.id === data.id)
              if (existing) Object.assign(existing, data)
              else acc.events.push(data)
            } else if (event === 'error' && !acc.content) acc.content = data.message || 'Something went wrong.'
            setStreaming({ ...acc, events: [...acc.events] })
          } catch {
            /* skip bad frame */
          }
        }
      }
      setMessages((prev) => [...prev, acc])
      refreshInvoice() // promises / arrangements may have changed what's shown
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: 'assistant', content: err?.message || 'Please try again.', events: [] }])
    } finally {
      setStreaming(null)
      setBusy(false)
    }
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-6">
        <CoinMark size={44} />
        <h1 className="font-display text-2xl">This invoice link isn't valid</h1>
        <p className="text-ink-soft text-sm max-w-sm">It may have been revoked. Please contact the business that sent it to you.</p>
      </div>
    )
  }
  if (!invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center text-brand-700">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <p className="font-display font-semibold text-xl">{invoice.businessName}</p>
        <a className="btn-ghost text-xs py-1.5 px-3" href={`/api/public/invoice/${token}/pdf`} target="_blank" rel="noreferrer">
          <FileDown className="h-3.5 w-3.5" /> Download PDF
        </a>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pb-10 grid lg:grid-cols-[1fr_420px] gap-5">
        {/* the invoice */}
        <section className="card p-5 sm:p-6 h-fit">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
            <div>
              <p className="text-xs text-ink-soft">Invoice for</p>
              <h1 className="font-display text-2xl">{invoice.clientName}</h1>
              <p className="text-xs text-ink-soft mt-1">
                {invoice.number} · issued {fmtDate(invoice.issueDate)}
              </p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLES[invoice.status] || ''}`}>
              {STATUS_LABELS[invoice.status] || invoice.status}
            </span>
          </div>

          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="text-left text-xs text-ink-soft border-y border-line bg-paper/60">
                <th className="py-2 pr-2 font-semibold">Description</th>
                <th className="py-2 px-2 font-semibold text-right">Qty</th>
                <th className="py-2 pl-2 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.lineItems.length ? invoice.lineItems : [{ description: 'Professional services', quantity: 1, unitPrice: invoice.amount }]).map(
                (li, i) => (
                  <tr key={i} className="border-b border-line/50">
                    <td className="py-2.5 pr-2">{li.description}</td>
                    <td className="py-2.5 px-2 text-right text-ink-soft">{li.quantity}</td>
                    <td className="py-2.5 pl-2 text-right font-semibold">{fmtMoney(li.quantity * li.unitPrice, invoice.currency)}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>

          <div className="space-y-1 text-right">
            <p className="text-sm text-ink-soft">Total {fmtMoney(invoice.amount, invoice.currency)}</p>
            {invoice.amountPaid > 0 && <p className="text-sm text-ink-soft">Paid −{fmtMoney(invoice.amountPaid, invoice.currency)}</p>}
            <p className="text-xl font-bold text-brand-700">Balance due {fmtMoney(invoice.balance, invoice.currency)}</p>
            <p className={`text-xs ${invoice.status === 'overdue' ? 'text-danger-600 font-semibold' : 'text-ink-soft'}`}>
              {dueLabel({ dueDate: invoice.dueDate, effectiveStatus: invoice.status, daysOverdue: 0 })} · {fmtDate(invoice.dueDate)}
            </p>
          </div>

          {invoice.promisedDate && (
            <p className="mt-4 rounded-xl bg-brand-50 border border-brand-200 text-brand-800 text-sm px-4 py-2.5">
              🤝 Payment promised by <strong>{fmtDate(invoice.promisedDate)}</strong> — thank you!
            </p>
          )}
          {invoice.installmentPlan && invoice.installmentPlan.length > 0 && (
            <div className="mt-4 rounded-xl bg-copper-100/50 border border-copper-300 text-sm px-4 py-2.5">
              <p className="font-semibold mb-1">Agreed payment plan</p>
              {invoice.installmentPlan.map((p, i) => (
                <p key={i} className="text-ink-soft">
                  {i + 1}. {fmtMoney(p.amount, invoice.currency)} by {fmtDate(p.date)}
                </p>
              ))}
            </div>
          )}
        </section>

        {/* the concierge */}
        {invoice.conciergeEnabled && (
          <section className="card flex flex-col h-[640px] overflow-hidden" aria-label="Chat about this invoice">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line">
              <CoinMark size={30} />
              <div>
                <p className="font-display font-semibold leading-tight">Penny</p>
                <p className="text-[11px] text-ink-soft">billing assistant for {invoice.businessName}</p>
              </div>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.length === 0 && !streaming && (
                <div className="space-y-2.5">
                  <p className="text-sm text-ink leading-relaxed">
                    Hi! I'm Penny — I help with this invoice. Ask me anything about it, tell me when you plan to pay,
                    or ask about more time or splitting the payment. <span className="text-ink-soft">(Anything we arrange goes to {invoice.businessName} for a quick OK.)</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {CHIPS.map((c) => (
                      <button key={c} className="chip text-xs px-3 py-1.5" onClick={() => send(c)}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {[...messages, ...(streaming ? [streaming] : [])].map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-700 text-white px-3.5 py-2 text-sm whitespace-pre-wrap">{m.content}</div>
                  </div>
                ) : (
                  <div key={i} className="flex gap-2">
                    <div className="shrink-0 mt-0.5">
                      <CoinMark size={24} />
                    </div>
                    <div className="min-w-0 text-sm">
                      {m.events.map((e) => (
                        <p key={e.id} className="text-xs text-ink-soft flex items-center gap-1.5 mb-1">
                          {e.status === 'running' ? <Spinner className="h-2.5 w-2.5 text-copper-500" /> : '✓'} {e.label}
                        </p>
                      ))}
                      {m.content ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: (props: any) => <p className="mb-1.5 last:mb-0 leading-relaxed" {...props} />,
                            a: (props: any) => <a className="text-brand-700 underline" target="_blank" rel="noreferrer" {...props} />,
                          }}
                        >
                          {m.content}
                        </ReactMarkdown>
                      ) : (
                        streaming === m && <Spinner className="h-3 w-3 text-copper-500" />
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
            <footer className="border-t border-line p-3">
              <div className="flex items-end gap-2 rounded-2xl border border-line bg-paper/60 px-3 py-2 focus-within:border-brand-400">
                <textarea
                  className="flex-1 bg-transparent resize-none outline-none text-sm max-h-28 py-1 placeholder:text-ink-soft/50"
                  rows={1}
                  placeholder="Ask about this invoice…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      send()
                    }
                  }}
                  aria-label="Message"
                />
                <button className="btn-primary p-2 rounded-xl shrink-0" onClick={() => send()} disabled={busy || !input.trim()} aria-label="Send">
                  {busy ? <Spinner /> : <SendHorizonal className="h-4 w-4" />}
                </button>
              </div>
            </footer>
          </section>
        )}
      </main>

      <footer className="max-w-5xl mx-auto px-6 pb-6 flex items-center justify-center gap-1.5 text-[11px] text-ink-soft/70">
        powered by <Wordmark size="text-xs" />
      </footer>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Mic, Paperclip, Plus, SendHorizonal, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { Briefing, ChatSession, EmailRecord } from '../../lib/types'
import { fmtMoney } from '../../lib/format'
import { useChatStream } from '../../hooks/useChatStream'
import { useLiveData } from '../../hooks/useLiveData'
import { useSpeechInput } from '../../hooks/useSpeechInput'
import { onAskPenny } from '../../lib/askPenny'
import { CoinMark, Spinner } from '../ui'
import { MessageView } from './MessageView'
import { QueuedDraftsCard } from './QueuedDraftsCard'

const STARTER_CHIPS = [
  'Who owes me money?',
  'How did this month go?',
  'Log a new invoice',
  'Chase the overdue invoices',
]

export function ChatPanel() {
  const { user } = useAuth()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [showSessions, setShowSessions] = useState(false)
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const { messages, streaming, busy, loadingHistory, send, resume, uploadDocument, patchMessageArtifact } =
    useChatStream(sessionId)
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // overnight drafts waiting for approval; snapshot sticks so the card's
  // per-draft "Sent ✓ / Skipped" states stay visible after handling
  const queued = useLiveData<{ emails: EmailRecord[] }>('/api/emails?status=queued', ['email'])
  const [draftsSnapshot, setDraftsSnapshot] = useState<EmailRecord[]>([])
  useEffect(() => {
    if ((queued.data?.emails.length ?? 0) > 0 && draftsSnapshot.length === 0) {
      setDraftsSnapshot(queued.data!.emails)
    }
  }, [queued.data, draftsSnapshot.length])

  // dashboard → chat: prefill the composer from anywhere in the app
  useEffect(
    () =>
      onAskPenny((text) => {
        setInput(text)
        textareaRef.current?.focus()
      }),
    []
  )

  const speech = useSpeechInput((text) => setInput(text))

  // load (or start) a conversation
  useEffect(() => {
    api<{ sessions: ChatSession[] }>('/api/chat/sessions').then(async (d) => {
      if (d.sessions.length > 0) {
        setSessions(d.sessions)
        setSessionId(d.sessions[0]._id)
      } else {
        const created = await api<{ session: ChatSession }>('/api/chat/sessions', { method: 'POST' })
        setSessions([created.session])
        setSessionId(created.session._id)
      }
    })
    api<{ briefing: Briefing }>('/api/metrics/briefing')
      .then((d) => setBriefing(d.briefing))
      .catch(() => {})
  }, [])

  // keep pinned to the bottom while content streams in
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming, draftsSnapshot])

  const newConversation = async () => {
    const created = await api<{ session: ChatSession }>('/api/chat/sessions', { method: 'POST' })
    setSessions((prev) => [created.session, ...prev])
    setSessionId(created.session._id)
    setShowSessions(false)
  }

  const deleteSession = async (id: string) => {
    await api(`/api/chat/sessions/${id}`, { method: 'DELETE' })
    setSessions((prev) => {
      const next = prev.filter((s) => s._id !== id)
      if (sessionId === id) setSessionId(next[0]?._id ?? null)
      return next
    })
  }

  const submit = useCallback(
    (text?: string) => {
      const content = (text ?? input).trim()
      if (!content || busy) return
      setInput('')
      void send(content)
      // refresh title in the sidebar list after first message
      setSessions((prev) =>
        prev.map((s) => (s._id === sessionId && s.title === 'New conversation' ? { ...s, title: content.slice(0, 60) } : s))
      )
    },
    [input, busy, send, sessionId]
  )

  const currentSession = sessions.find((s) => s._id === sessionId)
  const showWelcome = !loadingHistory && messages.length === 0 && !streaming

  return (
    <section className="flex flex-col h-full bg-white border-l border-line" aria-label="Chat with Penny">
      {/* header */}
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line">
        <div className="flex items-center gap-2.5 min-w-0">
          <CoinMark size={30} />
          <div className="min-w-0">
            <p className="font-display font-semibold leading-tight">Penny</p>
            <p className="text-[11px] text-ink-soft truncate">{busy ? 'working on it…' : 'your back office, on call'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <button
              className="btn-ghost text-xs py-1.5 px-3 max-w-44"
              onClick={() => setShowSessions((v) => !v)}
              aria-expanded={showSessions}
            >
              <span className="truncate">{currentSession?.title || 'Conversation'}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            </button>
            {showSessions && (
              <div className="absolute right-0 top-full mt-1 w-72 card shadow-lg z-20 py-1 max-h-80 overflow-y-auto">
                {sessions.map((s) => (
                  <div key={s._id} className={`flex items-center group ${s._id === sessionId ? 'bg-brand-50' : 'hover:bg-paper'}`}>
                    <button
                      className="flex-1 text-left px-3 py-2 text-sm truncate cursor-pointer"
                      onClick={() => {
                        setSessionId(s._id)
                        setShowSessions(false)
                      }}
                    >
                      {s.title}
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 p-1.5 mr-1 text-ink-soft hover:text-danger-500 cursor-pointer"
                      onClick={() => deleteSession(s._id)}
                      aria-label={`Delete ${s.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="btn-ghost text-xs py-1.5 px-2.5" onClick={newConversation} aria-label="New conversation">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {showWelcome && (
          <div className="flex gap-2.5 animate-fade-up">
            <div className="shrink-0 mt-0.5"><CoinMark size={28} /></div>
            <div className="space-y-2.5">
              <div className="text-[0.95rem] leading-relaxed">
                <p className="mb-1.5">
                  {greeting()}{user?.name ? `, ${user.name.split(' ')[0]}` : ''} 👋
                </p>
                {briefing && briefing.overdueCount > 0 ? (
                  <p>
                    Heads up: <strong>{briefing.overdueCount} invoice{briefing.overdueCount === 1 ? ' is' : 's are'} overdue</strong> — {fmtMoney(briefing.overdueTotal)} you're owed
                    {briefing.newlyOverdueCount > 0 && <>, {briefing.newlyOverdueCount} of them just went late this week</>}.
                    {briefing.paymentsReceivedTotal > 0 && (
                      <> On the bright side, {fmtMoney(briefing.paymentsReceivedTotal)} came in over the last 7 days.</>
                    )}{' '}
                    Want me to chase the late ones?
                  </p>
                ) : briefing && briefing.dueSoonCount > 0 ? (
                  <p>
                    All caught up — nothing overdue. {briefing.dueSoonCount} invoice{briefing.dueSoonCount === 1 ? '' : 's'} ({fmtMoney(briefing.dueSoonTotal)}) come{briefing.dueSoonCount === 1 ? 's' : ''} due this week. Anything I can take off your plate?
                  </p>
                ) : (
                  <p>I keep your invoices, clients and follow-ups in order — just talk to me like you would to a helpful bookkeeper. You can also drop a photo of an invoice here and I'll log it.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(briefing && briefing.overdueCount > 0 ? ['Chase the overdue invoices', ...STARTER_CHIPS.filter((c) => c !== 'Chase the overdue invoices')] : STARTER_CHIPS).map((chip) => (
                  <button key={chip} className="chip" onClick={() => submit(chip)}>
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageView key={m._id} message={m} onResume={resume} onPatchArtifact={patchMessageArtifact} />
        ))}
        {draftsSnapshot.length > 0 && (
          <QueuedDraftsCard drafts={draftsSnapshot} onHandled={() => queued.refetch()} />
        )}
        {streaming && (
          <MessageView
            message={{ role: 'assistant', content: streaming.content, events: streaming.events, artifacts: streaming.artifacts }}
            isStreaming
          />
        )}
        {loadingHistory && (
          <div className="flex justify-center py-8 text-ink-soft"><Spinner className="h-5 w-5" /></div>
        )}
      </div>

      {/* composer */}
      <footer className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-paper/60 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 px-3 py-2">
          <button
            className="p-1.5 text-ink-soft hover:text-copper-600 cursor-pointer shrink-0"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            aria-label="Attach an invoice photo or PDF"
            title="Attach an invoice photo or PDF"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void uploadDocument(f)
              e.target.value = ''
            }}
          />
          <textarea
            ref={textareaRef}
            className="flex-1 bg-transparent resize-none outline-none text-[0.95rem] max-h-36 py-1.5 placeholder:text-ink-soft/50"
            rows={1}
            placeholder={speech.listening ? 'Listening… speak now' : 'Ask about your money, or tell me what to do…'}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 144)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            disabled={busy && !streaming}
            aria-label="Message Penny"
          />
          {speech.supported && (
            <button
              className={`p-1.5 shrink-0 cursor-pointer transition-colors ${
                speech.listening ? 'text-danger-500 animate-pulse' : 'text-ink-soft hover:text-brand-700'
              }`}
              onClick={speech.toggle}
              disabled={busy}
              aria-label={speech.listening ? 'Stop listening' : 'Speak instead of typing'}
              title={speech.listening ? 'Stop listening' : 'Speak instead of typing'}
            >
              <Mic className="h-5 w-5" />
            </button>
          )}
          <button
            className="btn-primary p-2.5 rounded-xl shrink-0"
            onClick={() => submit()}
            disabled={busy || !input.trim()}
            aria-label="Send"
          >
            {busy ? <Spinner /> : <SendHorizonal className="h-4.5 w-4.5" />}
          </button>
        </div>
        <p className="text-[10.5px] text-ink-soft/70 text-center mt-1.5">
          Penny acts on your real records — and always asks before emailing anyone.
        </p>
      </footer>
    </section>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

import { useEffect, useRef, useState } from 'react'
import { BookOpen, Trash2, Upload } from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { Spinner } from '../ui'

interface Source {
  source: string
  chunks: number
  addedAt: string
}

/**
 * "Teach Penny your business" — paste or upload policies/terms/FAQ.
 * Both Penny AND the client-facing concierge answer from this, with citations.
 */
export function KnowledgeCard() {
  const [sources, setSources] = useState<Source[]>([])
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => {
    api<{ sources: Source[] }>('/api/knowledge')
      .then((d) => setSources(d.sources))
      .catch(() => {})
  }
  useEffect(load, [])

  const teach = async (file?: File) => {
    setBusy(true)
    setNote('')
    try {
      let result: { source: string; chunks: number }
      if (file) {
        const form = new FormData()
        form.append('file', file)
        if (name.trim()) form.append('source', name.trim())
        const res = await fetch('/api/knowledge', { method: 'POST', credentials: 'include', body: form })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Upload failed')
        result = data
      } else {
        result = await api('/api/knowledge', { method: 'POST', json: { source: name.trim(), text: text.trim() } })
      }
      setNote(`Learned "${result.source}" — ${result.chunks} passage${result.chunks === 1 ? '' : 's'} ✓`)
      setName('')
      setText('')
      load()
    } catch (err: any) {
      setNote(err.message)
    } finally {
      setBusy(false)
    }
  }

  const forget = async (source: string) => {
    await api(`/api/knowledge/${encodeURIComponent(source)}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <BookOpen className="h-4 w-4 text-brand-700" />
        <h3 className="font-semibold">Teach Penny your business</h3>
      </div>
      <p className="text-xs text-ink-soft mb-3 max-w-xl">
        Paste your policies, terms or FAQ (or upload a .txt/.md). Penny answers from it with citations —
        and so does the assistant your <em>clients</em> talk to on invoice pages ("do you charge late fees?").
      </p>
      <div className="grid sm:grid-cols-[200px_1fr] gap-2.5 mb-2">
        <input
          className="input py-2 text-sm"
          placeholder='Name it — e.g. "Payment terms"'
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <textarea
          className="input py-2 text-sm min-h-20 resize-y"
          placeholder="Paste the text here… e.g. “Invoices are due in 14 days. A 2% late fee applies after 30 days. Rush jobs add 25%.”"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-primary text-sm py-2" onClick={() => teach()} disabled={busy || !name.trim() || !text.trim()}>
          {busy ? <Spinner /> : 'Teach Penny'}
        </button>
        <button className="btn-ghost text-sm py-2" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload className="h-3.5 w-3.5" /> Upload .txt / .md
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void teach(f)
            e.target.value = ''
          }}
        />
        {note && <span className="text-xs font-medium text-brand-700">{note}</span>}
      </div>
      {sources.length > 0 && (
        <ul className="mt-3 divide-y divide-line/60 border-t border-line/60">
          {sources.map((s) => (
            <li key={s.source} className="flex items-center gap-3 py-2">
              <span className="text-sm font-semibold flex-1 truncate">{s.source}</span>
              <span className="text-[11px] text-ink-soft shrink-0">
                {s.chunks} passage{s.chunks === 1 ? '' : 's'} · {fmtDate(s.addedAt)}
              </span>
              <button
                className="p-1.5 text-ink-soft hover:text-danger-500 cursor-pointer"
                onClick={() => forget(s.source)}
                aria-label={`Forget ${s.source}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

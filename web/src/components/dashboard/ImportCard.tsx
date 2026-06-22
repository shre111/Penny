import { useRef, useState } from 'react'
import { FileSpreadsheet, Upload, Download } from 'lucide-react'
import { Spinner } from '../ui'

interface ImportResult {
  created: number
  clientsCreated?: number
  skipped: number
  errors: { row: number; reason: string }[]
}

const TEMPLATES: Record<Kind, { headers: string; sample: string }> = {
  clients: {
    headers: 'name,contactName,email,phone,notes',
    sample: 'Acme Hardware,Jane Doe,jane@acme.com,555-0100,VIP client',
  },
  invoices: {
    headers: 'client,amount,dueDate,issueDate,status,notes',
    sample: 'Acme Hardware,4500,2026-07-01,2026-06-01,sent,Website redesign',
  },
}

type Kind = 'clients' | 'invoices'

function downloadTemplate(kind: Kind) {
  const { headers, sample } = TEMPLATES[kind]
  const blob = new Blob([`${headers}\n${sample}\n`], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `penny-${kind}-template.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Bulk-load clients or invoices from a CSV export. Imported rows flow through
 * the same models the app uses, so the dashboard refreshes live the moment the
 * import finishes.
 */
export function ImportCard() {
  const [busy, setBusy] = useState<Kind | null>(null)
  const [result, setResult] = useState<{ kind: Kind; data: ImportResult } | null>(null)
  const [error, setError] = useState('')
  const clientsRef = useRef<HTMLInputElement>(null)
  const invoicesRef = useRef<HTMLInputElement>(null)

  const upload = async (kind: Kind, file: File) => {
    setBusy(kind)
    setError('')
    setResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/import/${kind}`, { method: 'POST', credentials: 'include', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Import failed')
      setResult({ kind, data })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <FileSpreadsheet className="h-4 w-4 text-brand-700" />
        <h3 className="font-semibold">Import from CSV</h3>
      </div>
      <p className="text-xs text-ink-soft mb-3 max-w-xl">
        Already keep your books in a spreadsheet or another tool? Upload a CSV to bring your clients and
        invoices in at once. Unknown clients on an invoice are added automatically; duplicates are skipped.
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        {(['clients', 'invoices'] as Kind[]).map((kind) => {
          const ref = kind === 'clients' ? clientsRef : invoicesRef
          return (
            <div key={kind} className="rounded-xl border border-line/60 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold capitalize">{kind}</span>
                <button
                  className="inline-flex items-center gap-1 text-[11px] text-ink-soft hover:text-brand-700 cursor-pointer"
                  onClick={() => downloadTemplate(kind)}
                >
                  <Download className="h-3 w-3" /> template
                </button>
              </div>
              <p className="text-[11px] text-ink-soft mb-2 font-mono break-words">{TEMPLATES[kind].headers}</p>
              <button
                className="btn-ghost text-sm py-2 w-full justify-center"
                onClick={() => ref.current?.click()}
                disabled={busy !== null}
              >
                {busy === kind ? <Spinner /> : <Upload className="h-3.5 w-3.5" />}
                Upload {kind} CSV
              </button>
              <input
                ref={ref}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void upload(kind, f)
                  e.target.value = ''
                }}
              />
            </div>
          )
        })}
      </div>

      {error && <p className="mt-3 text-xs font-medium text-danger-500">{error}</p>}

      {result && (
        <div className="mt-3 text-xs">
          <p className="font-semibold text-brand-700">
            Imported {result.data.created} {result.kind}
            {result.kind === 'invoices' && result.data.clientsCreated
              ? ` (and added ${result.data.clientsCreated} new client${result.data.clientsCreated === 1 ? '' : 's'})`
              : ''}
            {result.data.skipped ? ` · skipped ${result.data.skipped}` : ''} ✓
          </p>
          {result.data.errors.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-ink-soft">
              {result.data.errors.map((e, i) => (
                <li key={i}>
                  Row {e.row}: {e.reason}
                </li>
              ))}
              {result.data.skipped > result.data.errors.length && (
                <li>…and {result.data.skipped - result.data.errors.length} more</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

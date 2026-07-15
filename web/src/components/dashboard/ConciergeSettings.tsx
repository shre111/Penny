import { useState } from 'react'
import { Handshake } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth, type User } from '../../lib/auth'
import { Spinner } from '../ui'

/**
 * Guardrails for the client-facing concierge: what Penny may agree to with
 * your clients on public invoice pages — before it even reaches your approval.
 */
export function ConciergeSettings() {
  const { user, setUser } = useAuth()
  const [form, setForm] = useState({
    enabled: user?.concierge?.enabled ?? true,
    maxExtensionDays: user?.concierge?.maxExtensionDays ?? 14,
    maxInstallments: user?.concierge?.maxInstallments ?? 3,
  })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const d = await api<{ user: User }>('/api/auth/concierge', { method: 'PATCH', json: form })
      setUser(d.user)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err: any) {
      // don't leave the click looking like nothing happened
      setError(err?.message || "Couldn't save your limits — please try again")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Handshake className="h-4 w-4 text-copper-600" />
        <h3 className="font-semibold">Client concierge</h3>
      </div>
      <p className="text-xs text-ink-soft mb-3 max-w-xl">
        Share an invoice link (🔗 on any invoice row) and your client can talk to Penny about it — ask questions,
        promise a payment date, or request an arrangement. These limits control what she may negotiate;
        everything still comes to you for final approval.
      </p>
      <div className="flex items-end gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer pb-2.5">
          <input
            type="checkbox"
            className="h-4 w-4 accent-(--color-brand-700) cursor-pointer"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          Chat enabled on invoice pages
        </label>
        <div>
          <label className="label text-xs" htmlFor="maxExt">Max extension she may offer</label>
          <div className="flex items-center gap-1.5">
            <input
              id="maxExt"
              type="number"
              min={0}
              max={90}
              className="input py-2 text-sm w-20"
              value={form.maxExtensionDays}
              onChange={(e) => setForm((f) => ({ ...f, maxExtensionDays: Number(e.target.value) }))}
            />
            <span className="text-xs text-ink-soft">days</span>
          </div>
        </div>
        <div>
          <label className="label text-xs" htmlFor="maxInst">Max installments</label>
          <input
            id="maxInst"
            type="number"
            min={1}
            max={12}
            className="input py-2 text-sm w-20"
            value={form.maxInstallments}
            onChange={(e) => setForm((f) => ({ ...f, maxInstallments: Number(e.target.value) }))}
          />
        </div>
        <button className="btn-primary text-sm py-2" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : saved ? 'Saved ✓' : 'Save limits'}
        </button>
      </div>
      {error && <p className="text-xs text-danger-600 mt-2">{error}</p>}
    </div>
  )
}

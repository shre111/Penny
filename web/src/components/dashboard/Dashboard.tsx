import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useLiveData } from '../../hooks/useLiveData'
import type { Client, EmailRecord, Forecast, Invoice, Summary } from '../../lib/types'
import { api } from '../../lib/api'
import { Spinner } from '../ui'
import { KpiCards, AgingChart, CashflowChart, ForecastCard } from './widgets'
import { InvoiceTable, ClientsTable, Outbox } from './tables'
import { ActivityFeed } from './ActivityFeed'

type Tab = 'overview' | 'invoices' | 'clients' | 'outbox' | 'activity'

export function Dashboard() {
  const [tab, setTab] = useState<Tab>('overview')
  const summary = useLiveData<{ summary: Summary }>('/api/metrics/summary', ['invoice', 'client'])
  const charts = useLiveData<{ aging: any[]; cashflow: any[] }>('/api/metrics/charts', ['invoice'])
  const invoices = useLiveData<{ invoices: Invoice[] }>('/api/invoices?status=all', ['invoice'])
  const clients = useLiveData<{ clients: Client[] }>('/api/clients', ['client'])
  const emails = useLiveData<{ emails: EmailRecord[] }>('/api/emails', ['email'])
  const activities = useLiveData<{ activities: any[] }>('/api/activities', ['invoice', 'client', 'email'])
  const forecast = useLiveData<{ forecast: Forecast }>('/api/metrics/forecast', ['invoice'])
  const [seeding, setSeeding] = useState(false)

  const queuedCount = emails.data?.emails.filter((e) => e.status === 'queued').length || undefined
  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'invoices', label: 'Invoices', badge: summary.data?.summary.overdueCount || undefined },
    { key: 'clients', label: 'Clients' },
    { key: 'outbox', label: 'Outbox', badge: queuedCount },
    { key: 'activity', label: 'Activity' },
  ]

  if (!summary.data || !invoices.data) {
    return (
      <div className="flex items-center justify-center h-64 text-ink-soft">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  const isEmpty = summary.data.summary.invoiceCount === 0 && (clients.data?.clients.length ?? 0) === 0

  const loadSample = async () => {
    setSeeding(true)
    try {
      await api('/api/demo/load', { method: 'POST' })
      await Promise.all([summary.refetch(), charts.refetch(), invoices.refetch(), clients.refetch(), emails.refetch()])
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <nav className="flex gap-1 bg-stone-100 rounded-full p-1" aria-label="Dashboard sections">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative rounded-full px-4 py-1.5 text-sm font-semibold transition-colors cursor-pointer ${
                tab === t.key ? 'bg-card text-ink shadow-sm' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {t.label}
              {t.badge ? (
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full bg-danger-500 text-white text-[10px] font-bold h-4.5 min-w-4.5 px-1">
                  {t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        {isEmpty && (
          <button className="btn-copper text-sm" onClick={loadSample} disabled={seeding}>
            {seeding ? <Spinner /> : <Sparkles className="h-4 w-4" />}
            Load sample business
          </button>
        )}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <KpiCards summary={summary.data.summary} />
          <div className="grid lg:grid-cols-2 gap-4">
            {charts.data && <AgingChart data={charts.data.aging} />}
            {charts.data && <CashflowChart data={charts.data.cashflow} />}
            {forecast.data && <ForecastCard forecast={forecast.data.forecast} />}
          </div>
          <InvoiceTable invoices={invoices.data.invoices} highlights={invoices.highlights} />
        </div>
      )}
      {tab === 'invoices' && <InvoiceTable invoices={invoices.data.invoices} highlights={invoices.highlights} />}
      {tab === 'clients' && <ClientsTable clients={clients.data?.clients || []} highlights={clients.highlights} />}
      {tab === 'outbox' && <Outbox emails={emails.data?.emails || []} highlights={emails.highlights} />}
      {tab === 'activity' && <ActivityFeed activities={activities.data?.activities || []} refetch={activities.refetch} />}
    </div>
  )
}

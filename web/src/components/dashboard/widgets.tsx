import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell } from 'recharts'
import { Banknote, AlertCircle, PiggyBank, Sparkles, Users } from 'lucide-react'
import type { Forecast, Summary } from '../../lib/types'
import { fmtDate, fmtMoney } from '../../lib/format'
import { useChartColors } from '../../lib/theme'

export function useTooltipStyle() {
  const c = useChartColors()
  return {
    contentStyle: { background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 10, color: c.tooltipText },
    labelStyle: { color: c.tooltipText, fontWeight: 600 },
    itemStyle: { color: c.tooltipText },
  }
}

export function KpiCards({ summary }: { summary: Summary }) {
  const cards = [
    {
      label: 'Waiting to be paid',
      value: fmtMoney(summary.outstandingTotal),
      sub: `${summary.outstandingCount} open invoice${summary.outstandingCount === 1 ? '' : 's'}`,
      icon: <Banknote className="h-5 w-5" />,
      tone: 'text-brand-700 bg-brand-50',
    },
    {
      label: 'Overdue',
      value: fmtMoney(summary.overdueTotal),
      sub: `${summary.overdueCount} invoice${summary.overdueCount === 1 ? '' : 's'} late`,
      icon: <AlertCircle className="h-5 w-5" />,
      tone: summary.overdueTotal > 0 ? 'text-danger-600 bg-red-50' : 'text-brand-700 bg-brand-50',
      alert: summary.overdueTotal > 0,
    },
    {
      label: 'Collected this month',
      value: fmtMoney(summary.collectedThisMonth),
      sub: 'money in the bank',
      icon: <PiggyBank className="h-5 w-5" />,
      tone: 'text-copper-600 bg-copper-100',
    },
    {
      label: 'Clients',
      value: String(summary.clientCount),
      sub: `${summary.invoiceCount} invoices all-time`,
      icon: <Users className="h-5 w-5" />,
      tone: 'text-ink-soft bg-stone-100',
    },
  ]
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className={`card p-4 ${c.alert ? 'ring-1 ring-red-200' : ''}`}>
          <div className={`inline-flex items-center justify-center rounded-lg p-2 mb-2 ${c.tone}`}>{c.icon}</div>
          <p className="text-[1.45rem] leading-tight font-bold tracking-tight">{c.value}</p>
          <p className="text-sm font-medium text-ink mt-0.5">{c.label}</p>
          <p className="text-xs text-ink-soft">{c.sub}</p>
        </div>
      ))}
    </div>
  )
}

const AGING_COLORS = ['#3a8c61', '#b88323', '#c2543e', '#82492a']

export function AgingChart({ data }: { data: { name: string; value: number }[] }) {
  const empty = data.every((d) => d.value === 0)
  const c = useChartColors()
  const tooltip = useTooltipStyle()
  return (
    <div className="card p-4">
      <h3 className="font-semibold mb-1">Unpaid invoices, by lateness</h3>
      <p className="text-xs text-ink-soft mb-3">Where your waiting money sits</p>
      {empty ? (
        <p className="text-sm text-ink-soft py-10 text-center">Nothing unpaid — lovely.</p>
      ) : (
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: c.tick }} axisLine={false} tickLine={false} interval={0} />
            <YAxis tickFormatter={(v) => `$${v >= 1000 ? `${v / 1000}k` : v}`} tick={{ fontSize: 11, fill: c.tick }} axisLine={false} tickLine={false} width={44} />
            <Tooltip formatter={(v) => fmtMoney(Number(v))} cursor={{ fill: 'rgba(58,140,97,0.06)' }} {...tooltip} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
              {data.map((_, i) => (
                <Cell key={i} fill={AGING_COLORS[i % AGING_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

/**
 * The crystal ball: expected money in, week by week, using each client's
 * payment personality. The why is listed under the chart — trust the math
 * because you can read it.
 */
export function ForecastCard({ forecast }: { forecast: Forecast }) {
  const c = useChartColors()
  const tooltip = useTooltipStyle()
  const empty = forecast.totalExpected === 0
  return (
    <div className="card p-4 lg:col-span-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold mb-1 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-copper-500" /> Money coming in — Penny's best guess
          </h3>
          <p className="text-xs text-ink-soft">
            Based on each client's actual payment habits, not just due dates
          </p>
        </div>
        {!empty && (
          <p className="text-xl font-bold text-brand-700">
            {fmtMoney(forecast.totalExpected)} <span className="text-xs font-medium text-ink-soft">expected in 8 weeks</span>
          </p>
        )}
      </div>
      {empty ? (
        <p className="text-sm text-ink-soft py-8 text-center">No open invoices to forecast — quiet books.</p>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4 mt-3">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={forecast.weeks} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: c.tick }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tickFormatter={(v) => `$${v >= 1000 ? `${v / 1000}k` : v}`} tick={{ fontSize: 10.5, fill: c.tick }} axisLine={false} tickLine={false} width={42} />
              <Tooltip formatter={(v) => fmtMoney(Number(v))} cursor={{ fill: 'rgba(58,140,97,0.06)' }} {...tooltip} />
              <Bar dataKey="expected" name="Expected" fill="#5ba980" radius={[5, 5, 0, 0]} maxBarSize={34} />
            </BarChart>
          </ResponsiveContainer>
          <ul className="space-y-1.5 self-center">
            {forecast.expectedPayments.slice(0, 5).map((p) => (
              <li key={p.number} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{p.client}</span>
                  <span className="text-ink-soft"> · {p.number}</span>
                  {p.overdue && <span className="ml-1.5 text-[10px] font-bold text-danger-600">OVERDUE</span>}
                </span>
                <span className="shrink-0 text-right">
                  <span className="font-semibold">{fmtMoney(p.amount)}</span>
                  <span className="block text-[11px] text-ink-soft">~{fmtDate(p.expectedDate)}</span>
                </span>
              </li>
            ))}
            {forecast.expectedPayments[0]?.basis && (
              <li className="text-[11px] text-ink-soft/80 pt-1 border-t border-line/60">
                e.g. {forecast.expectedPayments[0].basis}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

export function CashflowChart({ data }: { data: { name: string; billed: number; collected: number }[] }) {
  const c = useChartColors()
  const tooltip = useTooltipStyle()
  return (
    <div className="card p-4">
      <h3 className="font-semibold mb-1">Billed vs collected</h3>
      <p className="text-xs text-ink-soft mb-3">The last six months at a glance</p>
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }} barGap={3}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: c.tick }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => `$${v >= 1000 ? `${v / 1000}k` : v}`} tick={{ fontSize: 11, fill: c.tick }} axisLine={false} tickLine={false} width={44} />
          <Tooltip formatter={(v) => fmtMoney(Number(v))} cursor={{ fill: 'rgba(58,140,97,0.06)' }} {...tooltip} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="billed" name="Billed" fill="#bcdfc9" radius={[5, 5, 0, 0]} maxBarSize={26} />
          <Bar dataKey="collected" name="Collected" fill="#2a7350" radius={[5, 5, 0, 0]} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

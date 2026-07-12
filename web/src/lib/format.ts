export function fmtMoney(n: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  }).format(n)
}

/** Compact money for chart axis ticks: `$800`, `$1.5k`, `$12.3k`, `$1.2M` (no long tails). */
export function fmtAxisMoney(v: number): string {
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${sign}$${abs}`
}

export function fmtDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function dueLabel(inv: { dueDate: string; effectiveStatus: string; daysOverdue?: number }): string {
  if (inv.effectiveStatus === 'overdue') {
    const d = inv.daysOverdue ?? 0
    return d === 1 ? '1 day late' : `${d} days late`
  }
  if (inv.effectiveStatus === 'paid') return 'Paid'
  if (inv.effectiveStatus === 'draft') return 'Draft'
  if (inv.effectiveStatus === 'void') return 'Void'
  const days = Math.ceil((new Date(inv.dueDate).getTime() - Date.now()) / 86400000)
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days} days`
}

export const STATUS_STYLES: Record<string, string> = {
  overdue: 'bg-red-50 text-danger-600 border-red-200',
  sent: 'bg-brand-50 text-brand-700 border-brand-200',
  paid: 'bg-brand-100 text-brand-800 border-brand-200',
  draft: 'bg-stone-100 text-ink-soft border-stone-200',
  void: 'bg-stone-100 text-ink-soft border-stone-200 line-through',
}

export const STATUS_LABELS: Record<string, string> = {
  overdue: 'Overdue',
  sent: 'Awaiting payment',
  paid: 'Paid',
  draft: 'Draft',
  void: 'Void',
}

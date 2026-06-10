import type { ReactNode } from 'react'

export function CoinMark({ size = 34 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-gradient-to-br from-copper-300 to-copper-600 text-white font-display font-semibold shadow-sm select-none"
      style={{ width: size, height: size, fontSize: size * 0.55 }}
      aria-hidden
    >
      P
    </span>
  )
}

export function Wordmark({ size = 'text-2xl' }: { size?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${size}`}>
      <CoinMark />
      <span className="font-display font-semibold tracking-tight">Penny</span>
    </span>
  )
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label="Working"
    />
  )
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-6 text-ink-soft">
      {icon && <div className="mb-3 text-brand-300">{icon}</div>}
      <p className="font-semibold text-ink mb-1">{title}</p>
      {children && <div className="text-sm max-w-sm">{children}</div>}
    </div>
  )
}

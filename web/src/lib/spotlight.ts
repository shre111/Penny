// Penny's pointer: when she reads or changes something, the dashboard element
// she's working with lights up. Tool activity → spotlight target.

const EVENT = 'penny:spotlight'

export type SpotlightKey = 'kpis' | 'invoices' | 'charts' | 'forecast'

const TOOL_TARGET: Record<string, SpotlightKey> = {
  list_invoices: 'invoices',
  create_invoice: 'invoices',
  record_payment: 'invoices',
  update_invoice: 'invoices',
  get_business_metrics: 'kpis',
  make_chart: 'charts',
  record_payment_promise: 'invoices',
}

export function spotlightForTool(tool: string): SpotlightKey | null {
  return TOOL_TARGET[tool] || null
}

export function emitSpotlight(key: SpotlightKey) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }))
}

export function onSpotlight(handler: (key: SpotlightKey) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<SpotlightKey>).detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

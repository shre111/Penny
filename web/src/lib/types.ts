export interface Client {
  _id: string
  name: string
  contactName: string
  email: string
  phone: string
  notes: string
  behavior?: { paidCount: number; avgDaysLate: number; label: string | null } | null
}

export interface Forecast {
  weeks: { name: string; expected: number }[]
  totalExpected: number
  expectedPayments: {
    invoiceId: string
    number: string
    client: string
    amount: number
    expectedDate: string
    basis: string
    overdue: boolean
  }[]
  beyond: number
}

export interface LineItem {
  description: string
  quantity: number
  unitPrice: number
}

export interface Invoice {
  _id: string
  number: string
  clientId: { _id: string; name: string; email?: string; contactName?: string } | null
  lineItems: LineItem[]
  amount: number
  currency: string
  issueDate: string
  dueDate: string
  status: 'draft' | 'sent' | 'paid' | 'void'
  effectiveStatus: 'draft' | 'sent' | 'paid' | 'void' | 'overdue'
  amountPaid: number
  balance: number
  daysOverdue: number
  notes: string
  source: 'manual' | 'chat' | 'document'
  promisedDate?: string | null
  promiseNote?: string
  installmentPlan?: { amount: number; date: string }[] | null
  shareToken?: string
  sharePinProtected?: boolean
}

export interface Proposal {
  _id: string
  invoiceId: { _id: string; number: string; amount: number; dueDate: string } | null
  type: 'extension' | 'installments'
  details: { newDueDate?: string; installments?: { amount: number; date: string }[] }
  clientReason: string
  status: 'pending' | 'approved' | 'declined'
  createdAt: string
}

export interface Summary {
  outstandingTotal: number
  outstandingCount: number
  overdueTotal: number
  overdueCount: number
  collectedThisMonth: number
  invoiceCount: number
  clientCount: number
}

export interface Briefing {
  overdueCount: number
  overdueTotal: number
  newlyOverdueCount: number
  newlyOverdueTotal: number
  dueSoonCount: number
  dueSoonTotal: number
  paymentsReceivedCount: number
  paymentsReceivedTotal: number
  overdueInvoices: { id: string; number: string; client: string; balance: number; daysOverdue: number }[]
}

export interface EmailRecord {
  _id: string
  to: string
  subject: string
  body: string
  status: 'queued' | 'scheduled' | 'sent' | 'simulated' | 'failed' | 'dismissed'
  provider: string
  sendAt?: string
  invoiceId?: string
  createdAt: string
}

export interface Insight {
  type: 'duplicate' | 'retainer-gap' | 'broken-promise'
  message: string
  invoices?: string[]
  client?: string
}

export interface TrustStats {
  window: number
  clean: number
  edited: number
  skipped: number
  cleanNeeded: number
  eligible: boolean
  autoSendReminders: boolean
}

export interface ChatSession {
  _id: string
  title: string
  lastMessageAt: string
}

export interface ActivityEvent {
  id: string
  label: string
  tool: string
  status: 'running' | 'done' | 'error'
  agent?: string
}

export interface Artifact {
  type: 'chart' | 'invoices' | 'extraction' | 'plan'
  data: any
}

export interface InterruptAction {
  id: string
  tool: string
  args: Record<string, any>
  description?: string
}

export interface ChatMessage {
  _id: string
  role: 'user' | 'assistant'
  content: string
  events: ActivityEvent[]
  artifacts: Artifact[]
  interrupt?: { actions: InterruptAction[]; status: 'pending' | 'resolved'; decisions?: string[] }
  createdAt: string
}

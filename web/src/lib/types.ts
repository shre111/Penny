export interface Client {
  _id: string
  name: string
  contactName: string
  email: string
  phone: string
  notes: string
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
  status: 'sent' | 'simulated' | 'failed'
  provider: string
  createdAt: string
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
  type: 'chart' | 'invoices' | 'extraction'
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

import mongoose from 'mongoose'

const lineItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, default: 1, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false }
)

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now },
    method: { type: String, default: 'bank transfer' },
  },
  { _id: false }
)

const invoiceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    number: { type: String, required: true }, // INV-0042, unique per user
    lineItems: { type: [lineItemSchema], default: [] },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'USD' },
    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    // 'overdue' is derived: status==='sent' && dueDate < now && balance > 0
    status: { type: String, enum: ['draft', 'sent', 'paid', 'void'], default: 'sent' },
    payments: { type: [paymentSchema], default: [] },
    notes: { type: String, default: '' },
    source: { type: String, enum: ['manual', 'chat', 'document'], default: 'manual' },
    lastReminderAt: { type: Date },
    // client concierge: public share link + the client's payment promise
    shareToken: { type: String, index: true },
    sharePinHash: { type: String }, // optional bcrypt PIN gating the public link
    promisedDate: { type: Date },
    promiseNote: { type: String },
    promisedAt: { type: Date },
    // approved installment arrangement, if any
    installmentPlan: { type: [{ amount: Number, date: Date }], default: undefined },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
)

invoiceSchema.index({ userId: 1, number: 1 }, { unique: true })
invoiceSchema.index({ userId: 1, status: 1, dueDate: 1 })

invoiceSchema.virtual('amountPaid').get(function () {
  return (this.payments || []).reduce((s, p) => s + p.amount, 0)
})
invoiceSchema.virtual('balance').get(function () {
  return Math.max(0, this.amount - this.amountPaid)
})
invoiceSchema.virtual('effectiveStatus').get(function () {
  if (this.status === 'sent' && this.balance > 0 && this.dueDate < new Date()) return 'overdue'
  return this.status
})
invoiceSchema.virtual('daysOverdue').get(function () {
  if (this.effectiveStatus !== 'overdue') return 0
  return Math.floor((Date.now() - this.dueDate.getTime()) / 86400000)
})

export const Invoice = mongoose.model('Invoice', invoiceSchema)

// Race-safe per-user invoice numbering via an atomic counter collection
const counterSchema = new mongoose.Schema({
  _id: String, // `${userId}:invoice`
  seq: { type: Number, default: 0 },
})
const Counter = mongoose.model('Counter', counterSchema)

export async function nextInvoiceNumber(userId) {
  const c = await Counter.findOneAndUpdate(
    { _id: `${userId}:invoice` },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  )
  return `INV-${String(c.seq).padStart(4, '0')}`
}

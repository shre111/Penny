import mongoose from 'mongoose'

// Outbox: every email the agent drafts/sends is recorded here.
// status 'simulated' = Composio not configured; we show it in the outbox UI anyway.
const emailSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    to: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    status: { type: String, enum: ['sent', 'simulated', 'failed'], required: true },
    provider: { type: String, default: 'simulated' }, // 'composio-gmail' | 'simulated'
    error: { type: String },
  },
  { timestamps: true }
)

export const Email = mongoose.model('Email', emailSchema)

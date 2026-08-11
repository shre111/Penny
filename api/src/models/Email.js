import mongoose from 'mongoose'

// Outbox: every email the agent drafts/sends is recorded here.
// status 'simulated' = Composio not configured; we show it in the outbox UI anyway.
// status 'queued'    = drafted by the overnight agent, waiting for the owner's OK.
const emailSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    to: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    // 'scheduled' = auto-approved by earned autonomy; sends at sendAt unless cancelled
    status: { type: String, enum: ['queued', 'scheduled', 'sent', 'simulated', 'failed', 'dismissed'], required: true },
    provider: { type: String, default: 'simulated' }, // 'composio-gmail' | 'simulated' | 'overnight'
    error: { type: String },
    sendAt: { type: Date },
    editedByOwner: { type: Boolean, default: false },
    // 'reminder' = went through the overnight queue → owner approve/edit/dismiss
    // decision that earned autonomy is meant to measure; 'chat' = composed and
    // sent interactively (HITL-approved, but not that decision). provider gets
    // overwritten once a send resolves (see approve/auto-send routes), so this
    // is the only field that still says where an email came from after the fact.
    origin: { type: String, enum: ['reminder', 'chat'], default: 'chat' },
  },
  { timestamps: true }
)

export const Email = mongoose.model('Email', emailSchema)

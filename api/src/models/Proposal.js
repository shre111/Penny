import mongoose from 'mongoose'

// An arrangement the client negotiated with Penny on the public invoice page.
// Nothing applies to the books until the OWNER approves it.
const proposalSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    type: { type: String, enum: ['extension', 'installments'], required: true },
    // extension: { newDueDate }  ·  installments: { installments: [{amount, date}] }
    details: { type: mongoose.Schema.Types.Mixed, required: true },
    clientReason: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'declined'], default: 'pending' },
    decidedAt: { type: Date },
  },
  { timestamps: true }
)

proposalSchema.index({ userId: 1, status: 1 })

export const Proposal = mongoose.model('Proposal', proposalSchema)

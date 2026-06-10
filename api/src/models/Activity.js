import mongoose from 'mongoose'

// The audit trail: one row per change, human or agent. Written automatically
// by emitChange() so it can never drift from what the live dashboard saw.
const activitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    entity: { type: String, required: true }, // invoice | client | email
    action: { type: String, required: true }, // created | updated | deleted | ...
    entityId: { type: mongoose.Schema.Types.ObjectId },
    summary: { type: String, required: true },
    actor: { type: String, enum: ['user', 'agent', 'service'], default: 'user' },
    // set when this action can be reversed (agent-created records)
    undo: {
      type: new mongoose.Schema(
        { type: { type: String, enum: ['delete-invoice', 'delete-client'] } },
        { _id: false }
      ),
      default: undefined,
    },
    undoneAt: { type: Date },
  },
  { timestamps: true }
)

activitySchema.index({ userId: 1, createdAt: -1 })

export const Activity = mongoose.model('Activity', activitySchema)

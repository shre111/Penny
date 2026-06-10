import mongoose from 'mongoose'

// Cross-session memory: small durable facts Penny learns about the business.
// Injected into the agent's system prompt on every run.
const memorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    fact: { type: String, required: true },
  },
  { timestamps: true }
)

export const Memory = mongoose.model('Memory', memorySchema)

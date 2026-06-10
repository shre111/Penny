import mongoose from 'mongoose'

const chatSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: 'New conversation' },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

// One chat turn. Assistant messages carry the agent's visible activity
// (events) and any rich artifacts (charts, approval cards, extraction cards).
const messageSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatSession', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, default: '' },
    // [{ label: 'Checking your invoices…', tool: 'list_invoices', status: 'done', agent: 'Bookkeeper' }]
    events: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // [{ type: 'chart'|'invoices'|'approval'|'extraction', data: {...} }]
    artifacts: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // HITL: when the agent paused for approval mid-run
    interrupt: {
      type: new mongoose.Schema(
        {
          actions: { type: [mongoose.Schema.Types.Mixed], default: [] }, // [{id, tool, args}]
          status: { type: String, enum: ['pending', 'resolved'], default: 'pending' },
          decisions: { type: [String], default: undefined }, // how it was resolved

        },
        { _id: false }
      ),
      default: undefined,
    },
  },
  { timestamps: true }
)

export const ChatSession = mongoose.model('ChatSession', chatSessionSchema)
export const Message = mongoose.model('Message', messageSchema)

import mongoose from 'mongoose'

// "Teach Penny your business": policy/FAQ text, chunked and embedded.
// Vectors live right here in Mongo — an SMB's policy corpus is dozens of
// chunks, so exact cosine in-process beats running a vector DB. Swap to an
// Atlas $vectorSearch index when corpora grow; same collection, same vectors.
const knowledgeChunkSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    source: { type: String, required: true }, // e.g. "Payment terms", "FAQ.md"
    chunk: { type: String, required: true },
    embedding: { type: [Number], required: true },
  },
  { timestamps: true }
)

knowledgeChunkSchema.index({ userId: 1, source: 1 })

export const KnowledgeChunk = mongoose.model('KnowledgeChunk', knowledgeChunkSchema)

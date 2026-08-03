import { Router } from 'express'
import { Memory } from '../models/Memory.js'
import { requireUserOrService } from '../auth/middleware.js'
import { escapeRegex } from '../util.js'

export const memoriesRouter = Router()
memoriesRouter.use(requireUserOrService)

// The agent can call save_memory on every turn — without a cap the collection
// grows forever while GET only ever surfaces the newest 50, so older facts
// become permanently invisible clutter instead of actually being dropped.
const MAX_MEMORIES_PER_USER = 200

memoriesRouter.get('/', async (req, res) => {
  // Return the 50 MOST RECENT memories, oldest→newest. Consumers (the agent's
  // system prompt, the overnight tone notes) take a tail slice expecting the
  // newest at the end — sorting ascending + limit 50 would instead keep the
  // oldest 50 and silently drop the newest once a user passes 50.
  const memories = await Memory.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50).lean()
  memories.reverse()
  res.json({ memories })
})

memoriesRouter.post('/', async (req, res) => {
  const { fact } = req.body || {}
  if (!fact?.trim()) return res.status(400).json({ error: 'fact is required' })
  // Light dedupe: skip near-identical facts
  const existing = await Memory.findOne({ userId: req.userId, fact: { $regex: `^${escapeRegex(fact.trim())}$`, $options: 'i' } })
  if (existing) return res.json({ memory: existing, deduped: true })
  const memory = await Memory.create({ userId: req.userId, fact: fact.trim() })
  const count = await Memory.countDocuments({ userId: req.userId })
  if (count > MAX_MEMORIES_PER_USER) {
    const stale = await Memory.find({ userId: req.userId })
      .sort({ createdAt: 1 })
      .limit(count - MAX_MEMORIES_PER_USER)
      .select('_id')
    await Memory.deleteMany({ _id: { $in: stale.map((m) => m._id) } })
  }
  res.status(201).json({ memory })
})

memoriesRouter.delete('/:id', async (req, res) => {
  const memory = await Memory.findOneAndDelete({ _id: req.params.id, userId: req.userId })
  if (!memory) return res.status(404).json({ error: 'Memory not found' })
  res.json({ ok: true })
})

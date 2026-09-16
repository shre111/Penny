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
  if (typeof fact !== 'string' || !fact.trim()) return res.status(400).json({ error: 'fact is required' })
  // Every sibling free-text field is capped (knowledge text 60k, proposal
  // reason 400 chars) — this one wasn't, and every saved fact gets echoed
  // into the system prompt of every future chat turn (build_system_prompt in
  // ai/app/agent.py), so one verbose save would bloat every later LLM call.
  const trimmed = fact.trim()
  if (trimmed.length > 300) return res.status(400).json({ error: 'That fact is too long (max 300 characters) — try a shorter version' })
  // Light dedupe: skip near-identical facts
  const existing = await Memory.findOne({ userId: req.userId, fact: { $regex: `^${escapeRegex(trimmed)}$`, $options: 'i' } })
  if (existing) return res.json({ memory: existing, deduped: true })
  const memory = await Memory.create({ userId: req.userId, fact: trimmed })
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

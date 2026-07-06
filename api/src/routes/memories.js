import { Router } from 'express'
import { Memory } from '../models/Memory.js'
import { requireUserOrService } from '../auth/middleware.js'
import { escapeRegex } from '../util.js'

export const memoriesRouter = Router()
memoriesRouter.use(requireUserOrService)

memoriesRouter.get('/', async (req, res) => {
  const memories = await Memory.find({ userId: req.userId }).sort({ createdAt: 1 }).limit(50).lean()
  res.json({ memories })
})

memoriesRouter.post('/', async (req, res) => {
  const { fact } = req.body || {}
  if (!fact?.trim()) return res.status(400).json({ error: 'fact is required' })
  // Light dedupe: skip near-identical facts
  const existing = await Memory.findOne({ userId: req.userId, fact: { $regex: `^${escapeRegex(fact.trim())}$`, $options: 'i' } })
  if (existing) return res.json({ memory: existing, deduped: true })
  const memory = await Memory.create({ userId: req.userId, fact: fact.trim() })
  res.status(201).json({ memory })
})

memoriesRouter.delete('/:id', async (req, res) => {
  await Memory.findOneAndDelete({ _id: req.params.id, userId: req.userId })
  res.json({ ok: true })
})

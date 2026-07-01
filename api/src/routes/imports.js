import { Router } from 'express'
import multer from 'multer'
import { Client } from '../models/Client.js'
import { Invoice, nextInvoiceNumber } from '../models/Invoice.js'
import { requireAuth } from '../auth/middleware.js'
import { emitChange } from '../realtime.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB — plenty for a books export
})

export const importsRouter = Router()
importsRouter.use(requireAuth)

// Cap rows per import so one file can't create tens of thousands of records
// synchronously (each invoice also costs a DB round-trip for its number).
const MAX_ROWS = 1000

/**
 * Bulk import clients/invoices from a CSV (e.g. an export from another tool).
 * Each created row still flows through the same models the UI/agent use; a
 * single 'reloaded' emitChange per entity refreshes the dashboard without
 * spamming the activity feed with hundreds of rows. Header names are matched
 * case-insensitively with a few common aliases, so a tidy export usually works
 * with no editing.
 */

// ── tiny RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF) ──────────────
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r') {
      // ignore — handled by the \n branch
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const normKey = (s) => String(s || '').trim().toLowerCase().replace(/[\s_]+/g, '')

/** rows → array of objects keyed by normalized header; skips fully-blank rows */
function toRecords(csvText) {
  const rows = parseCsv(csvText).filter((r) => r.some((c) => c.trim() !== ''))
  if (rows.length < 2) return { headers: rows[0]?.map(normKey) || [], records: [] }
  const headers = rows[0].map(normKey)
  const records = rows.slice(1).map((r) => {
    const obj = {}
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim()
    })
    return obj
  })
  return { headers, records }
}

// pick the first present alias from a record
const pick = (rec, ...aliases) => {
  for (const a of aliases) if (rec[a]) return rec[a]
  return ''
}

function readCsvOrThrow(req) {
  if (!req.file) {
    const e = new Error('No CSV file received')
    e.status = 400
    throw e
  }
  const name = (req.file.originalname || '').toLowerCase()
  const okType =
    req.file.mimetype?.includes('csv') ||
    req.file.mimetype === 'application/vnd.ms-excel' ||
    req.file.mimetype === 'text/plain' ||
    name.endsWith('.csv')
  if (!okType) {
    const e = new Error('Please upload a .csv file')
    e.status = 400
    throw e
  }
  return req.file.buffer.toString('utf8')
}

// POST /api/import/clients — columns: name, contactName, email, phone, notes
importsRouter.post('/clients', upload.single('file'), async (req, res) => {
  const text = readCsvOrThrow(req)
  const { records } = toRecords(text)
  if (!records.length) return res.status(400).json({ error: 'No rows found. Is the file empty or missing a header row?' })
  if (records.length > MAX_ROWS)
    return res.status(413).json({ error: `Too many rows (${records.length}). Please split into files of ${MAX_ROWS} or fewer.` })

  // existing names (lowercased) so we skip duplicates without a query per row
  const existing = await Client.find({ userId: req.userId }).select('name').lean()
  const seen = new Set(existing.map((c) => c.name.trim().toLowerCase()))

  let created = 0
  const skipped = []
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    const name = pick(rec, 'name', 'client', 'clientname', 'company').trim()
    const line = i + 2 // +1 for header, +1 for 1-based
    if (!name) {
      skipped.push({ row: line, reason: 'missing name' })
      continue
    }
    if (seen.has(name.toLowerCase())) {
      skipped.push({ row: line, reason: `"${name}" already exists` })
      continue
    }
    await Client.create({
      userId: req.userId,
      name,
      contactName: pick(rec, 'contactname', 'contact', 'contactperson'),
      email: pick(rec, 'email', 'emailaddress'),
      phone: pick(rec, 'phone', 'phonenumber', 'tel'),
      notes: pick(rec, 'notes', 'note'),
    })
    seen.add(name.toLowerCase())
    created++
  }

  if (created) emitChange(req.userId, { entity: 'client', action: 'reloaded', id: null, actor: 'user' })
  res.json({ created, skipped: skipped.length, errors: skipped.slice(0, 20) })
})

// POST /api/import/invoices — columns: client, amount, dueDate, issueDate, status, notes
importsRouter.post('/invoices', upload.single('file'), async (req, res) => {
  const text = readCsvOrThrow(req)
  const { records } = toRecords(text)
  if (!records.length) return res.status(400).json({ error: 'No rows found. Is the file empty or missing a header row?' })
  if (records.length > MAX_ROWS)
    return res.status(413).json({ error: `Too many rows (${records.length}). Please split into files of ${MAX_ROWS} or fewer.` })

  // cache clients by lowercased name; auto-create missing ones on the fly
  const existing = await Client.find({ userId: req.userId }).select('name').lean()
  const byName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c._id]))
  let clientsCreated = 0

  let created = 0
  const skipped = []
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    const line = i + 2
    const clientName = pick(rec, 'client', 'clientname', 'name', 'company').trim()
    const amount = parseFloat(pick(rec, 'amount', 'total', 'value').replace(/[$,]/g, ''))
    const dueRaw = pick(rec, 'duedate', 'due', 'datedue')
    const issueRaw = pick(rec, 'issuedate', 'issue', 'date', 'issued')
    const statusRaw = pick(rec, 'status').toLowerCase()
    const notes = pick(rec, 'notes', 'note', 'description')

    if (!clientName) {
      skipped.push({ row: line, reason: 'missing client' })
      continue
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      skipped.push({ row: line, reason: 'amount must be a number greater than zero' })
      continue
    }
    if (!dueRaw || Number.isNaN(Date.parse(dueRaw))) {
      skipped.push({ row: line, reason: 'due date is missing or unreadable (use YYYY-MM-DD)' })
      continue
    }

    let clientId = byName.get(clientName.toLowerCase())
    if (!clientId) {
      const c = await Client.create({ userId: req.userId, name: clientName })
      clientId = c._id
      byName.set(clientName.toLowerCase(), clientId)
      clientsCreated++
    }

    await Invoice.create({
      userId: req.userId,
      clientId,
      number: await nextInvoiceNumber(req.userId),
      amount,
      currency: 'USD',
      issueDate: issueRaw && !Number.isNaN(Date.parse(issueRaw)) ? new Date(issueRaw) : new Date(),
      dueDate: new Date(dueRaw),
      status: ['draft', 'sent', 'paid', 'void'].includes(statusRaw) ? statusRaw : 'sent',
      notes,
      source: 'manual',
    })
    created++
  }

  if (created || clientsCreated) {
    emitChange(req.userId, { entity: 'invoice', action: 'reloaded', id: null, actor: 'user' })
    if (clientsCreated) emitChange(req.userId, { entity: 'client', action: 'reloaded', id: null, actor: 'user' })
  }
  res.json({ created, clientsCreated, skipped: skipped.length, errors: skipped.slice(0, 20) })
})

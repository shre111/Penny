import { Router } from 'express'
import { Client } from '../models/Client.js'
import { Invoice } from '../models/Invoice.js'
import { requireAuth } from '../auth/middleware.js'

export const exportsRouter = Router()
exportsRouter.use(requireAuth)

function cell(value) {
  const s = value == null ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(headers, rows) {
  return [headers.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n'
}

function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(csv)
}

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')

exportsRouter.get('/clients.csv', async (req, res) => {
  const clients = await Client.find({ userId: req.userId }).sort({ name: 1 }).lean()
  const csv = toCsv(
    ['name', 'contactName', 'email', 'phone', 'notes'],
    clients.map((c) => [c.name, c.contactName, c.email, c.phone, c.notes])
  )
  sendCsv(res, 'penny-clients.csv', csv)
})

exportsRouter.get('/invoices.csv', async (req, res) => {
  const invoices = await Invoice.find({ userId: req.userId }).sort({ dueDate: 1 }).populate('clientId', 'name')
  const csv = toCsv(
    ['number', 'client', 'amount', 'amountPaid', 'balance', 'dueDate', 'issueDate', 'status', 'notes'],
    invoices.map((doc) => {
      const i = doc.toObject({ virtuals: true })
      return [
        i.number,
        i.clientId?.name || '',
        i.amount,
        i.amountPaid,
        i.balance,
        day(i.dueDate),
        day(i.issueDate),
        i.effectiveStatus,
        i.notes,
      ]
    })
  )
  sendCsv(res, 'penny-invoices.csv', csv)
})

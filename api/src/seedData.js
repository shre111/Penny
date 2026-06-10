import mongoose from 'mongoose'
import { Client } from './models/Client.js'
import { Invoice, nextInvoiceNumber } from './models/Invoice.js'
import { Email } from './models/Email.js'
import { Memory } from './models/Memory.js'
import { Activity } from './models/Activity.js'

const daysFromNow = (d) => new Date(Date.now() + d * 86400000)

/**
 * Seeds a believable small design studio ("Bluepeak Studio"):
 * 3 overdue invoices (~$12.4k, two newly overdue), a couple due soon,
 * 5 months of paid history so the cash-flow chart tells a story.
 * Used by the CLI seeder AND the in-app "Load sample data" button.
 */
export async function seedDemoData(userId) {
  await Promise.all([
    Client.deleteMany({ userId }),
    Invoice.deleteMany({ userId }),
    Email.deleteMany({ userId }),
    Memory.deleteMany({ userId }),
    Activity.deleteMany({ userId }),
    mongoose.connection.collection('counters').deleteOne({ _id: `${userId}:invoice` }),
  ])

  const clientDefs = [
    { name: 'Acme Hardware', contactName: 'Dana Whitfield', email: 'purchasing@acmehardware.example.com' },
    { name: 'Riverside Café', contactName: 'Marco Ruiz', email: 'marco@riversidecafe.example.com' },
    { name: 'Hartley & Sons Law', contactName: 'June Hartley', email: 'accounts@hartleylaw.example.com' },
    { name: 'GreenLeaf Landscaping', contactName: 'Sam Porter', email: 'info@greenleaf.example.com' },
    { name: 'Bright Smiles Dental', contactName: 'Dr. Lena Okafor', email: 'billing@brightsmiles.example.com' },
    { name: 'Cobalt Fitness', contactName: 'Tyler Brooks', email: 'finance@cobaltfitness.example.com' },
    { name: 'Maple & Main Realty', contactName: 'Priya Nair', email: 'admin@maplemain.example.com' },
    { name: 'Sunrise Bakery', contactName: 'Rosa Delgado', email: 'hello@sunrisebakery.example.com' },
  ]
  const clients = {}
  for (const def of clientDefs) {
    const c = await Client.create({ userId, ...def })
    clients[def.name] = c._id
  }

  const invoiceDefs = [
    // ── the demo's dramatic tension: $12,400 overdue ──
    { client: 'Acme Hardware', amount: 5800, issue: -51, due: -21, status: 'sent',
      items: [{ description: 'Brand identity package', quantity: 1, unitPrice: 4200 }, { description: 'Signage design', quantity: 2, unitPrice: 800 }] },
    { client: 'Riverside Café', amount: 2400, issue: -35, due: -5, status: 'sent',
      items: [{ description: 'Menu redesign + print files', quantity: 1, unitPrice: 2400 }] },
    { client: 'Cobalt Fitness', amount: 4200, issue: -33, due: -3, status: 'sent',
      items: [{ description: 'Website design — 6 pages', quantity: 1, unitPrice: 4200 }] },
    // due soon
    { client: 'Hartley & Sons Law', amount: 3100, issue: -26, due: 4, status: 'sent',
      items: [{ description: 'Client portal UX audit', quantity: 1, unitPrice: 3100 }] },
    { client: 'Maple & Main Realty', amount: 1950, issue: -24, due: 6, status: 'sent',
      items: [{ description: 'Listing brochure templates', quantity: 3, unitPrice: 650 }] },
    // open, comfortably not due
    { client: 'Bright Smiles Dental', amount: 2750, issue: -12, due: 18, status: 'sent',
      items: [{ description: 'Patient welcome kit design', quantity: 1, unitPrice: 2750 }] },
    { client: 'GreenLeaf Landscaping', amount: 1200, issue: -5, due: 25, status: 'sent',
      items: [{ description: 'Spring campaign social kit', quantity: 1, unitPrice: 1200 }] },
    // a draft sitting in the books
    { client: 'Sunrise Bakery', amount: 880, issue: -2, due: 28, status: 'draft',
      items: [{ description: 'Seasonal packaging concepts', quantity: 1, unitPrice: 880 }] },
    // ── paid history: feeds the cash-flow chart + "collected this month" ──
    { client: 'Sunrise Bakery', amount: 1500, issue: -150, due: -120, status: 'paid', paidOn: -118,
      items: [{ description: 'Logo design', quantity: 1, unitPrice: 1500 }] },
    { client: 'Cobalt Fitness', amount: 3600, issue: -140, due: -110, status: 'paid', paidOn: -112,
      items: [{ description: 'Brand guidelines', quantity: 1, unitPrice: 3600 }] },
    { client: 'Hartley & Sons Law', amount: 2800, issue: -115, due: -85, status: 'paid', paidOn: -83,
      items: [{ description: 'Stationery suite', quantity: 1, unitPrice: 2800 }] },
    { client: 'Acme Hardware', amount: 4500, issue: -105, due: -75, status: 'paid', paidOn: -70,
      items: [{ description: 'Product catalog design', quantity: 1, unitPrice: 4500 }] },
    { client: 'Bright Smiles Dental', amount: 2200, issue: -80, due: -50, status: 'paid', paidOn: -49,
      items: [{ description: 'Website refresh', quantity: 1, unitPrice: 2200 }] },
    { client: 'Maple & Main Realty', amount: 5200, issue: -75, due: -45, status: 'paid', paidOn: -41,
      items: [{ description: 'Office branding package', quantity: 1, unitPrice: 5200 }] },
    { client: 'GreenLeaf Landscaping', amount: 1800, issue: -55, due: -25, status: 'paid', paidOn: -22,
      items: [{ description: 'Truck wrap design', quantity: 1, unitPrice: 1800 }] },
    { client: 'Riverside Café', amount: 950, issue: -45, due: -15, status: 'paid', paidOn: -13,
      items: [{ description: 'Event poster series', quantity: 1, unitPrice: 950 }] },
    { client: 'Sunrise Bakery', amount: 2600, issue: -38, due: -8, status: 'paid', paidOn: -6,
      items: [{ description: 'Monthly retainer — design support', quantity: 2, unitPrice: 1300 }] },
    { client: 'Hartley & Sons Law', amount: 3400, issue: -30, due: -2, status: 'paid', paidOn: -1,
      items: [{ description: 'Annual report layout', quantity: 1, unitPrice: 3400 }] },
  ]

  for (const def of invoiceDefs) {
    const inv = await Invoice.create({
      userId,
      clientId: clients[def.client],
      number: await nextInvoiceNumber(userId),
      lineItems: def.items,
      amount: def.amount,
      issueDate: daysFromNow(def.issue),
      dueDate: daysFromNow(def.due),
      status: def.status === 'paid' ? 'paid' : def.status,
      payments: def.status === 'paid' ? [{ amount: def.amount, date: daysFromNow(def.paidOn), method: 'bank transfer' }] : [],
      source: 'manual',
    })
    if (def.status === 'paid' && inv.balance > 0) throw new Error('seed: paid invoice has balance')
  }

  await Memory.create([
    { userId, fact: 'The business is a small design studio; clients are mostly local small businesses.' },
    { userId, fact: 'Prefers payment reminder emails to be warm and friendly, never aggressive.' },
  ])

  return { clients: clientDefs.length, invoices: invoiceDefs.length }
}

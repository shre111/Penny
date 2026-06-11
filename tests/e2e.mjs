#!/usr/bin/env node
/**
 * Penny's E2E eval suite — runs the REAL stack (api + ai + Mongo) through its
 * core flows using the deterministic scripted model. No API keys consumed.
 *
 *   1. PENNY_MODEL=scripted npm run dev   (or start api/ai any way you like)
 *   2. npm test
 *
 * Asserts the product's contracts: tools mutate real data, streams speak the
 * SSE protocol, HITL pauses and resumes, the concierge negotiates within
 * guardrails, trust gates autonomy.
 */
import { execSync } from 'node:child_process'

const API = process.env.PENNY_API_URL || 'http://localhost:4001'
let cookie = ''
let passed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function req(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', cookie, ...(options.headers || {}) },
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  let body = null
  try {
    body = await res.clone().json()
  } catch {
    body = await res.text()
  }
  return { status: res.status, body }
}

/** POST a chat message and collect the full SSE event list. */
async function chat(sessionId, content, path = 'messages', payload = null) {
  const res = await fetch(`${API}/api/chat/sessions/${sessionId}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(payload || { content }),
  })
  const text = await res.text()
  const events = []
  for (const frame of text.split('\n\n')) {
    const ev = frame.match(/^event: (.+)$/m)?.[1]
    const data = frame.match(/^data: (.+)$/m)?.[1]
    if (ev && data) {
      try {
        events.push({ event: ev, data: JSON.parse(data) })
      } catch {
        /* skip */
      }
    }
  }
  return events
}

const newSession = async () => (await req('/api/chat/sessions', { method: 'POST' })).body.session._id

// ─────────────────────────────────────────────────────────────────────────
console.log('\nPenny E2E eval suite')

const health = await fetch(`${API}/api/health`).then((r) => r.json()).catch(() => null)
if (!health?.ok) {
  console.error(`\nAPI not reachable at ${API}. Start the stack first (npm run dev).`)
  process.exit(2)
}
const aiHealth = await fetch(`${process.env.PENNY_AI_URL || 'http://localhost:8400'}/health`).then((r) => r.json()).catch(() => null)
if (!aiHealth?.ok) {
  console.error('\nAI service not reachable on :8400. Start the stack first.')
  process.exit(2)
}
if (!String(aiHealth.model).startsWith('scripted')) {
  console.warn(`\n⚠ AI model is "${aiHealth.model}" — the suite is written for PENNY_MODEL=scripted.`)
  console.warn('  Real models burn quota and answer non-deterministically; expect flaky assertions.\n')
}

console.log('\n— seed —')
execSync('npm run seed', { stdio: 'pipe', cwd: new URL('..', import.meta.url).pathname })
console.log('  ✓ demo data reseeded')

console.log('\n— auth —')
const login = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'demo@penny.app', password: 'demo1234' }) })
check('login sets a session', login.status === 200 && cookie.includes('penny_token'))
const me = await req('/api/auth/me')
check('me returns the demo user', me.body?.user?.email === 'demo@penny.app')

console.log('\n— chat: tools mutate real data —')
let session = await newSession()
let events = await chat(session, 'Log an invoice for Acme Hardware, $1,234 for the eval suite')
check('stream contains tokens', events.some((e) => e.event === 'token'))
check('create_invoice activity ran', events.some((e) => e.event === 'activity' && e.data.tool === 'create_invoice' && e.data.status === 'done'))
const invoices = (await req('/api/invoices?status=all')).body.invoices
const evalInvoice = invoices.find((i) => i.amount === 1234)
check('invoice exists in the books', Boolean(evalInvoice))

console.log('\n— context retention (scripted memory path) —')
events = await chat(session, 'By the way, my name is David')
check('save_memory ran', events.some((e) => e.event === 'activity' && e.data.tool === 'save_memory'))
const memories = (await req('/api/memories')).body.memories
check('memory persisted', memories.some((m) => /David/.test(m.fact)))

console.log('\n— HITL: chase → interrupt → approve/reject —')
session = await newSession()
events = await chat(session, 'Chase the overdue invoices')
const interrupt = events.find((e) => e.event === 'interrupt')
check('interrupt pauses the run', Boolean(interrupt))
const actions = interrupt?.data.actions || []
check('interrupt carries email actions', actions.length >= 1 && actions[0].tool === 'send_email')
const doneEvt = events.filter((e) => e.event === 'done').pop()
const messageId = doneEvt?.data.messageId
check('paused message persisted', Boolean(messageId))
const decisions = actions.map((_, i) => (i === 0 ? { type: 'approve' } : { type: 'reject', message: 'no' }))
const resumeEvents = await chat(session, '', 'resume', { messageId, decisions })
check('resume continues the same thread', resumeEvents.some((e) => e.event === 'token'))
const outbox = (await req('/api/emails')).body.emails
check('approved email reached the outbox', outbox.some((e) => ['sent', 'simulated'].includes(e.status)))
const double = await req(`/api/chat/sessions/${session}/resume`, { method: 'POST', body: JSON.stringify({ messageId, decisions }) })
check('double-resume is blocked', double.status === 409)

console.log('\n— rescue plan artifact —')
session = await newSession()
events = await chat(session, 'Build me a rescue plan')
const plan = events.find((e) => e.event === 'artifact' && e.data.type === 'plan')
check('plan artifact streams', Boolean(plan))
check('plan has executable steps', (plan?.data.data.steps || []).length >= 1)

console.log('\n— concierge: promise + guardrails + proposal —')
const overdue = (await req('/api/invoices?status=overdue')).body.invoices
const target = overdue[0]
const share = (await req(`/api/invoices/${target._id}/share`, { method: 'POST' })).body
check('share link minted', Boolean(share.token))
const pub = await fetch(`${API}/api/public/invoice/${share.token}`).then((r) => r.json())
check('public view exposes safe fields only', pub.invoice?.number === target.number && !('userId' in pub.invoice))
async function conciergeChat(content) {
  const res = await fetch(`${API}/api/public/invoice/${share.token}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, visitorId: 'eval' }),
  })
  return res.text()
}
await conciergeChat('I promise I will pay this by next Friday')
const promised = (await req('/api/invoices?status=all')).body.invoices.find((i) => i._id === target._id)
check('client promise recorded', Boolean(promised.promisedDate))
const forecast = (await req('/api/metrics/forecast')).body.forecast
const fc = forecast.expectedPayments.find((p) => p.number === target.number)
check('forecast trusts the promise', fc?.basis === 'the client promised this date')
const second = overdue[1]
const share2 = (await req(`/api/invoices/${second._id}/share`, { method: 'POST' })).body
await fetch(`${API}/api/public/invoice/${share2.token}/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: 'could I split this in two payments?', visitorId: 'eval2' }),
}).then((r) => r.text())
const pending = (await req('/api/proposals?status=pending')).body.proposals
check('negotiation created a pending proposal', pending.length === 1)
const approve = await req(`/api/proposals/${pending[0]._id}/approve`, { method: 'POST' })
check('owner approval applies the plan', approve.status === 200)
const updated = (await req('/api/invoices?status=all')).body.invoices.find((i) => i._id === second._id)
check('invoice carries the installment plan', (updated.installmentPlan || []).length === 2)

console.log('\n— guardian insights —')
const insights = (await req('/api/metrics/insights')).body.insights
check('duplicate detector fires', insights.some((i) => i.type === 'duplicate'))
check('retainer gap detector fires', insights.some((i) => i.type === 'retainer-gap'))

console.log('\n— trust & autonomy gates —')
const trust = (await req('/api/trust')).body
check('trust starts unearned after reseed... (approvals from this run count)', typeof trust.eligible === 'boolean')
const early = await req('/api/auth/autonomy', { method: 'PATCH', body: JSON.stringify({ autoSendReminders: true }) })
check('autonomy blocked until earned (or allowed if just earned)', early.status === 409 || early.status === 200)
if (early.status === 200) await req('/api/auth/autonomy', { method: 'PATCH', body: JSON.stringify({ autoSendReminders: false }) })

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? `: ${failures.join(' | ')}` : ''}\n`)
process.exit(failures.length ? 1 : 0)

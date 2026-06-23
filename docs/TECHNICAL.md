# Penny — Technical Deep-Dive

The complete engineering picture: how each piece works, why it's built that way, what it can't do yet. Companion documents: [README](../README.md) (product overview), [DECISIONS.md](../DECISIONS.md) (architectural trade-offs), [ROADMAP.md](../ROADMAP.md) (history & next).

---

## 1. System overview

Three deployables, one database cluster:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ penny-app (Render web service, Node 20+)                                 │
│                                                                          │
│  web/   React 19 SPA — built by Vite, served statically by Express      │
│  api/   Express 5 — auth, domain CRUD, chat persistence, SSE relay,     │
│         Socket.IO hub, crons (overnight 06:00, autonomy sweep */1)      │
└───────────────┬────────────────────────────────────┬─────────────────────┘
                │ REST + service token               │ Mongo driver
┌───────────────▼───────────────────┐   ┌────────────▼─────────────────────┐
│ penny-ai (Render web service)     │   │ MongoDB Atlas                    │
│ FastAPI + LangChain 1.x/LangGraph │   │  db `penny`       — app data    │
│ agents · tools · vision · Composio│   │  db `penny_agent` — checkpoints │
└───────────────────────────────────┘   └──────────────────────────────────┘
```

- **Single origin in production**: Express serves `web/dist`, so cookies stay first-party and there is no CORS surface.
- **Single write path**: every mutation — human click or agent tool — goes through the same Express routes. That one seam powers validation, Socket.IO live updates, the audit trail, and actor attribution.
- **Dev parity**: `npm run dev` runs all three locally (Vite proxies `/api` + `/socket.io`); a `free-ports` preflight kills stale listeners. Root `.env` is shared by both servers.

## 2. The services

### 2.1 `api/` — Express 5

| Module | Responsibility |
|---|---|
| `auth/middleware.js` | JWT (7d) in an httpOnly `SameSite=Lax` cookie; `requireAuth` for browsers, `requireUserOrService` lets the AI service act *as a user* via `X-Service-Token` + `X-User-Id` + `X-Actor: agent` |
| `auth/routes.js` | signup/login/logout/me (bcryptjs), Google ID-token verification (`google-auth-library`), concierge guardrails PATCH, autonomy PATCH (gated by trust) |
| `routes/invoices.js` | CRUD + payments + per-user atomic numbering (`counters` collection) + share-token minting + client payment promises |
| `routes/metrics.js` | summary KPIs, chart series, **forecast** (payment-personality model), **insights** (guardian heuristics), briefing |
| `routes/chat.js` | sessions/messages CRUD + the **SSE relay**: pipes the AI stream to the browser byte-for-byte while parsing a copy to persist the final assistant message and interrupt state |
| `routes/public.js` | the tokenized client-facing invoice API: view, PDF, rate-limited concierge chat relay (30 msgs/hr/token, in-memory buckets) |
| `routes/proposals.js` | client-negotiated arrangements: create (service), approve→apply-to-books / decline (owner) |
| `routes/emails.js` | outbox; approve (with edit detection feeding trust) / dismiss / cancel; queued→scheduled upgrade under earned autonomy |
| `realtime.js` | Socket.IO hub. `emitChange()` is called by every mutation: emits `entity:changed {entity, action, id, actor, doc}` to the user's room **and** persists an `Activity` row — UI and audit can never disagree |
| `overnight.js` | 06:00 cron (draft reminders per user) + minute cron (fire scheduled auto-sends past their cancel window) |
| `trust.js` | earned-autonomy math over the last 10 reminder decisions |
| `routes/invoicePdf.js` | pdfkit renderer (branded, single page), shared by the authed and public routes |

### 2.2 `ai/` — FastAPI + LangChain 1.x / LangGraph

| Module | Responsibility |
|---|---|
| `agent.py` | `create_agent` graphs. Multi-agent topology: **Penny (supervisor)** with `ask_bookkeeper` / `ask_analyst` subagents-as-tools, `send_email` + `save_memory` kept at supervisor level; `HumanInTheLoopMiddleware(interrupt_on={"send_email"})`; `MongoDBSaver` checkpointer keyed by chat-session id; cross-session memories injected into the system prompt per run. `PENNY_MULTI_AGENT=false` collapses to a single agent |
| `tools.py` | ~14 tools as httpx wrappers over the Node API (never Mongo directly), grouped bookkeeping / analyst / outreach / memory. Analyst owns `make_chart` (3 kinds) and `make_rescue_plan` |
| `concierge.py` | the client-side persona: per-request agent scoped to ONE invoice, with `get_invoice_pdf_link`, `record_payment_promise`, `propose_arrangement` — guardrails (max extension days / max installments / balance match) validated **in the tool**, not just in the prompt |
| `streaming.py` | translates `agent.stream(..., stream_mode=["messages","updates"], subgraphs=True)` into the SSE protocol below; maps tool results to UI artifacts; normalizes HITL interrupt payloads |
| `overnight.py` | reminder drafting: cooldown + dedupe + cap, model-written drafts (template fallback so the night shift never dies), tone informed by stored memories |
| `extraction.py` | Gemini vision with `with_structured_output(Pydantic)` → typed invoice proposal |
| `scripted_model.py` | a deterministic `BaseChatModel` with per-role behaviors (supervisor/bookkeeper/analyst/concierge/single). `PENNY_MODEL=scripted` runs the entire product with zero API keys — it is also the E2E test harness |
| `composio_client.py` | Gmail send via Composio's current SDK (dynamic toolkit-version pinning); graceful `simulated` fallback |

### 2.3 `web/` — React 19 + Tailwind v4

- **State**: React context for auth/theme only; data via `useLiveData` (fetch + refetch on relevant `entity:changed` socket events + agent-glow highlight set). No global store — the server is the store.
- **Chat**: `useChatStream` reads the POST-response body as an SSE stream (EventSource is GET-only), accumulates tokens/activity/artifacts/interrupts, emits dashboard spotlights from tool activity.
- **Design system**: hand-rolled tokens in `index.css` `@theme` (warm paper / ledger green / copper). Three themes (`paper`/`light`/`dark`) are pure CSS-variable overrides on `<html data-theme>` — components never change; a semantic `--color-card` token decouples surfaces from `text-white`. Charts read theme colors via a hook (SVG attrs can't use `var()`).
- **Layout**: split view with a draggable divider (340px–60vw, localStorage-persisted, double-click reset); mobile collapses to a tab bar.
- **Voice**: Web Speech API both directions — mic input with live transcripts, briefing read-aloud, and a hands-free loop (speak → auto-listen → auto-submit).

## 3. Cross-service contracts

**SSE event protocol** (ai → api → browser, one shape everywhere — owner chat, resume, concierge):

```
token     {text}                                      assistant prose
activity  {id, tool, label, status, agent}            friendly working feed (id = tool_call_id; running→done merge)
artifact  {type: chart|invoices|extraction|plan, data}
interrupt {actions: [{id, tool, args, description}]}  HITL pause
error     {message, detail?}
done      {messageId?}
```

The Express relay forwards bytes untouched (latency) while parsing a copy (persistence). Client disconnect aborts the upstream via `AbortController`.

**Service auth**: `X-Service-Token` (shared secret) + `X-User-Id` (act-as) + `X-Actor: agent`. The actor flows into socket events → glow animations and audit attribution come from the transport, not from heuristics.

**Resume (HITL)**: `POST /api/chat/sessions/:id/resume {messageId, decisions:[{type: approve|edit|reject, ...}]}` → relay → `agent.stream(Command(resume={"decisions": ...}))` on the same `thread_id`. Double-resume blocked by a `pending→resolved` flip in Mongo.

## 4. The agent layer, in depth

- **Why subagents-as-tools**: it is the current LangChain 1.x idiom (the `langgraph-supervisor` package is legacy). Bookkeeper/Analyst are stateless per call; conversation state lives only in the supervisor's checkpointer. Subgraph streaming (`subgraphs=True`) lets the UI attribute nested tool work ("Bookkeeper · Checking the invoices…").
- **Why `send_email` stays on the supervisor**: interrupts from *nested* graphs are a complex seam; keeping the only interrupt at the top level makes pause/resume one well-tested path.
- **Context, two layers**: (1) in-session = LangGraph checkpoints in `penny_agent` (thread = chat session) — survives restarts, which also means *pending approvals survive deploys*; (2) cross-session = a `memories` collection injected into the system prompt (saved via a `save_memory` tool when the owner states durable facts).
- **Model strategy**: provider-agnostic via `init_chat_model`, switched by `PENNY_MODEL`. Free-tier reality (June 2026): `gemini-3-flash-preview` ≈ 20 req/day (demo-only), `gemini-3.1-flash-lite` ≈ 1,500/day (daily driver). One multi-agent turn costs 4–7 requests because every tool result round-trips the model.
- **The scripted model**: every role has canned decision rules driving REAL tools — so streaming, sockets, HITL, multi-agent routing, the concierge, autonomy and rescue plans are all E2E-testable offline and deterministically. It also means a reviewer can run the full product with no keys.

## 5. Feature implementation notes

| Feature | How it actually works |
|---|---|
| **Live dashboard (centerpiece)** | agent tool → Node route → `emitChange` → socket → `useLiveData` refetch; `actor==='agent'` ids glow for 3s |
| **Morning briefing** | computed server-side (`/api/metrics/briefing`) — numbers can't hallucinate; rendered as UI, spoken via speechSynthesis |
| **Overnight agent** | 06:00 cron → per user with overdue invoices → AI drafts (cooldown 3d, cap 5, skip already-queued) → `status:'queued'` outbox rows → "While you were away" card with per-draft Send / Edit / Skip |
| **Earned autonomy** | trust = last 10 decided reminders; ≥5 approved-untouched and 0 skipped unlocks the toggle (server-enforced 409 otherwise). With autonomy ON, queued drafts upgrade to `scheduled` + `sendAt = now+15m`; a minute-cron fires due ones; Outbox shows a live countdown-cancel. Eligibility gates the *unlock*; an explicit grant persists until revoked (a silent auto-revoke felt broken in testing) |
| **Client concierge** | invoice `shareToken` (crypto, base64url) → public page `/invoice/:token`; concierge agent gets ONLY that invoice snapshot in its prompt; promises hit `/api/invoices/:id/promise`; arrangements hit `/api/proposals` after in-tool guardrail validation; owner approve applies to the books (extension → dueDate; installments → plan + first-installment due) |
| **Payment personalities** | per client: mean(final payment date − due date) over paid invoices, n≥2 required; labels on Clients tab, exposed to the agent in `list_clients` |
| **Cash-flow forecast** | expected date = due + max(0, avgDaysLate), overridden by client *promises* (first-party signal); slipped/overdue collapse to ~today+3; bucketed into 8 weekly bars with a per-payment "why" line |
| **Guardian ("Penny noticed")** | pure heuristics: duplicate = same client+amount, both unpaid, issued <30d apart; retainer gap = retainer history and no non-draft invoice in >35d; broken promise = promisedDate passed, still unpaid. Surfaced in briefing + `things_penny_noticed` in agent metrics |
| **Rescue plan** | analyst tool composes steps from overdue + insights + forecast → `plan` artifact → checklist card whose "Do it" buttons prefill the composer (`askPenny` event bus) |
| **Document extraction** | upload → multer (memory) → FastAPI → Gemini vision structured output → `extraction` artifact → human confirms → normal invoice POST (`source:'document'`) |
| **Audit + undo** | `emitChange` persists `Activity` rows (skipping bulk reloads); agent-created invoice/client records carry an `undo` descriptor; undo endpoint reverses and marks `undoneAt` |
| **PDF** | pdfkit, shared renderer for authed + public routes; explicit footer positioning (page-overflow gotcha) |
| **Spotlight ("Penny's pointer")** | activity events map tool→dashboard region; window-event bus; 2.4s CSS ring animation |
| **RAG knowledge base** | paste/upload → paragraph-aware chunking (AI service) → Gemini embeddings (hashed-BoW zero-key fallback) → vectors stored in Mongo → `search_knowledge` embeds the query and ranks by exact cosine (SMB corpora are tiny; Atlas $vectorSearch is the scale path) → both personas answer with citations |
| **Reply ingestion** | Composio GMAIL_FETCH_EMAILS (version-pinned) → sender matched to clients with open invoices → structured-output intent read (keyword fallback) → stated dates become payment promises |
| **Weekly digest** | Sunday 18:00 cron → metrics+insights+forecast gathered → model-composed (template fallback) → sent to the OWNER via their own Gmail, recorded in outbox |
| **Invoice drawer** | row click → side panel joining the invoice with its emails, proposals and activity (new invoiceId/entityId query filters) |
| **PWA + a11y** | manifest + generated icons (installable); skeleton loaders; aria-live streaming region |

## 6. Data model (Mongo, db `penny`)

`users` (auth + `concierge` guardrails + `autonomy`) · `clients` · `invoices` (lineItems, payments[], virtuals: `amountPaid`/`balance`/`effectiveStatus`/`daysOverdue`; share/promise/installmentPlan fields) · `chatsessions` / `messages` (events, artifacts, interrupt state) · `emails` (outbox: queued/scheduled/sent/simulated/failed/dismissed + `sendAt`, `editedByOwner`) · `proposals` · `memories` · `activities` · `counters` (atomic invoice numbering). Money/overdue math lives **only** in Invoice virtuals — UI, metrics and tools all read the same rule.

## 7. Security posture

- Passwords bcrypt(10); JWT httpOnly cookie; Google sign-in verified server-side (`verifyIdToken`), no client-trusted identity.
- Auth endpoints are brute-force-hardened: per-IP rate limits on login/signup/google plus a per-email lockout (5 failures / 15 min) — `api/src/rateLimit.js`.
- Defense-in-depth on top of the `SameSite=Lax` cookie: an Origin/Referer CSRF guard rejects cross-site state-changing requests (exempting service-token and non-browser callers), and baseline security headers (HSTS in prod, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, no `X-Powered-By`) — `api/src/security.js`.
- Service-to-service shared secret; AI never holds DB write access of its own.
- Public surface = three tokenized endpoints; tokens are 144-bit random; chat is rate-limited per token; the concierge agent's prompt contains a single invoice and guardrails are enforced in code, not prose.
- Secrets only in env; `.env`, the brief, and OAuth client secrets are gitignored; history scanned for key patterns (CI-able one-liner in DEPLOY.md).
- Not done (knowingly): a synchronizer-token CSRF scheme (the Origin check + SameSite=Lax cover the common cases), password reset & email verification (no transactional email provider — owner mail goes through their own Gmail), per-recipient concierge PINs (share link is bearer auth), per-user encryption at rest.

## 8. Honest limitations

- **Free-tier physics**: Gemini RPM/RPD limits (the UI surfaces a friendly wait message); Render free instances cold-start ~1 min after 15 min idle.
- **Forecast is arithmetic, not ML** — by design (explainability), but it needs ≥2 paid invoices per client to say anything, and it ignores seasonality/amount-dependence.
- **Single currency display** (USD formatting); no recurring-invoice engine (the guardian *notices* missing retainers; it doesn't generate them).
- **Concierge identity**: the share link is bearer auth — anyone with the URL is "the client". Fine for v1 (same trust model as e-sign links); per-recipient PINs would be next.
- **In-memory rate limiting** resets on restart and isn't shared across instances (single-instance assumption).
- **Hands-free mode** depends on browser speech APIs (Chrome/Edge/Safari); interim transcripts can mis-trigger in noisy rooms.
- **Agent routing** is probabilistic: the supervisor occasionally picks the Analyst where the Bookkeeper would do (answers stay correct — tools are shared truths); HITL + undo are the safety nets for the rest.
- Cron schedules run in server-local time; per-user timezones not yet modeled.

## 9. What makes it different (the uniqueness ledger)

1. **Two-sided agency**: the same assistant serves the owner *and* the owner's clients (concierge with bounded negotiation + owner veto) — invoices become conversations, not documents.
2. **Earned autonomy**: permission to act alone is unlocked by demonstrated trust, then bounded by a cancel window — autonomy as a *progression system*, not a checkbox.
3. **First-party forecasting**: client *promises* (collected conversationally) outrank statistical inference; payment personalities make the inference explainable.
4. **A truly closed loop**: night-shift drafting → morning approvals → live dashboard → audit trail with undo → guardian warnings → executable rescue plans. Every loop ends with the human in charge.
5. **Test harness as a feature**: the scripted model makes an LLM product deterministically testable — and runnable by reviewers with zero keys.

## 10. Testing approach

- Scripted-model E2E over the real stack (curl SSE flows for chat, HITL approve/edit/reject, concierge promise/negotiate/guardrail, autonomy ladder incl. cron-fired send).
- Playwright (system Chrome) visual passes for every UI surface; screenshots reviewed at each milestone.
- Real-model verification on Gemini: the brief's "David" test, multi-agent routing, vision extraction field-accuracy, overnight drafting tone.
- Static: eslint (0 errors policy), `tsc -b`, `node --check`, `py_compile`.
- **`npm test`**: a 26-assertion eval suite driving the running stack end-to-end on the scripted model — auth, tool mutations, HITL interrupt/resume/double-resume, concierge promises + guardrails + proposals, guardian detectors, trust gating. Deterministic, key-free, finishes in ~15s.
- Observability: set `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY` and LangChain traces every agent run, tool call and token count automatically.

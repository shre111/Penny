# Decision log

The reasoning behind the architecture — written to be defensible in a final-round interview. Newest last.

## 1. Product: invoice copilot, not a research bot
**Context:** The brief explicitly hints at an "invoice copilot" and "an application that works alongside your chat, controlled by the chat", for an audience of SMB owners/CEOs, 35+, non-technical.
**Decision:** Build an AI back office (invoices, clients, cash flow) with a live dashboard the agent controls.
**Why:** It's a genuine business problem (chasing receivables is universal SMB pain), it makes tool use *visible* (the dashboard moves), and it matches their own above-and-beyond example. A research/web-search bot was the obvious alternative — and the obvious choice for most candidates, with output that's just text.

## 2. Stack: MERN web app + separate Python FastAPI AI service
**Context:** M32 states a preference for MERN, with MERN or Python/FastAPI for AI services and LangChain/LangGraph "strongly preferred".
**Decision:** React+Express+Mongo for the product; a separate FastAPI service for the agents; LangGraph in Python.
**Why:** Matches their stated stack exactly and shows polyglot + service-boundary design. Cost: one cross-service seam (chat streaming) — addressed in #5/#6.

## 3. Agent tools call the Node REST API — never Mongo directly
**Decision:** Every AI tool is an httpx call to the same Express routes the UI uses, authenticated with a service token (`X-Service-Token`) acting on behalf of the user (`X-User-Id`), tagged `X-Actor: agent`.
**Why:** One write path → one validation layer → one place that emits Socket.IO events. The centerpiece (dashboard reacts live to the agent, with "Penny did this" glow) falls out of this for free, for human and agent writes alike. The alternative — the Python service writing Mongo directly — would have needed change streams or a second event emitter and two schema layers drifting apart.

## 4. Multi-agent as subagents-as-tools; `send_email` stays on the supervisor
**Context:** LangChain 1.x deprecated the `langgraph-supervisor` package idiom; the current pattern is wrapping specialist agents as tools. Human-in-the-loop interrupts inside *nested* subgraphs are a complex seam.
**Decision:** Penny (supervisor, checkpointed, HITL middleware) delegates to stateless Bookkeeper and Analyst subagents; email drafting/sending lives on the supervisor.
**Why:** Real multi-agent topology with visible teamwork, while the interrupt/resume cycle — the most failure-prone flow in the app — stays a single well-tested seam at the top level. Pragmatism over purity: an Outreach *subagent* that interrupts from inside a tool call was the riskier design with near-zero demo upside.

## 5. SSE over fetch-ReadableStream (not EventSource), relayed through Express
**Decision:** Browser POSTs a message and reads the response body as an SSE stream; Express pipes the FastAPI stream through untouched while parsing a copy.
**Why:** EventSource is GET-only — chat needs a POST body. Relaying through Express keeps a single origin (cookies stay first-party, no CORS) and lets the API persist the final assistant message + approval state at stream end, so the AI service stays stateless about chat history.

## 6. Sync LangGraph streaming in a threadpool (not async)
**Decision:** The FastAPI endpoints return `StreamingResponse` over a *sync* generator using `agent.stream()` and the sync `MongoDBSaver`.
**Why:** The async story for checkpointers has version-specific edge cases; Starlette runs sync generators in a worker threadpool automatically. Boring, correct, and it shipped. Trade-off: a worker thread per active stream — fine at take-home scale, revisit for real concurrency.

## 7. Conversation state: LangGraph MongoDB checkpointer keyed by chat-session id
**Decision:** `MongoDBSaver` in Atlas, `thread_id = chat session _id`; messages *also* persisted in our own collection for the history UI.
**Why:** In-session context retention (the brief's "David" test) with zero custom state code — and because checkpoints live in the database, **pending approvals survive restarts**: Render's free tier can sleep mid-approval and the card still works after wake. That's a production argument, not a demo trick.

## 8. HITL via `HumanInTheLoopMiddleware`, decisions = approve / edit / reject
**Decision:** Gate only `send_email`. Surface interrupts as approval cards; resume with the middleware's decisions schema; mark the card consumed in Mongo to block double-resume.
**Why:** Nothing leaves the building without an explicit yes — the trust feature this audience needs, and "edit before send" demos beautifully. Gating only the externally-visible action keeps the agent fluid for everything reversible.

## 9. A scripted model behind the real model interface
**Decision:** `PENNY_MODEL=scripted` swaps in a deterministic role-aware fake model (supervisor/bookkeeper/analyst behaviors) that drives the *real* graph, tools, DB, sockets and HITL.
**Why:** The riskiest seams (relay streaming, interrupt/resume across three services, multi-agent event namespacing) were E2E-verified without an API key and without burning rate-limited quota. It doubles as reviewer mode: the full product runs with zero keys. The language is canned; everything else is real.

## 10. Money math lives in Mongoose virtuals
**Decision:** `balance`, `amountPaid`, `effectiveStatus` ('overdue' is *derived*: sent + past due + unpaid), `daysOverdue` are virtuals; queries that need "overdue" filter in JS after the date pre-filter.
**Why:** Overdue is a function of *time* — storing it would rot the moment midnight passes. One implementation feeds the UI, the metrics endpoints and the agent tools. Trade-off: can't index the derived status; irrelevant at SMB data sizes.

## 11. Custom Tailwind design system, no component library
**Decision:** Hand-rolled tokens (warm paper, ledger green, copper for the Penny brand), Fraunces serif wordmark, custom buttons/cards/chips. No shadcn/Material.
**Why:** The brief says "make it not look like Streamlit" and the audience is non-technical owners — default component libraries read as developer tools. Also avoids a CLI/config fight inside a 2-day budget. Trade-off: hand-built dropdown/modal primitives; acceptable at this scope.

## 12. Local quirks worth knowing (not really decisions)
- AI service runs on **8400** because a Docker Chroma container owns 8000 on this machine; API on **4001** by user preference.
- `ai/.venv` is Python **3.13** — the 3.14 install's `ensurepip` is broken.
- `npm run dev` runs a `free-ports` preflight (kills stale listeners on 4001/8400) after background processes repeatedly shadowed config changes during development.
- The brief's `requirement.txt` contains an OpenAI key shared with all candidates: gitignored, never used — assume it's revoked/rate-limited, and using it would put demo traffic on someone else's bill.

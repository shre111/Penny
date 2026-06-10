# Penny — your AI back office 🪙

**A copilot that actually runs a small business's books — not just talks about them.**

Penny is a chat assistant welded to a live business dashboard. A business owner talks to her in plain words; she does real work with real records — and the dashboard updates in front of you while she works.

> "Log an invoice for Acme, $4,500, due July 1" → *the invoice pops onto the dashboard, glowing*
> "Who owes me money?" → *a table and a chart, from your actual books*
> "Chase the overdue invoices" → *she drafts warm reminder emails; you approve, edit or skip each one before anything sends*
> *Drag a photo of an invoice into the chat* → *she reads it, you confirm, it's in the books*

Built for M32's take-home project — aimed squarely at their audience: **small-business owners, 35+, not technical.** No jargon ("money owed to you", never "accounts receivable aging"), big type, suggested buttons everywhere, and a hard rule that nothing external (emails) happens without explicit owner approval.

---

## The team of agents

Penny is a **LangGraph multi-agent system** (subagents-as-tools, LangChain 1.x):

```
                        you, chatting
                             │
                   ┌─────────▼─────────┐      send_email is gated by
                   │  Penny, supervisor │──── HumanInTheLoopMiddleware:
                   │  (writes emails,   │      every email pauses for your
                   │  remembers facts)  │      approve / edit / skip
                   └───┬───────────┬───┘
            ask_bookkeeper       ask_analyst
                   ┌───▼────┐    ┌────▼───┐
                   │ Book-  │    │Analyst │
                   │ keeper │    │metrics,│
                   │ CRUD   │    │ charts │
                   └───┬────┘    └────┬───┘
                       └──────┬───────┘
                 every tool calls the Node REST API
                              │
            ┌─────────────────▼──────────────────┐
            │   one write path → one validation   │
            │   layer → Socket.IO event on every  │
            │   mutation → the dashboard reacts   │
            │   live, human and agent alike       │
            └─────────────────────────────────────┘
```

You can watch the team work: the chat shows a friendly activity feed ("Bookkeeper · Checking the invoices…", "Analyst · Drawing your chart…") as each agent acts.

## Architecture

```
┌────────────────────────────  Render service 1  ────────────────────────────┐
│ web/  React 19 + Vite + Tailwind v4 + Recharts (static build, no CORS)     │
│       chat streaming via fetch-ReadableStream SSE · Socket.IO live updates │
│ api/  Node + Express 5 + Mongoose ─── MongoDB Atlas                        │
│       auth: bcrypt + JWT httpOnly cookie · Google OAuth (ID-token verify)  │
│       invoices/clients/metrics CRUD · chat persistence · SSE relay to ai/  │
│       Socket.IO emit on EVERY mutation, tagged with who did it             │
└──────────────────────────────────┬──────────────────────────────────────────┘
                     shared secret · X-User-Id · X-Actor: agent
┌──────────────────────────────────▼──────────  Render service 2  ───────────┐
│ ai/   Python FastAPI + LangChain 1.x / LangGraph                           │
│       supervisor + subagents (above) · MongoDBSaver checkpointer           │
│       HumanInTheLoopMiddleware on send_email · Gemini vision extraction    │
│       Composio Gmail (with graceful simulated-outbox fallback)             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## What's in the box

**The basics (required)**
- Sign up / sign in / sign out — email+password **and Google OAuth**
- Streaming chat with an LLM agent that uses ~11 real tools
- Context retention within a session (LangGraph checkpointer in Mongo, keyed by chat session)
- Multiple conversations, history persisted

**Above & beyond**
- **An app controlled by the chat** — the live dashboard (KPIs, invoice table, aging & cash-flow charts, outbox) updates in real time as the agent works; agent-made changes glow so you can see exactly what she touched
- **Multi-agent team** you can watch working (supervisor + Bookkeeper + Analyst)
- **Human-in-the-loop approvals** — approve / **edit** / skip every email before it sends; pending approvals survive server restarts (the pause lives in the Mongo checkpoint, not in RAM)
- **Document intelligence** — drag an invoice photo/PDF into chat; Gemini vision extracts it into a confirm-card; one click books it
- **Proactive morning briefing** — Penny opens with what changed: newly overdue, due this week, money collected
- **Cross-session memory** — tell her once ("my name is David", "never sound pushy in emails"); she remembers in every future conversation — beyond the single-session requirement
- **Composio Gmail** — approved reminders really send through your Gmail; without Composio configured they fall back to a 'simulated' outbox so the product flow never breaks
- **Reviewer mode** — a seeded demo account plus a one-click "Load sample business" button on any fresh account
- **A scripted dev model** (`PENNY_MODEL=scripted`) — the entire stack (tools, live dashboard, multi-agent routing, approval cards) runs deterministically with **zero API keys**, with canned language. This is also how the whole system was E2E-tested.

## Run it locally

```bash
# prerequisites: Node 20+, Python 3.12+, a local MongoDB (or Atlas URI)
git clone <repo> && cd penny
npm install
python3 -m venv ai/.venv && ai/.venv/bin/pip install -r ai/requirements.txt
cp .env.example .env                  # defaults work; add a GOOGLE_API_KEY for the real model
npm run seed                          # demo account: demo@penny.app / demo1234
npm run dev                           # api :4000 · ai :8400 · web :5173
```

Open http://localhost:5173 — sign in with the demo account, or sign up and click **Load sample business**.

> No LLM key? Leave `PENNY_MODEL=scripted` — everything works with canned language.
> Real brain: set `PENNY_MODEL=google_genai:gemini-3-flash-preview` and a free `GOOGLE_API_KEY` from [AI Studio](https://aistudio.google.com).

## Deploy (Render + Atlas, free tiers)

1. Free MongoDB Atlas cluster → copy the connection string.
2. Render → **New → Blueprint** → point at this repo (`render.yaml` defines both services).
3. Fill the env vars Render asks for (Atlas URI ×2, the same `SERVICE_TOKEN` in both services, `GOOGLE_API_KEY`; optionally `GOOGLE_CLIENT_ID`, `COMPOSIO_API_KEY`).
4. Free instances sleep after 15 idle minutes — first hit takes ~1 min to wake. Keep-alive pings (UptimeRobot) help during review windows.

## Decisions worth explaining

| Decision | Why |
|---|---|
| **Agent tools call the Node REST API, not Mongo directly** | One write path = one validation layer = one place that emits Socket.IO events. The "dashboard reacts to the agent live" centerpiece falls out of this for free, and agent writes are tagged (`X-Actor: agent`) so the UI can show what Penny touched. |
| **`send_email` lives on the supervisor, not inside a subagent** | Human-in-the-loop interrupts cross three services and a database; keeping the interrupt at the top level makes the pause/resume cycle one well-tested seam instead of a nested-graph puzzle. |
| **Sync LangGraph streaming in a FastAPI threadpool** | Pairs with the sync Mongo checkpointer; zero async-saver edge cases. Starlette runs sync generators in a worker thread automatically. |
| **SSE over fetch-ReadableStream, not EventSource** | EventSource can't POST a chat message. The Express relay pipes the AI service's stream through untouched (and parses a copy to persist the final message + approval state). |
| **Checkpoints in Atlas, not memory** | Context retention survives deploys — and so do *pending approvals*: you can get an approval card, the free-tier server can sleep, and the Approve button still works when it wakes. |
| **Mongoose virtuals for overdue/balance, computed in one place** | 'Overdue' is a function of time, not a stored status — storing it would rot. Virtuals keep the rule in exactly one spot for the UI, the metrics and the agent. |
| **A scripted model behind the same interface** | The riskiest seams (relay streaming, interrupt/resume, multi-agent routing) were all verified end-to-end without burning rate-limited LLM calls — and reviewers can run the full product with no keys. |
| **Custom Tailwind design system, no component library** | The brief asks for software a 50-year-old owner trusts: warm paper tones, a serif wordmark, big type, plain words. Default component libraries read as "developer tool". |

## What I'd build with another week

Scheduled overnight agent (queue reminder drafts for newly-overdue invoices before you wake), PDF invoice generation, an undo/audit trail for every agent action ("what did Penny change while I was out?"), CSV import, voice input (Web Speech API — ideal for this demographic), Stripe payment links inside reminder emails.

---

**Demo account:** `demo@penny.app` / `demo1234` · Seed data is one `npm run seed` away · 3-minute walkthrough video: *(link in submission)*

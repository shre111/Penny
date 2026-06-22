# Penny — Complete Learning & Interview Guide

> A deep, descriptive, learning-first walkthrough of **the entire Penny system** — the
> product, the multi-agent AI brain, the Node API, the FastAPI AI service, the React
> frontend, the data model, security, deployment, and testing — plus every underlying
> **concept** you should be able to explain in a final-round interview.
>
> This guide assumes you are **learning or revising**. Each topic starts from first
> principles, then ties the concept back to the exact file and line in this repo. Read it
> top-to-bottom once; then use the Table of Contents and the Interview Q&A as revision.
>
> Companion docs (shorter, already in the repo): [README.md](README.md) (product),
> [DECISIONS.md](DECISIONS.md) (trade-offs), [docs/TECHNICAL.md](docs/TECHNICAL.md)
> (engineering), [ROADMAP.md](ROADMAP.md) (history/next), [docs/DEPLOY.md](docs/DEPLOY.md)
> (runbook), [CLAUDE.md](CLAUDE.md) (house rules). This guide folds all of them together
> and explains the *why* behind every term.

---

## Table of Contents

1. [What Penny is (the 60-second pitch)](#1-what-penny-is)
2. [The mental model: chat welded to a live dashboard](#2-the-mental-model)
3. [The three-tier architecture (and why three)](#3-the-three-tier-architecture)
4. [End-to-end walkthrough of one chat turn](#4-end-to-end-walkthrough-of-one-chat-turn)
5. [Repository & directory layout](#5-repository--directory-layout)
6. [PART A — AI & agent concepts (the heart)](#part-a--ai--agent-concepts)
   - [A1. LLMs, prompts & system prompts](#a1-llms-prompts--system-prompts)
   - [A2. What an "agent" is: tools & the reasoning loop](#a2-what-an-agent-is)
   - [A3. LangChain 1.x & LangGraph](#a3-langchain-1x--langgraph)
   - [A4. The multi-agent team (supervisor + subagents-as-tools)](#a4-the-multi-agent-team)
   - [A5. Memory: checkpointers (in-session) vs the memories collection (cross-session)](#a5-memory)
   - [A6. Human-in-the-loop (HITL): interrupt & resume](#a6-human-in-the-loop)
   - [A7. Streaming: SSE and the event protocol](#a7-streaming-sse-and-the-event-protocol)
   - [A8. RAG: the knowledge base](#a8-rag-the-knowledge-base)
   - [A9. Vision extraction & structured output](#a9-vision-extraction--structured-output)
   - [A10. The scripted model: determinism as a feature](#a10-the-scripted-model)
   - [A11. Model strategy, quotas & cost](#a11-model-strategy-quotas--cost)
7. [PART B — The Node API (Express 5)](#part-b--the-node-api-express-5)
   - [B1. App structure & the single write path](#b1-app-structure--the-single-write-path)
   - [B2. Authentication: cookies, JWT, bcrypt, Google, service token](#b2-authentication)
   - [B3. Real-time with Socket.IO: `emitChange`](#b3-real-time-with-socketio)
   - [B4. Mongoose models & money-math virtuals](#b4-mongoose-models--money-math-virtuals)
   - [B5. The SSE relay (`chat.js`)](#b5-the-sse-relay)
   - [B6. Earned autonomy & trust](#b6-earned-autonomy--trust)
   - [B7. Crons: overnight, autonomy sweep, digest](#b7-crons)
   - [B8. The public concierge surface](#b8-the-public-concierge-surface)
8. [PART C — The AI service (FastAPI)](#part-c--the-ai-service-fastapi)
9. [PART D — The frontend (React 19 + TypeScript + Tailwind v4)](#part-d--the-frontend)
10. [PART E — The data model](#part-e--the-data-model)
11. [PART F — Cross-service contracts](#part-f--cross-service-contracts)
12. [PART G — Security posture](#part-g--security-posture)
13. [PART H — Deployment](#part-h--deployment)
14. [PART I — Testing strategy](#part-i--testing-strategy)
15. [PART J — The decisions, with trade-offs](#part-j--the-decisions-with-trade-offs)
16. [PART K — Interview question bank (with answers)](#part-k--interview-question-bank)
17. [Glossary of every term](#glossary)
18. [One-page cheat sheet](#one-page-cheat-sheet)

---

## 1. What Penny is

**In one sentence:** Penny is an **AI back office for small businesses** — a chat
assistant welded to a **live business dashboard** (invoices, clients, cash flow) that the
assistant actually operates, in real time, while you watch.

It was built for **M32's take-home project**, aimed at their stated audience:
**small-business owners, 35+, not technical.** That audience shapes everything — the
language ("money owed to you", never "accounts receivable aging"), the big type, the
suggested buttons, and the hard rule that **nothing external (an email) ever happens
without the owner's explicit approval.**

**What it can do (the experience):**

> - "Log an invoice for Acme, $4,500, due July 1" → *the invoice pops onto the dashboard,
>   glowing to show Penny touched it.*
> - "Who owes me money?" → *a table and a chart, computed from the real books.*
> - "Chase the overdue invoices" → *Penny drafts warm reminder emails; you approve, edit,
>   or skip each one before anything sends.*
> - *Drag a photo of an invoice into chat* → *she reads it with vision, you confirm, it's
>   booked.*

**Why this is impressive (the talking points):**

1. **A real app the chat controls** — not a chatbot that emits text, but an agent whose
   tool calls move a live dashboard.
2. **A multi-agent team you can watch work** (supervisor + Bookkeeper + Analyst).
3. **Human-in-the-loop approvals** that survive server restarts.
4. **Document intelligence** (vision → structured invoice).
5. **Earned autonomy, a closed loop** (night drafting → morning approvals → audit → undo).
6. **A scripted model** that runs the whole product deterministically with **zero API keys**.

---

## 2. The mental model

Picture two panes side by side:

```
┌───────────────────────────┬─────────────────────────────────────────┐
│        CHAT (left)        │           DASHBOARD (right)               │
│                           │                                           │
│  you ↔ Penny (the agent)  │  KPIs · invoice table · aging &           │
│  streaming tokens         │  cash-flow charts · outbox · activity     │
│  activity feed            │                                           │
│  approval cards (HITL)    │  ← updates LIVE as the agent works,       │
│  rich cards (charts,      │    agent-touched rows GLOW for 3 seconds  │
│  invoice tables)          │                                           │
└───────────────────────────┴─────────────────────────────────────────┘
```

The magic trick is that **both panes are driven by the same source of truth**. When Penny
creates an invoice, she doesn't write to the database directly — she calls the **same REST
endpoint a human button-click calls**. That endpoint validates, saves, and **emits a
Socket.IO event**. The dashboard is subscribed to those events, so it refetches and the new
row glows. **"The dashboard reacts to the agent live" is not special-cased — it falls out
of having one write path.** Remember this; it's the single most important architectural
idea in the whole project.

---

## 3. The three-tier architecture

Penny is **three deployables sharing one database cluster**:

```
┌──────────────────────────────  penny-app (Render web service, Node 20+) ────────────────┐
│  web/   React 19 SPA — built by Vite, served statically by Express (single origin)       │
│  api/   Express 5 — auth, domain CRUD, chat persistence, the SSE relay, the Socket.IO    │
│         hub, and the cron jobs (overnight 06:00, autonomy sweep every minute, digest)    │
└───────────────┬───────────────────────────────────────────────┬─────────────────────────┘
                │ REST + shared service token                    │ Mongoose driver
┌───────────────▼───────────────────────┐         ┌──────────────▼──────────────────────────┐
│ penny-ai (Render web service, Python)  │         │ MongoDB Atlas                            │
│ FastAPI + LangChain 1.x / LangGraph     │         │  db `penny`        — application data    │
│ agents · tools · vision · Composio Gmail│         │  db `penny_agent`  — agent checkpoints   │
└────────────────────────────────────────┘         └───────────────────────────────────────────┘
```

### Why three tiers (not one)?

- **The brief asked for MERN, and "MERN or Python/FastAPI for the AI service, with
  LangChain/LangGraph strongly preferred."** Splitting the AI into its own Python service
  matches their stack exactly *and* shows you can design a clean service boundary.
- **Python is where the best agent tooling lives** (LangGraph, LangChain, the Gemini SDK).
- **Node/Express is where the product, auth, and the database live.**
- The **cost** of this split is exactly one tricky seam — **streaming chat across two
  services** — which the SSE relay solves (see [B5](#b5-the-sse-relay)).

### Two cross-cutting rules that make the whole thing coherent

1. **Single origin in production.** Express serves the built React bundle (`web/dist`), so
   the browser, the API, and the websocket are all on one domain. **Cookies stay
   first-party, and there is no CORS surface.**
2. **Single write path.** Every mutation — human click *or* agent tool — goes through the
   same Express routes. That one seam powers validation, the live Socket.IO updates, the
   audit trail, and "who did it" attribution. **The AI service never writes to Mongo
   directly** — it calls Node over REST.

---

## 4. End-to-end walkthrough of one chat turn

This is the single most valuable thing to narrate in an interview. Trace what happens when
the owner types **"Chase the overdue invoices"** and clicks send. Follow the numbers.

```
 BROWSER                 NODE API (Express)            AI SERVICE (FastAPI)         MONGO
 ───────                 ──────────────────            ────────────────────         ─────
 (1) POST /api/chat/                                                                
     sessions/:id/   ──► (2) persist user msg ──────────────────────────────────► messages
     messages (SSE)      (3) POST /chat ──────────────► (4) build_agent()          
                             X-Service-Token              load memories ◄────────── memories
                                                          (5) agent.stream(...)     
                                                          supervisor calls          
                                                          ask_bookkeeper            
                                                          ┌─ Bookkeeper agent       
                                                          │   list_invoices tool    
                                                          │   └─ httpx GET ─────────┐
                         (6) GET /api/invoices ◄──────────────────────────────────┘
                             (reads, returns JSON) ──────► back to tool             
                                                          (7) supervisor writes     
                                                          send_email → HITL PAUSE   
                         (8) ◄── SSE: token/activity/interrupt frames               
 (9) ◄── relayed bytes   forward untouched + parse copy                             
     render tokens,                                                                 
     activity feed,                                                                 
     APPROVAL CARD       (10) on stream end: persist assistant msg ───────────────► messages
                                                                                    (interrupt
                                                                                     = pending)
 (11) user clicks                                                                   
      "Approve" ──────► POST /resume {decisions} ─► (12) agent.stream(Command(      
                         flip interrupt→resolved        resume={decisions}))        
                                                        send_email actually runs    
                         (13) POST /api/emails ◄──────── (Composio Gmail / simulated)
                              emitChange('email') ──► Socket.IO ──► dashboard outbox updates
```

Step by step in prose:

1. **Browser → Node.** `useChatStream.send()` ([web/src/hooks/useChatStream.ts](web/src/hooks/useChatStream.ts))
   does `fetch(POST /api/chat/sessions/:id/messages, {credentials:'include'})` and reads the
   **response body as a stream** (not `EventSource` — see [A7](#a7-streaming-sse-and-the-event-protocol)).
2. **Node persists the user message** to the `messages` collection and titles the session
   ([api/src/routes/chat.js](api/src/routes/chat.js)).
3. **Node → AI service.** `relayAgentStream` opens `fetch(POST {aiUrl}/chat)` with the
   `X-Service-Token` header and the `thread_id` (= chat session id), `user_id`, `content`.
4. **AI builds the agent** per request ([ai/app/agent.py](ai/app/agent.py)): it constructs
   the supervisor + Bookkeeper + Analyst, attaches the HITL middleware and the Mongo
   checkpointer, and **injects the user's cross-session memories into the system prompt**.
5. **The agent runs** (`agent.stream(...)`). The supervisor decides to delegate, calls
   `ask_bookkeeper`, the Bookkeeper calls `list_invoices`…
6. **Every tool calls back into Node over REST** ([ai/app/node_client.py](ai/app/node_client.py)) —
   e.g. `GET /api/invoices?status=overdue`. **The AI never touches Mongo directly.**
7. The supervisor then writes a `send_email` tool call. Because `send_email` is gated by
   `HumanInTheLoopMiddleware`, the graph **interrupts** instead of executing.
8. **AI → Node (SSE).** As all this happens, [ai/app/streaming.py](ai/app/streaming.py)
   translates the LangGraph stream into SSE frames: `token` (prose), `activity` (the
   friendly "Bookkeeper · Checking the invoices…" feed), `artifact` (charts/tables), and
   finally `interrupt` (the approval pause).
9. **Node relays bytes to the browser untouched** (for latency) **while parsing a copy**
   (for persistence). The browser renders tokens live, shows the activity feed, and renders
   an **approval card** from the `interrupt` frame.
10. **On stream end, Node persists the assistant message** including `interrupt.status =
    'pending'`. Because this lives in Mongo (and the LangGraph pause lives in the
    checkpoint), **the approval survives a server restart.**
11. **User approves/edits/skips.** The browser POSTs `/resume {messageId, decisions}`.
12. **Node flips the interrupt to `resolved`** (blocking double-resume via a Mongo guard)
    and relays a `/resume` to the AI service, which calls
    `agent.stream(Command(resume={"decisions": ...}))` on the **same `thread_id`**.
13. **`send_email` now actually runs** — Composio sends via Gmail (or the simulated outbox
    fallback), then writes the email through `POST /api/emails`, which calls `emitChange` →
    a Socket.IO event → the dashboard's outbox updates live.

If you can tell that story cleanly, you understand Penny.

---

## 5. Repository & directory layout

```
Penny/
├── package.json            # root scripts: dev (all 3), seed, build, test
├── render.yaml             # Render Blueprint: defines penny-app + penny-ai services
├── .env / .env.example     # shared by api + ai in dev (gitignored)
│
├── api/                    # ── Node + Express 5 ──────────────────────────────
│   └── src/
│       ├── index.js                 # Express entry; serves web/dist in prod; attaches Socket.IO + crons
│       ├── config.js                # env → typed config
│       ├── db.js                    # Mongoose connection
│       ├── realtime.js              # Socket.IO hub + emitChange() + Activity recording
│       ├── trust.js                 # earned-autonomy math
│       ├── overnight.js             # 06:00 + minute crons (drafting + scheduled sends)
│       ├── seed.js / seedData.js    # demo "Bluepeak Studio" account
│       ├── auth/
│       │   ├── middleware.js        # JWT cookie, requireAuth, requireUserOrService
│       │   └── routes.js            # signup/login/logout/me, Google verify, autonomy PATCH
│       ├── models/                  # Mongoose schemas (User, Client, Invoice, Email, …)
│       └── routes/                  # invoices, clients, metrics, chat (SSE relay), emails,
│                                    # proposals, memories, knowledge, uploads, public, demo
│
├── ai/                     # ── Python + FastAPI + LangChain/LangGraph ────────
│   ├── requirements.txt
│   └── app/
│       ├── main.py                  # FastAPI app: /chat /resume /concierge /extract /overnight …
│       ├── agent.py                 # the multi-agent graph (supervisor + subagents-as-tools)
│       ├── tools.py                 # ~14 tools, all httpx → Node REST
│       ├── node_client.py           # the httpx wrapper (single write path, from AI's side)
│       ├── streaming.py             # LangGraph stream → SSE protocol
│       ├── concierge.py             # client-facing per-invoice agent (bounded)
│       ├── extraction.py            # Gemini vision → Pydantic invoice
│       ├── knowledge.py             # RAG: chunk + embed + cosine search
│       ├── overnight.py             # reminder drafting (cooldown/dedupe/cap)
│       ├── digest.py / replies.py   # weekly digest, Gmail reply ingestion
│       ├── scripted_model.py        # deterministic, role-aware fake model (zero keys)
│       └── composio_client.py       # Gmail send via Composio (+ simulated fallback)
│
└── web/                    # ── React 19 + Vite + Tailwind v4 ─────────────────
    └── src/
        ├── main.tsx, App.tsx
        ├── pages/           # Landing, Login, Signup, AppShell, PublicInvoice
        ├── components/chat/ # ChatPanel, MessageView, cards (Approval/Chart/Invoice/Plan)
        ├── components/dashboard/  # Dashboard, ActivityFeed, tables, widgets, drawers
        ├── hooks/           # useChatStream, useLiveData, useSpeak, useSpeechInput
        ├── lib/             # api, socket, auth, theme, spotlight, types
        └── index.css        # Tailwind v4 @theme design tokens
```

---

# PART A — AI & agent concepts

This is what an ML/AI-focused interviewer will probe hardest. Go slowly; each subsection
defines the concept, then shows where Penny uses it.

## A1. LLMs, prompts & system prompts

**A Large Language Model (LLM)** is a neural network trained to predict the next token
(roughly, the next word-piece) given the preceding text. Everything an LLM "does" —
answering, reasoning, calling tools — is an emergent consequence of next-token prediction
over a huge corpus, refined with instruction-tuning and RLHF (reinforcement learning from
human feedback) so it follows instructions and stays helpful/harmless.

**Tokens** are the unit of both computation and billing. "Invoice" might be one token;
"reconciliation" might be three. Models have a **context window** (max tokens in + out).
You pay per input token and per output token. This is why Penny keeps tool results
**compact** (`_compact_invoice` in [ai/app/tools.py](ai/app/tools.py) trims each invoice to
~10 fields) — every byte returned to the model is re-read on the next turn and costs money.

**A prompt** is the text you send. **A system prompt** is special framing that sets the
model's role, rules, and context for the whole conversation. Penny's supervisor system
prompt ([ai/app/agent.py](ai/app/agent.py), `SUPERVISOR_PROMPT`) is a masterclass worth
studying — it encodes:
- **Persona & audience:** "You are Penny… talking with {user_name}. Plain, warm language…
  say 'money owed to you', never 'accounts receivable'."
- **The team:** when to use `ask_bookkeeper` vs `ask_analyst`.
- **Hard rules:** "Never guess or invent numbers — if it's about their data, ask your
  team." (This is **anti-hallucination by construction** — the model is told the truth
  lives in tools, not in its head.)
- **Behavioral guardrails:** never claim an email "was sent" until the tool actually ran;
  decline anything unrelated to the business.
- **Dynamic context:** `{today}` and a `{memories_block}` injected per run.

> **Key teaching point:** prompt engineering here isn't decoration — it's how you get
> *reliable* behavior from a probabilistic system. The "ask your team, never guess"
> instruction is the difference between a trustworthy bookkeeper and a confident liar.

## A2. What an "agent" is

A plain LLM only emits text. An **agent** is an LLM placed in a **loop** where it can call
**tools** (functions), see the results, and decide what to do next — until it produces a
final answer. The canonical pattern is **ReAct (Reason + Act)**:

```
            ┌─────────────────────────────────────────┐
            │  LLM reads conversation + tool results   │
            └───────────────┬──────────────────────────┘
                            │ decides
              ┌─────────────┴─────────────┐
              ▼                           ▼
     "call tool X(args)"          "final answer: ..."
              │                           │
   run tool, append result        return to user
              │
              └────────── loop back ──────┘
```

**Tool calling (a.k.a. function calling)** is the mechanism. You describe each tool to the
model — its name, a natural-language description, and a typed argument schema. The model,
when it wants to act, emits a structured request like `list_invoices(status="overdue")`.
The runtime executes the real function and feeds the result back. In Penny, each tool's
**docstring is its description** and the Python type hints define the schema — look at
`create_invoice` in [ai/app/tools.py](ai/app/tools.py): the docstring tells the model when
and how to use it, and `client_name: str, due_date: str, amount: float = 0` is the schema
the model fills in.

> **Why "one multi-agent turn = 4–7 model requests"** (from the docs): every tool result
> round-trips the model. The model calls a tool → you run it → the model reads the result
> and either calls another tool or answers. Each hop is a separate LLM request. This is the
> core cost/latency driver of agentic systems.

## A3. LangChain 1.x & LangGraph

**LangChain** is a Python framework for building LLM apps (model abstractions, tool
definitions, prompt plumbing). **LangGraph** is its lower-level companion for building
agents as **stateful graphs** — nodes (model call, tool execution) and edges (control
flow), with built-in support for **persistence (checkpointers)**, **streaming**, and
**human-in-the-loop interrupts**.

Penny uses the **LangChain 1.x idiom**:
- `init_chat_model(config.PENNY_MODEL, temperature=0.3)` — **provider-agnostic** model
  construction. Swap `PENNY_MODEL` from `google_genai:gemini-3.1-flash-lite` to `scripted`
  to anything else without touching the graph. (`temperature` controls randomness: 0 =
  deterministic, higher = more creative; 0.3 is a calm, mostly-consistent setting.)
- `create_agent(model, tools=[...], system_prompt=..., middleware=[...], checkpointer=...)`
  — builds a ready-to-run ReAct agent graph in one call.
- `agent.stream(input, config, stream_mode=[...], subgraphs=True)` — runs it and yields
  incremental events (see streaming below).

> **Interview-ready:** "LangGraph gives me three things for free that are painful to build
> by hand — durable conversation state via a checkpointer, token/step streaming, and
> human-in-the-loop interrupt/resume. Penny leans on all three."

## A4. The multi-agent team

Penny is a **multi-agent system** using the **subagents-as-tools** pattern (the current
LangChain 1.x idiom; the older `langgraph-supervisor` package is legacy):

```
                   you, chatting
                        │
            ┌───────────▼────────────┐
            │  Penny — the SUPERVISOR │  (checkpointed, HITL middleware,
            │  writes emails,         │   owns send_email + save_memory)
            │  remembers facts        │
            └───┬────────────────┬────┘
       ask_bookkeeper        ask_analyst       ← these are TOOLS that wrap whole agents
            │                    │
      ┌─────▼─────┐        ┌──────▼──────┐
      │ Bookkeeper│        │   Analyst   │
      │  agent    │        │   agent     │
      │ (CRUD)    │        │ (metrics,   │
      │           │        │  charts)    │
      └─────┬─────┘        └──────┬──────┘
            └─────────┬───────────┘
        every tool calls the Node REST API
```

How it's wired in [ai/app/agent.py](ai/app/agent.py):
- `bookkeeper` and `analyst` are each a `create_agent(...)` with their **own** model,
  system prompt, and tool subset.
- `ask_bookkeeper` and `ask_analyst` are `@tool`-decorated functions that **invoke those
  sub-agents** and return their final text to the supervisor.
- The supervisor gets `tools=[ask_bookkeeper, ask_analyst, *outreach, *memory]`.

**Why this design (defend it):**
- **It's the current idiom** and demonstrates real multi-agent topology with **visible
  teamwork** — the UI shows "Bookkeeper · Checking the invoices…" because subgraph
  streaming (`subgraphs=True`) surfaces nested tool work.
- **Subagents are stateless per call** — all conversation state lives in the supervisor's
  checkpointer. Cleaner and easier to reason about.
- **`send_email` deliberately stays on the supervisor**, not in a subagent, because
  **human-in-the-loop interrupts from inside a nested subgraph are a complex, untested
  seam.** Keeping the only interrupt at the top level makes pause/resume *one* well-tested
  path. This is **pragmatism over purity** — a great trade-off to articulate.
- `PENNY_MULTI_AGENT=false` collapses everything into a single agent (same tools, one fewer
  hop) — a debugging aid and a rate-limit saver.

> **Honest limitation (say it before they ask):** routing is probabilistic — the supervisor
> occasionally asks the Analyst where the Bookkeeper would do. Answers stay correct because
> the tools are shared truths, and HITL + undo are the safety nets.

## A5. Memory

LLMs are **stateless** between calls — each request re-sends the whole conversation. Penny
has **two distinct memory layers**, and conflating them is a common interview stumble:

**(1) In-session memory = LangGraph checkpointer.**
`MongoDBSaver(_mongo, db_name="penny_agent")` with `thread_id = chat session id`. After
every step, the full graph state (message history, pending interrupts) is snapshotted to
Mongo. The next turn loads it back. This gives **context retention** — the brief's
acceptance test ("My name is David" … "What is my name?" → "David") passes with **zero
custom state code**.

Crucially, because the checkpoint is in the **database, not RAM**, two production wins
follow:
- Context survives **deploys/restarts** (Render free tier sleeps after 15 min).
- **Pending approvals survive restarts** — you can get an approval card, the server can
  sleep, and the Approve button still works on wake. *That's a production argument, not a
  demo trick.*

**(2) Cross-session memory = the `memories` collection.**
When the owner states a durable fact ("my name is David", "never sound pushy in emails"),
the model calls the `save_memory` tool, which POSTs to `/api/memories`. On **every future
run**, `build_system_prompt` ([ai/app/agent.py](ai/app/agent.py)) loads the latest ~20
memories and **injects them into the system prompt**. This goes beyond the single-session
requirement — Penny remembers across conversations.

| | In-session | Cross-session |
|---|---|---|
| Mechanism | LangGraph checkpointer | `memories` collection → system prompt |
| Scope | one chat session (`thread_id`) | the whole user, forever |
| Survives restart? | yes (in Mongo) | yes (in Mongo) |
| Written by | LangGraph automatically | the `save_memory` tool, on demand |

## A6. Human-in-the-loop

**Human-in-the-loop (HITL)** means the agent **pauses and asks a human** before taking a
consequential, irreversible action. In Penny, exactly one action is gated: **`send_email`**
(nothing leaves the building without an explicit yes).

Mechanism — `HumanInTheLoopMiddleware(interrupt_on={"send_email": True})` in
[ai/app/agent.py](ai/app/agent.py):
- When the model calls `send_email`, the middleware **interrupts** the graph instead of
  running the tool. LangGraph persists the pause in the checkpoint.
- The interrupt surfaces as an SSE `interrupt` frame → the browser renders an **approval
  card** with **Approve / Edit / Skip** buttons.
- The user's choice is sent to `/resume`; the AI calls
  `agent.stream(Command(resume={"decisions": [...]}))` on the same `thread_id`; the graph
  continues — running `send_email` on approve, or injecting a "skipped" tool result on
  reject.

Decisions schema: `{type: 'approve' | 'edit' | 'reject', ...}`. **Edit** lets the owner
tweak the wording before send (demos beautifully and is the most human feature).

**Double-resume guard:** [api/src/routes/chat.js](api/src/routes/chat.js) only resumes if
the message's `interrupt.status === 'pending'`, then flips it to `'resolved'` and saves.
A second click gets a `409 Conflict`. The frontend *also* optimistically marks the card
resolved ([useChatStream.ts](web/src/hooks/useChatStream.ts) `resume`). **Defense at both
layers.**

> **Why only `send_email` is gated:** gating everything would make the agent sluggish and
> annoying. The rule is *gate the externally-visible, irreversible action; leave everything
> reversible (DB writes have undo) fluid.* That's the right granularity.

## A7. Streaming: SSE and the event protocol

**Why stream at all?** A multi-agent turn takes seconds. Showing tokens as they arrive (and
a live "what the team is doing" feed) makes the product feel alive and responsive instead of
a 10-second spinner.

**Why SSE over `fetch`-ReadableStream, not `EventSource` or WebSockets?**
- **`EventSource`** (the classic browser SSE API) is **GET-only** — it can't send a POST
  body, and a chat message *is* a POST body. So Penny POSTs with `fetch` and reads
  `response.body` as a stream ([useChatStream.ts](web/src/hooks/useChatStream.ts) `readSse`).
- **WebSockets** are bidirectional and heavier; chat streaming is one-directional
  server→client per turn, so SSE-over-fetch is simpler and works through HTTP proxies.
  (Penny *does* use WebSockets — Socket.IO — but for the separate concern of *live dashboard
  updates*, see [B3](#b3-real-time-with-socketio).)

**The SSE event protocol** (defined once, used everywhere — owner chat, resume, concierge).
This is a **cross-service contract**: the AI emits it ([streaming.py](ai/app/streaming.py)),
Node relays + parses it ([chat.js](api/src/routes/chat.js)), the browser consumes it
([useChatStream.ts](web/src/hooks/useChatStream.ts)). **Change one layer → change all three.**

```
event: token     data: {text}                                   ← assistant prose, word by word
event: activity  data: {id, tool, label, status, agent}         ← "Bookkeeper · Checking the invoices…"
event: artifact  data: {type: chart|invoices|extraction|plan, data}   ← rich cards
event: interrupt data: {actions: [{id, tool, args, description}]}     ← HITL pause
event: error     data: {message, detail?}
event: done      data: {messageId?}
```

The wire format is literally `event: <name>\ndata: <json>\n\n` (frames separated by a blank
line). All three layers parse on the `\n\n` boundary.

**The clever bit (`activity` merge):** `activity` events carry an `id` (= the
`tool_call_id`). A tool emits one `running` activity then one `done` activity with the same
id; the consumer **merges by id** (`if (existing) Object.assign(existing, data)`) so the
feed updates in place rather than duplicating. The friendly labels (`FRIENDLY_RUNNING` /
`FRIENDLY_DONE` in [streaming.py](ai/app/streaming.py)) translate raw tool names into
owner-readable language.

**Backpressure / cancellation:** if the browser disconnects mid-stream, Node aborts the
upstream AI request via an `AbortController` ([chat.js](api/src/routes/chat.js)) — no
orphaned work.

**The relay's dual job** ([chat.js](api/src/routes/chat.js) `relayAgentStream`): it
`res.write(chunkText)` **immediately** (latency-first, bytes untouched) **and** accumulates
a parsed copy into `text` / `events` / `artifacts` / `interrupt`, so when the stream ends it
can persist the complete assistant message to Mongo. This is why **the AI service stays
stateless about chat history** — Node owns persistence.

## A8. RAG: the knowledge base

**RAG (Retrieval-Augmented Generation)** means: instead of hoping the model "knows" your
private facts, you **retrieve** the relevant snippets from your own documents and **feed
them into the prompt** so the model answers from them (with citations). It's the standard
cure for hallucination on domain-specific knowledge.

Penny's "Teach Penny your business" feature ([ai/app/knowledge.py](ai/app/knowledge.py),
described in [docs/TECHNICAL.md](docs/TECHNICAL.md)) is a compact RAG pipeline:
1. **Ingest:** owner pastes/uploads policy text → **paragraph-aware chunking** (split into
   semantically coherent pieces).
2. **Embed:** each chunk → a **vector embedding** (Gemini embeddings; a **hashed
   bag-of-words fallback** when there's no API key, so it still works offline). An
   *embedding* is a list of numbers positioning the text in a high-dimensional "meaning
   space" — similar meanings land near each other.
3. **Store:** vectors saved in Mongo.
4. **Search:** `search_knowledge(query)` embeds the query and ranks chunks by **cosine
   similarity** (the cosine of the angle between two vectors — 1.0 = identical direction =
   most similar). Top matches go back to the model, which answers **only from them and
   cites the source**.

> **Scale note to mention:** Penny does **exact** cosine over all chunks in JS because SMB
> knowledge bases are tiny (a few pages). At scale you'd switch to **Atlas `$vectorSearch`**
> (an approximate-nearest-neighbor index). Knowing *when* exact search is fine and *when*
> you need an ANN index is a senior signal.

Both personas (owner Penny *and* the client concierge) can use `search_knowledge`, so a
client asking "what's your late fee policy?" gets answered from the owner's real documents.

## A9. Vision extraction & structured output

**Document intelligence:** drag an invoice photo/PDF into chat → Penny reads it and produces
a confirm-card. Implementation ([ai/app/extraction.py](ai/app/extraction.py), wired via
`POST /extract` in [ai/app/main.py](ai/app/main.py)):
- The file is uploaded (multer memory storage on the Node side; size-capped at 10 MB).
- A **multimodal (vision) model** (Gemini) reads the image.
- The killer technique is **structured output**: `model.with_structured_output(PydanticModel)`
  forces the model to return data **conforming to a typed schema** (a Pydantic class) — not
  free text you'd have to parse. You get a validated `InvoiceProposal` object back, or a
  validation error, never a "the model wrote prose instead of JSON" surprise.
- The result becomes an `extraction` artifact → a confirm-card → on confirm it flows through
  the **normal** `POST /api/invoices` with `source: 'document'`. (Note: extraction never
  auto-books — the human always confirms.)

> **Structured output vs. "just ask for JSON":** asking a model for JSON in the prompt works
> ~95% of the time and fails painfully the other 5%. `with_structured_output` uses the
> provider's native constrained-decoding / function-calling to *guarantee* schema-valid
> output. Always prefer it.

## A10. The scripted model

This is arguably Penny's most interesting engineering idea. `PENNY_MODEL=scripted` swaps in
a **deterministic, role-aware fake model** ([ai/app/scripted_model.py](ai/app/scripted_model.py))
that implements the same `BaseChatModel` interface the real model does — so it drives the
**real graph, real tools, real database, real sockets, and real HITL**. Only the *language*
is canned; everything else is genuine.

Why this is brilliant:
- **The riskiest seams** — relay streaming across three services, interrupt/resume,
  multi-agent event namespacing — are **E2E-testable with zero API keys and zero rate
  limits**. (`npm test` runs 26 assertions against the running stack on the scripted model,
  deterministically, in ~15s — see [PART I](#part-i--testing-strategy).)
- **It doubles as reviewer mode:** a reviewer with no keys can run the *entire* product.
- It embodies a deep principle: **separate the non-deterministic part (the LLM) behind an
  interface so the deterministic plumbing around it can be tested like normal software.**

> If you take one transferable idea from Penny into your own work, take this one.

## A11. Model strategy, quotas & cost

- **Provider-agnostic** via `init_chat_model` + the `PENNY_MODEL` env var. Today every role
  shares one underlying model instance; the code is structured to split per-role later.
- **Free-tier reality (June 2026, from the docs):**
  - `gemini-3.1-flash-lite` ≈ **1,500 requests/day** (~15/min) — the **daily driver**,
    verified with the full multi-agent + overnight stack.
  - `gemini-3-flash-preview` ≈ **20 requests/day** — sharper but only ~3 chat turns; **demo
    recordings only** (quota resets daily — record early).
  - `scripted` — **zero keys**, for free UI iteration and tests.
- **Cost driver:** one multi-agent turn = **4–7 requests** because every tool result
  round-trips the model. The UI surfaces a friendly "thinking a little too fast" message on
  429/quota errors ([streaming.py](ai/app/streaming.py) catches `429`/`quota`/`rate`).
- **Observability:** set `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY` and LangChain traces
  every run, tool call, and token count automatically — invaluable for debugging agent loops.

---

# PART B — The Node API (Express 5)

## B1. App structure & the single write path

The Node API ([api/src/](api/src/)) is the product's backbone: auth, all domain CRUD, chat
persistence, the SSE relay, the Socket.IO hub, and the crons. In production it **also serves
the built React SPA** (`web/dist`) so everything is one origin.

The **single write path** is the organizing principle. Whether a human clicks "Add invoice"
or Penny calls `create_invoice`, the request hits the **same** `POST /api/invoices` route.
That route:
1. **Authenticates** (browser cookie *or* service token — see [B2](#b2-authentication)).
2. **Validates** (one schema layer).
3. **Writes** to Mongo.
4. **Calls `emitChange(...)`** → a Socket.IO event + an audit `Activity` row.

**Why this matters (repeat it in interview):** one write path = one validation layer = one
place that emits live events = one audit trail = one place that tags *who did it*. The
live-dashboard centerpiece and the glow animations **fall out for free**. The rejected
alternative — the Python service writing Mongo directly — would have needed change streams
or a second event emitter, and two schema layers that drift apart.

## B2. Authentication

Auth lives in [api/src/auth/middleware.js](api/src/auth/middleware.js) and is genuinely
two-headed:

**Browser auth — JWT in an httpOnly cookie.**
- On login/signup, the server issues a **JWT** (JSON Web Token) signed with a secret,
  `{sub: userId}`, 7-day expiry, and sets it as a cookie with **`httpOnly`** (JS can't read
  it → XSS can't steal it), **`secure`** in prod (HTTPS only), **`SameSite=Lax`** (sent on
  top-level navigations, mitigates CSRF).
- `requireAuth` verifies the cookie and sets `req.userId`, `req.actor = 'user'`.
- Passwords are hashed with **bcrypt** (cost 10) — a slow, salted hash designed to resist
  brute force. You never store or compare plaintext.
- **Google OAuth** ([auth/routes.js](api/src/auth/routes.js)) uses Google Identity Services'
  **ID-token flow**: the browser gets a signed token from Google, the server **verifies it
  server-side** (`verifyIdToken` via `google-auth-library`). The server never trusts a
  client-asserted identity.

**Service auth — the AI acting *as* a user.**
- `requireUserOrService` checks for an `X-Service-Token` header. If present and correct, it
  trusts `X-User-Id` (act-as) and reads `X-Actor` (`agent`/`service`). This is how the
  Python tools call Node *on behalf of* the signed-in user.
- The **`X-Actor: agent`** tag flows all the way into Socket.IO events → so the UI can glow
  "Penny did this" and the audit log can attribute correctly. **Attribution comes from the
  transport, not from guesswork.**

> **JWT vs sessions:** a JWT is self-contained (the server verifies the signature, no DB
> lookup), which suits a stateless API. The httpOnly cookie delivery means the SPA never
> handles the token directly — the browser attaches it automatically, including on the
> Socket.IO handshake (see below).

## B3. Real-time with Socket.IO

[api/src/realtime.js](api/src/realtime.js) is the live-update hub.

- **Authentication:** the websocket handshake reuses the **same JWT cookie** — `io.use(...)`
  parses the cookie, `jwt.verify`s it, and stamps `socket.data.userId`. An unauthorized
  socket is rejected. **No separate websocket auth scheme.**
- **Rooms:** on connect, each socket joins `user:<userId>`. Events are emitted **only to
  that user's room** — natural per-user isolation.
- **`emitChange(userId, {entity, action, id, actor, doc})`** is the function every mutation
  route calls. It does **two** things atomically-in-spirit:
  1. `io.to('user:'+userId).emit('entity:changed', {...})` → the dashboard refetches and
     glows.
  2. `recordActivity(...)` → persists an `Activity` row for the audit trail (skipping bulk
     `reloaded` events). **The UI and the audit log can never disagree, because they hang
     off the same call.**
- **Undo descriptors:** when `actor === 'agent'` and an invoice/client was *created*,
  `recordActivity` attaches an `undo` descriptor, powering one-click "undo what Penny did".
- **Human-readable summaries:** `buildSummary` turns raw mutations into owner language
  ("Invoice INV-0042 for Acme — $4,500 added").

On the browser, `useLiveData` ([web/src/hooks/useLiveData.ts](web/src/hooks/useLiveData.ts))
subscribes to `entity:changed`, refetches the affected data, and adds agent-touched ids to a
**glow highlight set** for ~3 seconds.

> **Why Socket.IO and not raw WebSockets?** Socket.IO adds rooms, auto-reconnect, and
> **automatic transport fallback** — if WebSocket upgrade is blocked (e.g. behind Vercel's
> proxy), it silently falls back to HTTP long-polling. Live updates keep working, just with
> marginally higher latency (a real deploy trade-off noted in [docs/DEPLOY.md](docs/DEPLOY.md)).

## B4. Mongoose models & money-math virtuals

**Mongoose** is the ODM (Object-Document Mapper) over MongoDB — schemas, validation,
virtuals, and middleware on top of the raw driver. The star is
[api/src/models/Invoice.js](api/src/models/Invoice.js).

**The big idea: money math lives in virtuals, computed in exactly one place.**

```js
invoiceSchema.virtual('amountPaid').get(function () {
  return (this.payments || []).reduce((s, p) => s + p.amount, 0)
})
invoiceSchema.virtual('balance').get(function () {
  return Math.max(0, this.amount - this.amountPaid)
})
invoiceSchema.virtual('effectiveStatus').get(function () {
  if (this.status === 'sent' && this.balance > 0 && this.dueDate < new Date()) return 'overdue'
  return this.status
})
invoiceSchema.virtual('daysOverdue').get(function () { /* … */ })
```

A **virtual** is a computed property — not stored, derived on read. Why is this the right
call (a real DECISIONS entry)?
- **"Overdue" is a function of *time*, not a stored fact.** If you stored `status:
  'overdue'`, it would **rot the instant midnight passes** — an invoice due today becomes
  overdue tomorrow with no write. Deriving it means it's *always* correct.
- **One implementation** feeds the UI, the metrics endpoints, *and* the agent tools — they
  literally cannot disagree about what "balance" or "overdue" means.
- **Trade-off (own it):** you can't index a derived field, so "find overdue" filters in JS
  after a date pre-filter. Irrelevant at SMB data sizes; you'd revisit at scale.

**Atomic invoice numbering** (the other gem in this file): `nextInvoiceNumber` uses a
**`counters` collection** with `findOneAndUpdate({_id}, {$inc:{seq:1}}, {upsert:true})`.
`$inc` is atomic in MongoDB, so two concurrent invoice creates can **never** get the same
number — no race, no duplicate `INV-0042`. (Contrast with "count existing invoices + 1",
which races badly.)

Other models: `User` (auth + concierge guardrails + autonomy), `Client`, `Email` (the
outbox state machine: `queued/scheduled/sent/simulated/failed/dismissed`), `Proposal`,
`Memory`, `Activity`, `Chat`/`Message`.

## B5. The SSE relay

[api/src/routes/chat.js](api/src/routes/chat.js) `relayAgentStream` is the seam that makes
two-service streaming work. Re-read [A7](#a7-streaming-sse-and-the-event-protocol) for the
protocol; here's the relay's mechanics:

- Sets SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache,
  no-transform`, `X-Accel-Buffering: no` to stop nginx/proxy buffering) and `flushHeaders()`.
- Opens `fetch({aiUrl}{aiPath}, {signal: abort.signal, duplex:'half'})` to the AI service.
- Reads the upstream body with a `getReader()` loop. For each chunk it:
  1. **`res.write(chunkText)` immediately** — forward to the browser untouched (latency).
  2. **Parses complete `\n\n` frames** into accumulators (`text`, `events`, `artifacts`,
     `interrupt`) for persistence.
- On `req.on('close')` it `abort.abort()`s the upstream (cancellation).
- After the stream, it **persists the assistant `Message`** (even partial output on error),
  then sends a final `done {messageId}` so the client can reconcile its optimistic local
  message with the saved id.

This is the practical answer to "how do you stream an LLM response through a second
service while still saving it?" — **forward bytes, parse a copy.**

## B6. Earned autonomy & trust

A standout product idea: **autonomy is *earned*, not a checkbox.** Penny may only send
reminders unsupervised after the owner demonstrates trust.

[api/src/trust.js](api/src/trust.js): over the **last 10** decided reminder emails
(`sent`/`simulated`/`dismissed`), compute:
- `clean` = approved **untouched** (not edited, not skipped),
- `edited` = approved but the owner changed the wording,
- `skipped` = dismissed.

Eligibility: **`clean >= 5 && skipped === 0`.** Note the subtle judgment encoded here —
**editing does *not* break trust** ("taste ≠ distrust"), but **skipping does**.

When autonomy is unlocked and ON, queued drafts upgrade to `status: 'scheduled'` with
`sendAt = now + 15 min`; a **minute-cron** fires due ones; the Outbox shows a live
**countdown with a cancel button** (the cancel window). Eligibility gates the *unlock*; an
explicit grant **persists until revoked** — a silent auto-revoke "felt broken in testing,"
a nice detail showing product empathy.

> This is "autonomy as a **progression system** with a safety window" — and it's
> **server-enforced** (a `409` if you try to enable it while ineligible), not just a UI
> nicety.

## B7. Crons

[api/src/overnight.js](api/src/overnight.js) (plus a digest cron) runs scheduled work with
`node-cron`:
- **06:00 daily — the overnight agent.** For each user with overdue invoices, call the AI
  service to **draft** reminder emails (with cooldown 3 days, cap 5, skip already-queued —
  idempotent). Drafts land as `status: 'queued'` outbox rows; the chat shows a "While you
  were away" card with per-draft Send / Edit / Skip. Crucially there's a **template
  fallback** so "the night shift never dies" even if the model is unavailable.
- **Every minute — the autonomy sweep.** Fire `scheduled` auto-sends whose `sendAt` has
  passed (and whose cancel window expired).
- **Sunday 18:00 — the weekly digest.** Gather metrics+insights+forecast, have the model
  compose a week-in-review (template fallback), and email it to the **owner** via their own
  Gmail.

> **Limitation to mention:** crons run in **server-local time**; per-user timezones aren't
> modeled yet.

## B8. The public concierge surface

The most novel feature: **invoices that talk back.** Each invoice can mint a `shareToken`
(144-bit random, base64url). The public page `/invoice/:token` lets **the owner's client**
chat with a **bounded** concierge persona ([ai/app/concierge.py](ai/app/concierge.py)):
- The concierge agent's prompt contains **only that one invoice's snapshot** — it can't see
  the rest of the books.
- It can hand over the PDF, **record a payment promise** (which feeds the forecast as a
  **first-party signal** that outranks statistical inference), and **propose an
  arrangement** (extension/installments) — but **guardrails (max extension days, max
  installments, balance match) are validated *in the tool*, not just in the prompt.**
- Proposals create a `Proposal` row; the **owner approves/declines in their chat**; approval
  applies to the books (extension → new `dueDate`; installments → plan + first-installment
  due).
- The public chat endpoint is **rate-limited** (30 msgs/hr/token, in-memory buckets).

> **Security framing:** the share link is **bearer auth** — anyone with the URL is "the
> client" (same trust model as e-sign links). Fine for v1; per-recipient PINs would be next.
> Guardrails-in-code (not just in the prompt) is the key safety principle: **never trust the
> LLM to enforce a limit a malicious prompt could talk it out of.**

---

# PART C — The AI service (FastAPI)

[ai/app/main.py](ai/app/main.py) is a thin **FastAPI** app exposing endpoints **called only
by the Node API** (authenticated by the shared `X-Service-Token`):

| Endpoint | Purpose |
|---|---|
| `POST /chat` | owner chat turn → SSE stream |
| `POST /resume` | resume a HITL-paused run with decisions → SSE |
| `POST /concierge` | client-facing per-invoice chat → SSE (same protocol) |
| `POST /extract` | multipart file → Gemini vision → structured invoice JSON |
| `POST /overnight` | draft+queue reminders (cron/manual) |
| `POST /digest` | compose+send weekly owner digest |
| `POST /check-replies` | scan Gmail for client replies → payment promises |
| `POST /knowledge/ingest` | chunk+embed a knowledge source |
| `POST /send` | send an owner-approved email |
| `GET /health` | liveness + which model is active |

**Key concept — sync streaming in a threadpool.** The chat endpoints return a
`StreamingResponse` wrapping a **synchronous** generator (`stream_agent_sse`), and use the
**sync** `MongoDBSaver`. Why sync, not async?
- The async story for LangGraph checkpointers has version-specific edge cases.
- **Starlette automatically runs a sync generator in a worker threadpool**, so it doesn't
  block the event loop.
- Result: "boring, correct, and it shipped." The **trade-off** is one worker thread per
  active stream — fine at take-home scale, revisit for high concurrency. (A textbook
  pragmatic engineering decision.)

**FastAPI essentials shown here:** Pydantic request models (`ChatIn`, `ResumeIn`, …) give
**automatic validation + typed parsing** of request bodies; `Header(default=None)` pulls the
service token; `UploadFile` handles multipart; `HTTPException(status, detail)` returns clean
errors (the `/extract` route caps file size at 10 MB and returns `413`/`422` on failure).

**The httpx wrapper** ([ai/app/node_client.py](ai/app/node_client.py)) is the AI side of the
single write path: a tiny `request(user_id, method, path, json, params)` that always attaches
`X-Service-Token` + `X-User-Id` + `X-Actor: agent`, raises `NodeAPIError` on `>=400`, and
returns parsed JSON. **Every tool goes through it; none touch Mongo.**

---

# PART D — The frontend

**React 19 + TypeScript + Vite + Tailwind v4 + Recharts.** Highlights worth understanding:

**State philosophy — "the server is the store."** There's **no Redux/global store**. React
context holds only **auth and theme**. All business data flows through `useLiveData`
([web/src/hooks/useLiveData.ts](web/src/hooks/useLiveData.ts)): fetch on mount, then
**refetch on the relevant `entity:changed` socket event**, plus maintain the agent-glow
highlight set. The single source of truth is the database, surfaced live — so there's no
client cache to invalidate or drift.

**`useChatStream`** ([web/src/hooks/useChatStream.ts](web/src/hooks/useChatStream.ts)) — the
chat engine, already dissected in [A7](#a7-streaming-sse-and-the-event-protocol). Note the
**stale-session guard**: `startedFor = sessionRef.current` is captured at stream start, and
every update checks `if (sessionRef.current !== startedFor) return` — so if you switch
conversations mid-stream, the old stream's tokens don't bleed into the new view. It also
fires **spotlight** events (`spotlightForTool`) so the dashboard region Penny is "reading"
glows. `uploadDocument` handles the drag-in vision flow; `resume` handles HITL.

**Design system (no component library)** — hand-rolled Tailwind v4 tokens in `index.css`
`@theme` (warm paper, ledger green, copper). **Three themes** (`paper`/`light`/`dark`) are
**pure CSS-variable overrides** on `<html data-theme>` — components never change. A semantic
`--color-card` token decouples surfaces from `text-white`. Charts read theme colors via a
hook (because SVG attributes can't use `var()`). **Why no shadcn/Material?** The brief said
"don't look like Streamlit"; default component libraries read as "developer tool," and the
audience is non-technical owners who need to *trust* the software.

**Tailwind v4 gotcha (in CLAUDE.md):** custom classes live in `@layer components`, and you
**cannot `@apply` a custom class inside another** — use group selectors instead.

**Voice** ([useSpeak.ts](web/src/hooks/useSpeak.ts), [useSpeechInput.ts](web/src/hooks/useSpeechInput.ts)) —
**Web Speech API** both directions: mic input with live transcripts, briefing read-aloud
(speechSynthesis), and a **hands-free loop** (speak → auto-listen → auto-submit). Ideal for a
35+, non-technical, maybe-driving owner.

**Layout & polish:** split view with a draggable divider (340px–60vw,
localStorage-persisted, double-click reset); mobile collapses to a tab bar; **PWA**
(installable manifest + icons); **a11y** (skeleton loaders, `aria-live` streaming region).

---

# PART E — The data model

MongoDB, db `penny` (the agent's checkpoints live separately in `penny_agent`):

| Collection | Holds | Notes |
|---|---|---|
| `users` | auth, `concierge` guardrails, `autonomy` grant | bcrypt password, Google sub |
| `clients` | name/contact/email + learned `behavior` (payment personality) | |
| `invoices` | lineItems, payments[], share/promise/installment fields | **money math = virtuals only** |
| `chatsessions` / `messages` | conversation history, events, artifacts, interrupt state | mirrors LangGraph checkpoints for the history UI |
| `emails` | the outbox state machine | `queued/scheduled/sent/simulated/failed/dismissed`, `sendAt`, `editedByOwner` |
| `proposals` | client-negotiated arrangements | pending → approved/declined |
| `memories` | durable cross-session facts | injected into the system prompt |
| `activities` | the audit trail | written by `emitChange`; agent-created carry `undo` |
| `counters` | atomic per-user invoice sequence | race-safe `$inc` |

**Payment personalities:** per client, `mean(final payment date − due date)` over paid
invoices (n≥2 required) → a label ("usually pays ~12 days late") shown on the Clients tab and
exposed to the agent in `list_clients`. **Cash-flow forecast:** expected date = due +
max(0, avgDaysLate), **overridden by client promises** (first-party signal beats statistics),
bucketed into 8 weekly bars with a per-payment "why" line. **Guardian ("Penny noticed"):**
pure heuristics — duplicate (same client+amount, both unpaid, <30d apart), retainer gap, broken
promise (promised date passed, still unpaid). **All explainable arithmetic, by design — no ML
black box where the owner needs to trust the number.**

---

# PART F — Cross-service contracts

Three contracts bind the services. **Change one side → change the others.**

1. **SSE event protocol** (ai → api → browser): `token / activity / artifact / interrupt /
   error / done`. Defined in [streaming.py](ai/app/streaming.py)'s docstring; relayed +
   parsed in [chat.js](api/src/routes/chat.js); consumed in [useChatStream.ts](web/src/hooks/useChatStream.ts).
2. **Service auth:** `X-Service-Token` (shared secret) + `X-User-Id` (act-as) + `X-Actor:
   agent`. The actor propagates into socket events → glow + audit attribution come from the
   transport.
3. **Resume (HITL):** `POST /api/chat/sessions/:id/resume {messageId, decisions:[{type:
   approve|edit|reject, ...}]}` → relay → `agent.stream(Command(resume={"decisions": ...}))`
   on the same `thread_id`. Double-resume blocked by the `pending → resolved` flip in Mongo.

---

# PART G — Security posture

What's done (and why), straight from [docs/TECHNICAL.md](docs/TECHNICAL.md) §7:
- **Passwords:** bcrypt(10). **Sessions:** JWT in an httpOnly, `SameSite=Lax`, `secure`
  (prod) cookie. **Google sign-in** verified server-side (`verifyIdToken`) — no
  client-trusted identity.
- **Service-to-service** shared secret; **the AI never holds its own DB write access** — it
  can only act through Node, as a named user.
- **Public surface = three tokenized endpoints** (view / PDF / concierge chat). Tokens are
  144-bit random; chat is **rate-limited per token**; the concierge prompt contains a single
  invoice; **guardrails are enforced in code, not prose.**
- **Secrets only in env;** `.env`, the brief's `requirement.txt` (which contains a *shared*
  OpenAI key given to all candidates — never used, never committed), and OAuth secrets are
  gitignored. **History is scanned for key patterns** before pushing (a CI-able one-liner in
  [docs/DEPLOY.md](docs/DEPLOY.md)).

**Knowingly *not* done (and saying so is a strength):** CSRF tokens (SameSite=Lax mitigates
the common cases), password reset, email verification, per-user encryption at rest,
per-recipient concierge PINs, distributed rate-limiting (the in-memory buckets reset on
restart and assume a single instance).

> **The transferable principle:** *enforce limits in code, not in the prompt.* A prompt
> instruction ("only extend up to 14 days") is a suggestion a crafted message can override;
> a check in the tool is a wall.

---

# PART H — Deployment

Target: **Render free tier + MongoDB Atlas free tier**, driven by
[render.yaml](render.yaml) (a Blueprint that defines both services). Full runbook in
[docs/DEPLOY.md](docs/DEPLOY.md). The shape:

1. **Atlas** M0 free cluster → connection string. (App db `penny`; agent checkpoints auto-use
   `penny_agent`.) Network access `0.0.0.0/0` because Render's egress IPs vary on free tier.
2. **Render → New → Blueprint** → it reads `render.yaml` and proposes **penny-app** (Node) +
   **penny-ai** (Python). Fill env: `MONGODB_URI` (both), the **same** `SERVICE_TOKEN` in
   both (must match exactly), `GOOGLE_API_KEY`, optional `GOOGLE_CLIENT_ID`/`COMPOSIO_*`.
3. **Cross-wire the URLs:** Render may suffix service names, so penny-app's `AI_URL` must
   equal penny-ai's real URL and vice-versa (`NODE_API_URL`).
4. **Seed** the demo account against prod once: `MONGODB_URI=… node api/src/seed.js`.
5. **Smoke-test on the deployed URL** (health endpoints, the live-dashboard pop proves
   websockets-through-proxy, a real Gmail send proves Composio).
6. **Keep awake:** free instances sleep after 15 idle minutes (~1 min cold start) →
   UptimeRobot pings both `/api/health` and `/health`.

**Single-origin vs. the Vercel variant:** the default serves the SPA from Express (one URL,
cookies first-party, simplest). [web/vercel.json](web/vercel.json) is prepared for
frontend-on-Vercel — it **proxies `/api` through Vercel's edge so the auth cookie stays
first-party** (a direct cross-origin call would make it third-party, which Safari/iOS block).
Two trade-offs to name: **WebSockets don't upgrade through Vercel rewrites** (Socket.IO falls
back to long-polling automatically), and SSE may get **edge-buffered** (the Render URL always
streams cleanly).

> **Cold-start economics:** Render free = 750 instance-hrs/month per service; two always-on
> services fit one month *exactly* — so you pause the keep-alive monitors after review.

---

# PART I — Testing strategy

A multi-pronged approach (from [docs/TECHNICAL.md](docs/TECHNICAL.md) §10):
- **Scripted-model E2E over the real stack** — curl the SSE flows for chat, HITL
  approve/edit/reject, concierge promise/negotiate/guardrail, the autonomy ladder including a
  **cron-fired** send. Deterministic, key-free.
- **`npm test`** = a **26-assertion eval suite** driving the running stack on the scripted
  model (auth, tool mutations, HITL interrupt/resume/**double-resume**, concierge promises +
  guardrails + proposals, guardian detectors, trust gating). ~15s, zero keys.
- **Playwright** (system Chrome via `channel:'chrome'`) visual passes for every UI surface;
  screenshots reviewed per milestone.
- **Real-model verification on Gemini** — the brief's "David" context test, multi-agent
  routing, vision-extraction field accuracy, overnight drafting tone.
- **Static gates:** eslint (0-errors policy), `tsc -b`, `node --check`, `py_compile`.
- **Observability:** LangSmith tracing by env var.

> **The headline:** *the scripted model makes a non-deterministic LLM product
> deterministically testable.* That's the testing story to lead with.

---

# PART J — The decisions, with trade-offs

Condensed from [DECISIONS.md](DECISIONS.md) — each is a "why," and the *why* is what
interviews reward. (Newest insight: always pair a decision with the alternative you
rejected.)

| Decision | Why (and the rejected alternative) |
|---|---|
| **Invoice copilot, not a research bot** | A real SMB pain (chasing receivables) where tool use is *visible* (the dashboard moves). The obvious alternative — a web-search bot — outputs only text. |
| **MERN + separate FastAPI AI service** | Matches the brief's stack exactly; shows service-boundary design. Cost: one cross-service streaming seam. |
| **Agent tools → Node REST, never Mongo** | One write path → one validation layer → one event emitter → free live dashboard + audit + attribution. Alternative (Python writes Mongo) needs change streams + a second schema. |
| **Subagents-as-tools; `send_email` on the supervisor** | Current LangChain 1.x idiom + visible teamwork, while the failure-prone interrupt/resume stays one top-level seam (nested-subgraph interrupts are risky). |
| **SSE over fetch (not EventSource), relayed via Express** | EventSource is GET-only; chat needs a POST body. Relaying keeps single origin and lets Node persist the final message. |
| **Sync LangGraph streaming in a threadpool** | Pairs with the sync Mongo checkpointer; zero async-saver edge cases. Cost: a thread per stream. |
| **Checkpointer in Atlas, keyed by session** | Context retention with no custom state code — and pending approvals survive restarts (a production argument). |
| **HITL on `send_email` only; approve/edit/reject** | Nothing external leaves without a yes; "edit before send" demos beautifully; reversible actions stay fluid. |
| **Scripted model behind the real interface** | E2E-tests the riskiest seams with no keys/quota; doubles as reviewer mode. |
| **Money math in virtuals** | "Overdue" is a function of time — storing it rots. One rule for UI + metrics + tools. Cost: can't index the derived status. |
| **Custom Tailwind design system** | The audience must *trust* it; component libraries read as developer tools. Cost: hand-built primitives. |

---

# PART K — Interview question bank

Practice these aloud. Answers are condensed — expand from the sections above.

### System design & architecture

**Q: Give me the 2-minute architecture overview.**
A: Three deployables, one Atlas cluster. `web/` (React SPA) + `api/` (Express 5: auth, CRUD,
chat relay, Socket.IO, crons) ship as one Render service serving a single origin; `ai/`
(FastAPI + LangGraph) is a second service. Two rules tie it together: **single origin** (no
CORS, first-party cookies) and **single write path** (every mutation, human or agent, goes
through the same Express routes, which validate + emit a Socket.IO event + write an audit
row). The AI never touches Mongo — it calls Node over REST with a service token, acting as
the user.

**Q: How does the dashboard update live when the agent acts?**
A: The agent's tool calls the same REST route a human click would; that route calls
`emitChange`, which emits `entity:changed` to the user's Socket.IO room and writes an
`Activity`. The browser's `useLiveData` refetches and glows the agent-tagged ids for 3s. It's
not special-cased — it falls out of the single write path.

**Q: Why split the AI into its own service instead of one Node app?**
A: The brief preferred MERN + a Python/FastAPI AI service with LangGraph; Python has the best
agent tooling; and it's a clean boundary. The only cost is streaming chat across two
services, which the SSE relay solves.

**Q: Walk me through a chat turn end to end.**
A: [§4](#4-end-to-end-walkthrough-of-one-chat-turn) — POST message → Node persists + relays
to AI → agent streams tokens/activity/artifacts → on `send_email` the HITL middleware
interrupts → Node relays the interrupt and persists the pending approval → user approves →
`/resume` with `Command(resume=...)` on the same thread → email actually sends → `emitChange`
updates the outbox.

### AI / agents

**Q: What makes this "agentic" rather than a chatbot?**
A: The LLM runs in a loop with ~14 tools (function calling). It reasons, calls a tool, reads
the result, and decides the next action until it answers — the ReAct pattern. The tools do
real CRUD via the API, so its actions change the product.

**Q: Explain the multi-agent topology and one trade-off.**
A: Supervisor (Penny) + two subagents (Bookkeeper, Analyst) wrapped as tools
(`ask_bookkeeper`/`ask_analyst`) — the LangChain 1.x idiom. Trade-off: I kept `send_email` on
the supervisor because HITL interrupts from a *nested* subgraph are a complex seam; top-level
keeps pause/resume to one tested path. Honest cost: routing is probabilistic, but tools are
shared truths so answers stay correct.

**Q: How does context retention work, and how is it different from cross-session memory?**
A: In-session = a LangGraph `MongoDBSaver` checkpointer keyed by `thread_id` (= chat session)
— the whole graph state is snapshotted to Mongo each step, so the "what's my name" test
passes with no custom code, and because it's in the DB, pending approvals survive restarts.
Cross-session = a `memories` collection; `save_memory` records durable facts that get
injected into the system prompt on every future run.

**Q: How do you prevent hallucinated numbers?**
A: The system prompt forbids guessing ("ask your team"); all data comes from tools that hit
the real API; metrics are computed server-side; RAG answers cite sources; vision uses
structured output. The model composes language, never invents facts.

**Q: What is human-in-the-loop here and how does resume survive a restart?**
A: `HumanInTheLoopMiddleware` interrupts the graph on `send_email`; the pause lives in the
Mongo checkpoint and the pending state in our `messages` collection. Resume sends decisions
to `/resume`, which calls `agent.stream(Command(resume=...))` on the same thread. Because both
the checkpoint and the pending flag are in Mongo, the server can sleep and the Approve button
still works. Double-resume is blocked by a `pending → resolved` flip.

**Q: Why SSE over fetch, not EventSource or WebSockets?**
A: EventSource is GET-only and chat needs a POST body, so I read the POST response body as a
stream. WebSockets are bidirectional/heavier and I reserve them (Socket.IO) for live dashboard
updates. SSE-over-fetch also relays cleanly through Express so I keep one origin and persist
the final message.

**Q: Explain the RAG pipeline and when you'd change it.**
A: Chunk → embed (Gemini, hashed-BoW fallback) → store vectors in Mongo → embed the query →
rank by exact cosine → feed top chunks back with citations. Exact cosine is fine for tiny SMB
corpora; at scale I'd switch to Atlas `$vectorSearch` (ANN index).

**Q: What's the scripted model and why is it a big deal?**
A: A deterministic fake model implementing the real `BaseChatModel` interface, with per-role
canned decisions that drive the *real* graph/tools/DB/sockets/HITL. It lets me E2E-test the
riskiest seams with zero keys and zero rate limits (the 26-assertion `npm test`), and lets
reviewers run the whole product without keys. The principle: isolate the non-deterministic
LLM behind an interface so everything around it is testable like normal software.

**Q: What does one multi-agent turn cost?**
A: 4–7 model requests, because every tool result round-trips the model. That's why I keep
tool payloads compact and why free-tier quota matters (flash-lite ~1,500/day is the daily
driver; the sharper preview model is ~20/day, demo-only).

### Backend / data

**Q: Why is "overdue" a virtual, not a stored field?**
A: It's a function of time — a stored status rots the moment a due date passes with no write.
A virtual derives it on read, so UI, metrics, and agent tools share one always-correct rule.
Cost: can't index it, so I filter in JS after a date pre-filter — fine at SMB scale.

**Q: How do you guarantee unique invoice numbers under concurrency?**
A: An atomic counters collection: `findOneAndUpdate({_id:userId+':invoice'}, {$inc:{seq:1}},
{upsert:true})`. `$inc` is atomic, so concurrent creates can't collide. "Count + 1" would race.

**Q: How is the websocket authenticated?**
A: It reuses the JWT cookie — `io.use` parses and verifies it on the handshake and stamps
`socket.data.userId`; each socket joins a `user:<id>` room so events are per-user.

**Q: How does the AI act "as" a user safely?**
A: `requireUserOrService` accepts a correct `X-Service-Token` + `X-User-Id` + `X-Actor`. The
AI never has its own DB access; it can only act through Node as a named user, and the
`agent` actor tag flows into events for attribution.

**Q: How is autonomy "earned"?**
A: Over the last 10 reminder decisions, ≥5 approved-untouched and 0 skipped unlocks the
toggle (editing doesn't break trust; skipping does). It's server-enforced (409 otherwise).
With autonomy on, sends schedule 15 minutes out with a cancel window fired by a minute-cron.

### Frontend

**Q: Why no global state store?**
A: The server is the store. `useLiveData` fetches and refetches on socket events; there's no
client cache to invalidate. Context holds only auth/theme.

**Q: How does switching conversations mid-stream not corrupt the UI?**
A: `useChatStream` captures `startedFor` at stream start and ignores any update where
`sessionRef.current !== startedFor` — stale tokens are dropped.

**Q: How do three themes work without touching components?**
A: CSS-variable overrides on `<html data-theme>`; components use semantic tokens like
`--color-card`. Charts read theme colors via a hook because SVG attrs can't use `var()`.

### Security / deployment

**Q: What's your security posture and what did you skip?**
A: bcrypt + httpOnly SameSite=Lax JWT cookie; server-verified Google ID tokens; service
token for AI; tokenized public surface with per-token rate limiting and **in-code**
concierge guardrails; secrets in env + history scanned. Skipped knowingly: CSRF tokens,
password reset, email verification, at-rest encryption, distributed rate limiting.

**Q: Why enforce concierge guardrails in code, not the prompt?**
A: A prompt limit is a suggestion a crafted message can override; a check in the tool is a
wall. Never let the LLM be the security boundary.

**Q: What breaks on Render's free tier and how do you cope?**
A: 15-min idle sleep (~1 min cold start) → UptimeRobot keep-alive; and because checkpoints
live in Atlas, a mid-approval sleep doesn't lose the pending approval.

---

## Glossary

- **Agent:** an LLM in a loop that can call tools and act on the results until it answers.
- **a11y:** accessibility (e.g. `aria-live`, skeleton loaders).
- **bcrypt:** a slow, salted password-hashing function resistant to brute force.
- **Bearer auth:** possession of a token = access (the concierge share link).
- **Checkpointer:** LangGraph's persistence — snapshots graph state so conversations and
  pauses survive restarts. Here `MongoDBSaver`, keyed by `thread_id`.
- **CFG/temperature:** `temperature` controls LLM randomness (0 = deterministic).
- **Cold start:** the delay when a slept free-tier instance wakes (~1 min on Render).
- **Composio:** a service that gives agents real tool integrations (here, Gmail send).
- **Cosine similarity:** angle-based closeness of two embedding vectors; 1.0 = most similar.
- **CRUD:** Create/Read/Update/Delete.
- **CSRF:** cross-site request forgery; mitigated here by `SameSite=Lax` cookies.
- **Cron:** scheduled job (overnight 06:00, autonomy sweep per minute, digest Sunday 18:00).
- **Embedding:** a numeric vector representing text meaning; near vectors = near meanings.
- **EventSource:** the browser's classic SSE API — **GET-only**, hence not used for chat.
- **FastAPI:** Python web framework; serves the AI service with Pydantic validation.
- **Function calling / tool calling:** the LLM emits a structured request to run a named,
  typed function; the runtime executes it and returns the result.
- **HITL (human-in-the-loop):** the agent pauses for human approval before an irreversible
  action (only `send_email`).
- **httpOnly cookie:** a cookie JS can't read — protects the JWT from XSS theft.
- **httpx:** the Python HTTP client the AI tools use to call Node.
- **Idempotent:** safe to run repeatedly with the same effect (the overnight drafting).
- **init_chat_model:** LangChain's provider-agnostic model constructor.
- **Interrupt / resume:** LangGraph's HITL primitives; resume via `Command(resume=...)`.
- **JWT:** a signed, self-contained token carrying the user id; verified by signature.
- **LangChain / LangGraph:** the LLM-app framework / its stateful-graph agent runtime.
- **Mongoose:** the MongoDB ODM (schemas, validation, virtuals).
- **Multi-agent (subagents-as-tools):** a supervisor agent delegates to specialist agents
  wrapped as tools.
- **ODM:** Object-Document Mapper (Mongoose for MongoDB).
- **ReAct:** the Reason+Act agent loop.
- **RAG:** retrieval-augmented generation — fetch private snippets, feed them to the model.
- **Recharts:** the React charting library used for aging/cashflow/forecast charts.
- **Render Blueprint:** `render.yaml`-driven multi-service deploy.
- **Room (Socket.IO):** a named channel; here `user:<id>` for per-user events.
- **SSE (Server-Sent Events):** one-way server→client streaming over HTTP; `event:`/`data:`
  frames separated by blank lines.
- **Single origin:** serving SPA + API + socket from one domain → first-party cookies, no CORS.
- **Single write path:** every mutation (human or agent) goes through the same routes.
- **Service token:** the shared secret authenticating AI↔API calls.
- **Socket.IO:** WebSocket library with rooms, reconnect, and long-polling fallback.
- **Structured output:** forcing the model to return schema-valid (Pydantic) data.
- **System prompt:** the framing text that sets the model's role, rules, and context.
- **thread_id:** the conversation key for the checkpointer (= chat session id).
- **Token (LLM):** the unit of model input/output and billing (~a word-piece).
- **Vision model:** a multimodal LLM that reads images (invoice extraction).
- **Virtual (Mongoose):** a computed, non-stored field (balance, effectiveStatus, …).

---

## One-page cheat sheet

**Product:** AI back office for SMB owners — chat agent welded to a live dashboard it
operates; nothing external sends without owner approval. Audience: 35+, non-technical → plain
words, big type, suggested buttons.

**Three tiers:** `web/` React 19 SPA · `api/` Express 5 (auth, CRUD, SSE relay, Socket.IO,
crons) — both one Render service, single origin · `ai/` FastAPI + LangGraph. DB: Atlas
(`penny` app data + `penny_agent` checkpoints).

**Two golden rules:** (1) **single origin** (no CORS, first-party cookies); (2) **single
write path** — every mutation, human or agent, goes through the same Express route →
validate → `emitChange` (Socket.IO event + audit row). AI never touches Mongo; it calls Node
with `X-Service-Token` + `X-User-Id` + `X-Actor: agent`.

**Agent:** LangGraph supervisor (Penny) + Bookkeeper + Analyst (subagents-as-tools), ~14
tools, all httpx → Node REST. `send_email` gated by `HumanInTheLoopMiddleware` at the
supervisor. `MongoDBSaver` checkpointer keyed by chat session (context + approvals survive
restarts). Cross-session memory injected into the system prompt.

**Streaming:** SSE over fetch (EventSource is GET-only). Protocol `token / activity /
artifact / interrupt / error / done`. Node relays bytes untouched + parses a copy to persist.
Same protocol for owner chat, resume, and concierge.

**HITL:** interrupt on `send_email` → approval card (approve/edit/reject) → `/resume
{decisions}` → `Command(resume=...)` on same thread. Double-resume blocked by `pending →
resolved`.

**Money math = Mongoose virtuals** (`balance`, `effectiveStatus`='overdue' is derived,
`daysOverdue`). Atomic invoice numbers via `$inc` counters.

**Differentiators:** live agent-glow dashboard · earned autonomy (5 untouched approvals, 0
skips → unlock; 15-min cancel window) · client concierge (bounded, guardrails in code) ·
vision extraction (structured output) · RAG knowledge base (cosine, citations) · overnight
agent + weekly digest crons · **scripted model** (zero-key deterministic E2E + reviewer mode).

**Model strategy:** provider-agnostic `init_chat_model` + `PENNY_MODEL`. flash-lite
~1,500/day (daily driver), preview ~20/day (demo), scripted (free). One turn = 4–7 requests.

**Security:** bcrypt(10) · httpOnly SameSite=Lax JWT · server-verified Google · service
token · tokenized + rate-limited public surface · guardrails in code, not prompt · secrets in
env + history scanned. Skipped knowingly: CSRF tokens, password reset, at-rest encryption.

**Deploy:** Render Blueprint (`render.yaml`) + Atlas, free tiers; match `SERVICE_TOKEN` in
both services; cross-wire `AI_URL`/`NODE_API_URL`; UptimeRobot keep-alive. Vercel variant
proxies `/api` to keep cookies first-party (Socket.IO falls back to long-polling).

**Run:** `npm run dev` (api :4001 · ai :8400 · web :5173) · `npm run seed`
(demo@penny.app / demo1234) · `npm test` (26-assertion scripted E2E) · `PENNY_MODEL=scripted`
for key-free dev.

---

*End of guide. The night before an interview, re-read [§4](#4-end-to-end-walkthrough-of-one-chat-turn),
[PART A](#part-a--ai--agent-concepts), [PART J](#part-j--the-decisions-with-trade-offs), and
[PART K](#part-k--interview-question-bank); the rest is reference.*

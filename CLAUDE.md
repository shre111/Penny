# CLAUDE.md — working on Penny

Penny = AI back office for small businesses: chat agent (LangGraph multi-agent) + live dashboard (invoices/clients/cash-flow) that the agent controls. M32 take-home project. Read [ROADMAP.md](ROADMAP.md) for what to build next, [DECISIONS.md](DECISIONS.md) before changing architecture.

## Run

```bash
npm run dev        # runs free-ports preflight, then api :4001 + ai :8400 + web :5173
npm run seed       # demo account demo@penny.app / demo1234 ("Bluepeak Studio" sample data)
npm run build      # builds web/dist (Express serves it in prod = single origin)
```

- Root `.env` is shared by both servers in dev (gitignored). `ai/.venv` is Python 3.13 (`python3.14` venv is broken on this machine — ensurepip fails).
- Ports: web 5173 → proxies `/api` + `/socket.io` to api 4001; ai on 8400. **Do not use 8000** (a Docker Chroma container squats on it) — and 4001 not 4000 (user's choice).
- Local mongod already runs as a service on 27017.
- `PENNY_MODEL=scripted` = deterministic dev model, zero API keys, real tools/graph/HITL — use it for E2E tests instead of burning Gemini quota. Real models (one multi-agent turn = 4–7 requests): `google_genai:gemini-3.1-flash-lite` is the daily driver (~1,500 req/day free); `gemini-3-flash-preview` is better but only **20 req/day free** — demo recordings only.
- `PENNY_MULTI_AGENT=false` collapses to a single agent (debugging aid).

## Map

- `api/src/` — Express 5. `auth/` (JWT httpOnly cookie + Google ID-token verify), `routes/` (clients, invoices, metrics, emails, memories, demo, uploads, **chat.js = the SSE relay + /resume**), `realtime.js` (Socket.IO, `emitChange`), `models/`, `seedData.js`.
- `ai/app/` — FastAPI. `agent.py` (supervisor + Bookkeeper/Analyst subagents-as-tools, HumanInTheLoopMiddleware on `send_email`, MongoDBSaver keyed by chat-session id), `tools.py` (tool groups; ALL tools call Node REST via `node_client.py` — never Mongo directly), `streaming.py` (LangGraph stream → SSE protocol: token/activity/artifact/interrupt/error/done), `scripted_model.py` (role-aware fake model), `extraction.py` (Gemini vision → Pydantic).
- `web/src/` — React 19 + Tailwind v4. `hooks/useChatStream.ts` (fetch-stream SSE reader, resume, upload), `hooks/useLiveData.ts` (socket refetch + agent-glow highlights), `components/chat/` (MessageView, cards: Approval/Extraction/Chart/InvoiceList, ChatPanel), `components/dashboard/`, design tokens in `index.css` (`@theme`).

## Rules of the house

- **Single write path:** agent tools → Node REST with `X-Service-Token` + `X-User-Id` + `X-Actor: agent`. Every mutation route must call `emitChange(...)` — the live dashboard and glow animations depend on it. Never write Mongo from `ai/`.
- **HITL:** only `send_email` is interrupt-gated, at the supervisor level. If you gate more tools, keep them on the supervisor (subagent interrupts are an untested seam — see DECISIONS).
- **SSE protocol** between ai→api→browser is the contract in `streaming.py`'s docstring; api/chat.js parses a copy of the stream to persist the assistant message + interrupt state. Change all three layers together.
- **UI language:** plain words for a 50-year-old owner ("money owed to you", never "accounts receivable"). Tailwind v4: custom classes live in `index.css` `@layer components`; you cannot `@apply` a custom class inside another (group selectors instead).
- **Money math** (balance/overdue/daysOverdue) lives in Invoice virtuals only — don't duplicate it.
- **Secrets:** `.env` and `requirement.txt` are gitignored. `requirement.txt` (the brief) contains a *shared* OpenAI key given to all candidates — never use it, never commit it. Scan before pushing: `git log -p | grep -ciE 'sk-proj-|AIza|AQ\.'` should be 0.

## Testing patterns that already work

- E2E chat via curl: login → `POST /api/chat/sessions` → `POST .../messages` with `-N`, read the SSE frames. Resume: `POST .../resume {messageId, decisions:[{type:'approve'|'edit'|'reject',...}]}`.
- Browser checks: Playwright scripts in `.data/shot*.mjs` (uses installed Chrome via `channel:'chrome'`); screenshots → `.data/shots/`.
- Socket events: `.data/socket_test.mjs` listens while you trigger a mutation.
- The context-retention acceptance test: "My name is David" … "What is my name?" in one session → must answer David.
- **`npm test`** runs the 26-assertion E2E eval suite against a running stack (use PENNY_MODEL=scripted).

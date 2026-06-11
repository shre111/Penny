# Roadmap — what's next, in priority order

Goal: go past the basics before the M32 deadline (~June 12, 2026). Ranked by impact-per-hour against their rubric: above-and-beyond, agentic behavior, product sense for non-technical SMB owners.

## Now (logistics before code)

- [ ] **1. Deploy to Render + Atlas** (~1–2h, accounts needed)
  Free Atlas M0 cluster → Render "New → Blueprint" on this repo (`render.yaml` defines both services) → fill env vars (Atlas URI ×2, same `SERVICE_TOKEN` in both, `GOOGLE_API_KEY`). Deploy pain found today beats deploy pain on submission night. Free tier sleeps after 15 min — wake it before demos.
- [ ] **2. Named bonus creds** (~1h)
  - `GOOGLE_CLIENT_ID` (OAuth Web Client, console.cloud.google.com; add localhost:5173 + the Render origin to Authorized JavaScript Origins) → the Google sign-in button appears automatically.
  - `COMPOSIO_API_KEY` (composio.dev free tier) + connect Gmail once in their dashboard → approved reminders really send. Without it the outbox shows "Saved (not sent)" — flow still demos.

## Next (the differentiators)

- [x] **3. Overnight agent — "Penny works while you sleep"** ⭐ — node-cron daily at 06:00 + "Run the overnight check now" button (Outbox tab). Drafts via the real model (template fallback so the night shift never dies), queues as `status:'queued'` emails, "While you were away" card in chat with per-draft Send / Edit / Skip. Idempotent (cooldown + already-queued checks); double-approve returns 409.
- [x] **4. Voice input** — mic button in the composer (Web Speech API), live transcripts, hidden on unsupported browsers.
- [x] **5. Audit trail + undo** — every `emitChange` persists an `Activity`; "Activity" tab shows who did what (You vs Penny) with one-click Undo on agent-created records.
- [x] **6. Dashboard → chat actions** — hover an invoice row: Ask Penny / Chase (overdue only) / PDF. Control flows both directions.

## If time remains

- [x] **7. PDF invoice generation** — branded PDF per invoice (`GET /api/invoices/:id/pdf`), row download button + `get_invoice_pdf_link` agent tool.
- [x] **8. Public landing page** — `/` is a product page when signed out: live app screenshot, feature grid, "Try the live demo" button that signs into the demo account.
- [x] **Bonus round: payment personalities + cash-flow forecast + voice-out** — client payment habits learned from history (badges + agent-aware), "Money coming in" forecast card + make_chart(forecast), Penny reads the briefing aloud (speechSynthesis)
- [x] **The invoice that talks back (client concierge)** ⭐ — public tokenized invoice pages where YOUR CLIENT chats with Penny: explains charges, hands over the PDF, records payment promises (which feed the forecast as first-party signal), and negotiates extensions/installments WITHIN owner-set guardrails → owner approves/declines in chat → books update. Rate-limited public endpoint; strictly scoped persona.
- [x] **Hands-free conversation mode** — headphones toggle: Penny answers aloud, then listens for the next request (Web Speech in + out).
- [x] **Penny's pointer** — the dashboard element she's reading/changing spotlights as she works (tool activity → glow).
- [ ] **9. CSV import** (~1–2h) — bulk-load clients/invoices; useful for reviewers with their own data.
- [ ] **10. LangSmith tracing** (~10 min) — env vars only; "how do you debug agents" answer for the interview.

## ⚠ Model quota notes (learned the hard way)

`gemini-3-flash-preview` free tier = **20 requests/day** — that's ~3 chat turns. Use it ONLY for the demo recording (quota resets daily; record early). Daily driver is `gemini-3.1-flash-lite` (~1,500/day, 15/min) — verified working with the full multi-agent + overnight stack. `PENNY_MODEL=scripted` for free UI iteration.

## Always last

- [ ] **Demo video + submission** — record against the deployed URL, then email clarissa@m32.ai + the form, with the deployed URL and the (key-scrubbed) GitHub link.

## Done so far

✅ Auth (email/password + Google OAuth code path) · streaming chat · context retention (Mongo checkpointer — "David" test passes on the real model) · multi-agent supervisor + Bookkeeper/Analyst with visible activity · ~11 real tools via single REST write path · live dashboard with agent-glow · HITL approve/**edit**/skip with restart-surviving approvals · vision invoice extraction (verified) · morning briefing · cross-session memory · Composio fallback outbox · demo seed + "Load sample business" · scripted zero-key dev model · render.yaml/.env.example/README/DECISIONS docs · real-Gemini E2E verified end to end

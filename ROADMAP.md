# Roadmap — what's next, in priority order

Goal: go past the basics before the M32 deadline (~June 12, 2026). Ranked by impact-per-hour against their rubric: above-and-beyond, agentic behavior, product sense for non-technical SMB owners.

## Now (logistics before code)

- [ ] **1. Deploy to Render + Atlas** (~1–2h, accounts needed)
  Free Atlas M0 cluster → Render "New → Blueprint" on this repo (`render.yaml` defines both services) → fill env vars (Atlas URI ×2, same `SERVICE_TOKEN` in both, `GOOGLE_API_KEY`). Deploy pain found today beats deploy pain on submission night. Free tier sleeps after 15 min — wake it before demos.
- [ ] **2. Named bonus creds** (~1h)
  - `GOOGLE_CLIENT_ID` (OAuth Web Client, console.cloud.google.com; add localhost:5173 + the Render origin to Authorized JavaScript Origins) → the Google sign-in button appears automatically.
  - `COMPOSIO_API_KEY` (composio.dev free tier) + connect Gmail once in their dashboard → approved reminders really send. Without it the outbox shows "Saved (not sent)" — flow still demos.

## Next (the differentiators)

- [ ] **3. Overnight agent — "Penny works while you sleep"** (~3h) ⭐ highest signal
  Daily cron (node-cron in `api/`, or Render cron) that: finds invoices that became overdue → drafts reminder emails → queues them as pending approvals → user logs in to a "While you were away" card with approve/edit/skip buttons. Autonomous agency + human-in-the-loop safety in one feature. Implementation sketch: reuse the outbox pattern (pending `emails` docs with `status:'queued'` + an approve endpoint) rather than LangGraph interrupts — no live stream exists overnight.
- [ ] **4. Voice input** (~1h)
  Web Speech API mic button in the composer (`webkitSpeechRecognition`, Chrome/Safari). Perfect for the 35+, non-technical persona; great demo beat.
- [ ] **5. Audit trail + undo** (~2h)
  Persist the already-emitted `entity:changed` events to an `activities` collection → "Recent activity" tab (every change, human vs Penny, when) + Undo (void/delete) on agent-created records. Trust-building; very "real business software".
- [ ] **6. Dashboard → chat actions** (~1h)
  Click an invoice row → "Ask Penny about this" prefills the composer ("What's the story with INV-0001?"). Control then flows in BOTH directions between app and chat — a story no one else will have.

## If time remains

- [ ] **7. PDF invoice generation** (~2–3h) — "Invoice Acme $450 and send it" → branded PDF (pdfkit) attached to the email / downloadable from the dashboard.
- [ ] **8. Public landing page** (~1.5h) — submission URL opens to a product page, not a login wall.
- [ ] **9. CSV import** (~1–2h) — bulk-load clients/invoices; useful for reviewers with their own data.
- [ ] **10. LangSmith tracing** (~10 min) — env vars only; "how do you debug agents" answer for the interview.

## Always last

- [ ] **Demo video + submission** — script and checklist in [docs/DEMO.md](docs/DEMO.md). Email clarissa@m32.ai + the form, with the deployed URL and the (key-scrubbed) GitHub link.

## Done so far

✅ Auth (email/password + Google OAuth code path) · streaming chat · context retention (Mongo checkpointer — "David" test passes on the real model) · multi-agent supervisor + Bookkeeper/Analyst with visible activity · ~11 real tools via single REST write path · live dashboard with agent-glow · HITL approve/**edit**/skip with restart-surviving approvals · vision invoice extraction (verified) · morning briefing · cross-session memory · Composio fallback outbox · demo seed + "Load sample business" · scripted zero-key dev model · render.yaml/.env.example/README/DECISIONS docs · real-Gemini E2E verified end to end

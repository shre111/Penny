# Penny — engineering backlog

Issues, enhancements and features found in a review of the codebase on 2026-09-16.
One branch + PR per item; tick the box when it merges.

## Security & hardening

- [x] 1. `config.js` boots with the dev-default `JWT_SECRET` / `SERVICE_TOKEN` in production — `required()` takes a fallback, so it never actually fails. Anyone can forge a session cookie against a deploy that forgot to set them.
- [x] 2. `POST /api/chat/sessions/:id/resume` has no rate limit, though it drives a full multi-agent run. `/messages` is limited; resume is the same cost.
- [x] 3. `POST /api/demo/load` is unthrottled and destructive — it replaces the account's data on every call.
- [x] 4. `requireUserOrService` trusts `X-User-Id` verbatim; a malformed id reaches Mongo and surfaces as a CastError.
- [x] 5. List routes pass raw query params into Mongo filters (`emails`, `activities`, `proposals`) — a bad `invoiceId` 500s and an object-valued `status` injects an operator.

## Correctness

- [x] 6. `POST /api/memories` crashes with a 500 on a non-string `fact`, and measures the 300-char cap on untrimmed text.
- [x] 7. `/api/metrics/charts` leaves aging and cash-flow sums unrounded while `/summary` and `/briefing` round — the same totals disagree at the cent.
- [x] 8. `GET /api/invoices?status=` accepts any string and silently returns an empty list for a typo.
- [x] 9. `dueLabel()` renders "Due in -12 days" for a sent invoice whose balance cleared without a status flip.

## Frontend bugs

- [x] 10. `InvoiceDrawer`'s share errors render in the success colour — the same bug fixed in #96 for `KnowledgeCard`.
- [x] 11. `ActivityFeed`: one in-flight Undo disables every other row's Undo button.
- [x] 12. `QueuedDraftsCard`: one in-flight action disables every other draft's buttons.
- [ ] 13. `ProposalsCard`: one in-flight action disables every other proposal's buttons.
- [ ] 14. `ImportCard` revokes the template blob URL before the download starts.
- [ ] 15. `ImportCard` uses `text-danger-500` for errors where the rest of the app uses `text-danger-600`.
- [ ] 16. `api()` drops the JSON `Content-Type` when a caller passes its own `headers`.

## Performance

- [ ] 17. `recordActivity` runs a `countDocuments` on every single mutation just to decide whether to trim.
- [ ] 18. One socket event fans out into a refetch per `useLiveData` hook — the dashboard mounts seven, so a single invoice change fires seven requests.

## Features & enhancements

- [ ] 19. Export invoices and clients to CSV — the mirror of the existing import.
- [ ] 20. Add a Void filter to the invoice table; voided invoices are only reachable under "All".

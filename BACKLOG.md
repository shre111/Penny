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
- [x] 13. `ProposalsCard`: one in-flight action disables every other proposal's buttons.
- [x] 14. `ImportCard` revokes the template blob URL before the download starts.
- [x] 15. `ImportCard` uses `text-danger-500` for errors where the rest of the app uses `text-danger-600`.
- [x] 16. `api()` drops the JSON `Content-Type` when a caller passes its own `headers`.

## Performance

- [x] 17. `recordActivity` runs a `countDocuments` on every single mutation just to decide whether to trim.
- [x] 18. One socket event fans out into a refetch per `useLiveData` hook — the dashboard mounts seven, so a single invoice change fires seven requests.

## Features & enhancements

- [x] 19. Export invoices and clients to CSV — the mirror of the existing import.
- [x] 20. Add a Void filter to the invoice table; voided invoices are only reachable under "All".
- [x] 21. `npm run lint` fails on main: the share-link fix in #95 left a `let url = ''` that trips `no-useless-assignment`.

## Second pass — 2026-09-02

- [x] 22. `ai/app/config.py` has the same dev-fallback secret hole #98 closed on the Node side: an AI service started without `SERVICE_TOKEN` accepts the public default.
- [x] 23. `ChatPanel` never catches its session calls — a failed bootstrap, New conversation or Delete throws an unhandled rejection and the UI just doesn't move.
- [x] 24. `useSpeechInput.doStart()` replaces `recRef.current` without aborting the previous recognizer.
- [x] 25. `SpotlightKey` declares a `'forecast'` target nothing emits and nothing renders.
- [x] 26. A bad `MONGODB_URI` takes 30s to fail and exits with a raw driver stack.
- [x] 27. `NodeAPIError` drops the HTTP status, so agent tools can't tell "not found" from "server broke".
- [x] 28. `POST /api/memories` counts the whole collection on every save — the same waste #114 removed from the activity trail.
- [x] 29. `ChartCard` renders an empty axis frame when the agent returns no rows, where the dashboard charts show a message.
- [x] 30. `ActivityFeed`'s relative times never re-render — a feed left open says "just now" indefinitely.
- [x] 31. Unknown `/api/*` paths fall through to Express's HTML 404, which `api()` can't parse as JSON.

## Third pass — 2026-09-17

- [ ] 32. One failed email POST aborts the entire overnight run — the same "don't lose the batch over one bad row" problem fixed for CSV import in #86 and #89.
- [ ] 33. The overnight sign-off scans memories for `"name is"` and takes the last match, so a fact about a *client's* contact signs the owner's reminders.
- [ ] 34. A network blip on the public invoice page renders "This invoice link isn't valid", telling the client their link is dead when it isn't.
- [ ] 35. The public PDF link puts the share PIN in the query string, where it lands in history, access logs and the Referer header.
- [ ] 36. A failed logout leaves the user apparently signed in — the socket stays open and local state is never cleared.
- [ ] 37. Unguarded `localStorage` access in the theme and shell providers throws on load where site data is blocked.
- [ ] 38. The agent's `MongoClient` has no server-selection timeout, so an unreachable Mongo hangs the first chat turn for 30s (the Python side of #124).
- [ ] 39. Invoice table rows open the drawer on click only — no keyboard access, no role, no focus ring.


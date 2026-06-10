# Deploying Penny — the complete runbook

Target: a public URL on Render's free tier, per the brief's preference. ~45–60 minutes the first time, mostly waiting for builds. Everything is driven by [render.yaml](../render.yaml).

## 0. Prerequisites (10 min)

- A GitHub account **owned by the submitter** (commits are authored as `dantanishreya@gmail.com` — add that address to the GitHub account under *Settings → Emails* so commits link to the profile).
- Accounts (all free, no card): [MongoDB Atlas](https://cloud.mongodb.com), [Render](https://render.com), your Gemini key, your Composio key.

## 1. Push the repo (5 min)

```bash
# from the repo root — verify identity & cleanliness first:
git log --format='%an <%ae>' | sort -u        # → only Shreya Dantani
git log -p --all | grep -ciE 'sk-proj-|AIza|AQ\.'   # → 0
git ls-files | grep -E '^\.env$|requirement.txt'    # → nothing

# create a PUBLIC repo on the submitter's GitHub, then:
git remote add origin https://github.com/<account>/penny.git
git push -u origin main
```

## 2. MongoDB Atlas (10 min)

1. Create a project → **Build a Database → M0 (free)** → pick a region near you → create.
2. **Database Access** → add a database user (username + strong password — save them).
3. **Network Access** → *Allow access from anywhere* (0.0.0.0/0) — Render's egress IPs vary on free tier.
4. **Connect → Drivers** → copy the connection string and fill in the password:
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/penny?retryWrites=true&w=majority`
   (the `/penny` path = the app's database name; the agent's checkpoints use `penny_agent` automatically.)

## 3. Render Blueprint (15 min)

1. Render dashboard → **New → Blueprint** → connect GitHub → select the repo. Render reads `render.yaml` and proposes two services: **penny-app** (Node) and **penny-ai** (Python).
2. Fill the env vars it prompts for:
   - `MONGODB_URI` (both services): the Atlas string from step 2
   - `SERVICE_TOKEN` (penny-ai): Render auto-generates penny-app's — after creation, copy that value into penny-ai so they **match exactly**
   - `GOOGLE_API_KEY` (penny-ai): your Gemini key. `PENNY_MODEL` defaults to `gemini-3-flash-preview` in render.yaml — for sustained use set `google_genai:gemini-3.1-flash-lite` (~1,500 free req/day) and switch to the preview model only for demo day (~20/day).
   - `COMPOSIO_API_KEY` + `COMPOSIO_USER_ID` (penny-ai): from your working local setup — copy both values from `.env`.
   - `GOOGLE_CLIENT_ID` (penny-app): optional now, add when OAuth is ready.
3. **Apply.** First build takes ~5 min (Node) and ~5–8 min (Python).
4. **Cross-check the URLs.** Render may suffix service names (e.g. `penny-app-x7k2`). Open each service → *Environment*:
   - penny-app's `AI_URL` must equal penny-ai's actual public URL
   - penny-ai's `NODE_API_URL` must equal penny-app's actual public URL
   Fix and redeploy if they differ from the render.yaml defaults.

## 4. Seed the demo account (5 min)

From your laptop, against prod Atlas (one-off):

```bash
MONGODB_URI='mongodb+srv://…/penny?…' node api/src/seed.js
```

→ creates `demo@penny.app / demo1234` with the story-rich books (Acme the late payer, $12,400 overdue, payment histories for the forecast).

## 5. Smoke-test ON the deployed URL (10 min)

- `https://<penny-app>.onrender.com/api/health` → `{ok:true}` · `https://<penny-ai>.onrender.com/health` → model name
- Landing page loads → **Try the live demo** signs in
- Chat: "Who owes me money?" → activity feed + table (proves app↔ai↔Atlas)
- "Log an invoice for Acme, $500, due next Friday" → live dashboard pop (proves websockets through Render's proxy)
- Run the overnight check → approve a draft → real Gmail send (proves Composio in prod)
- The "What is my name?" David test in one session

## 6. Keep it awake

Free services sleep after 15 idle minutes (~1 min cold start). Add a free [UptimeRobot](https://uptimerobot.com) HTTP monitor on **both** `/api/health` and `/health` URLs at 10-minute intervals during the review window. (Free tier = 750 instance-hrs/month per service — two always-on services fit one month exactly; pause the monitors after the process concludes.)

## 7. Google OAuth (when ready)

[console.cloud.google.com](https://console.cloud.google.com) → APIs & Services:
1. **OAuth consent screen**: External → app name "Penny", support email, save (no extra scopes needed — sign-in uses only openid/email/profile, which skips verification).
2. **Credentials → Create credentials → OAuth client ID → Web application**:
   - *Authorized JavaScript origins*: `http://localhost:5173`, `http://localhost:4001`, and `https://<penny-app>.onrender.com`
   - No redirect URIs needed (the button uses Google Identity Services' ID-token flow).
3. Copy the Client ID → `GOOGLE_CLIENT_ID` in local `.env` + penny-app's Render env → redeploy. The button appears on login/signup automatically.
4. Test in a normal (non-incognito) Chrome profile — FedCM can fail silently in incognito.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Chat says "Penny could not be reached" | `AI_URL` doesn't match penny-ai's real URL, or `SERVICE_TOKEN` values differ |
| Login works but dashboard never updates live | websocket blocked — make sure you're on the penny-app URL itself (no extra proxy) |
| "thinking a little too fast" messages | Gemini free-tier rate limit — wait a few seconds, or switch to flash-lite |
| Emails stay "Saved (not sent)" | `COMPOSIO_API_KEY`/`COMPOSIO_USER_ID` missing in penny-ai's env |
| First request after idle takes ~1 min | free-tier cold start — UptimeRobot, or warm it before demos |

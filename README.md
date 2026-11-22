# Job Hunt Copilot

A personal job-search system with three parts:

| Part | Where it runs | What it does |
|---|---|---|
| **Dashboard** `apps/web` | Vercel + Postgres (Neon) | Jobs inbox ranked by AI fit score, application tracker, 2–3 resumes with per-job "which resume + what to edit" advice, profile and answer bank for autofill, cover letter and outreach writer, a daily Telegram digest |
| **Chrome extension** `apps/extension` | Your browser | One-click autofill on LinkedIn Easy Apply, Greenhouse, Lever, Ashby, Workday (best effort), Google Forms and generic forms. Attaches the recommended resume, drafts answers to custom questions, saves answers to your bank, logs "applied". **You always review and press Submit.** |
| **Telegram worker** `apps/worker` | GitHub Actions (free cron) | Reads your job group(s) as you, sends new posts to the dashboard → AI extracts every job → scores against your resumes → good matches are pushed to you on Telegram |

```
Telegram group ──worker──▶ /api/ingest ──▶ Gemini extract + score ──▶ Postgres ──▶ your Telegram bot
Any job page ──extension──▶ /api/ext/*  ──▶ autofill values / fit score / cover letter
```

---

## 1. Database (Neon, free)

1. Create a project at <https://neon.tech>.
2. Copy the **pooled** connection string → `DATABASE_URL`, and the **direct** (non-pooled) one → `DIRECT_URL`.

## 2. Dashboard — local run

```bash
cd apps/web
cp .env.example .env    # then fill in the values (see below)
npm install
npm run db:push         # creates the tables
npm run dev             # http://localhost:3000
```

Environment variables (`apps/web/.env`, and the same ones in Vercel):

| Var | Value |
|---|---|
| `DATABASE_URL`, `DIRECT_URL` | from Neon |
| `APP_PASSWORD` | your dashboard login password |
| `AUTH_SECRET`, `API_TOKEN`, `CRON_SECRET` | long random strings: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GEMINI_API_KEY` | free key from <https://aistudio.google.com/apikey> (no credit card) |
| `GEMINI_MODEL` | `gemini-flash-lite-latest` (default: fast, highest free limits). `-latest` aliases follow Google's current model, so they don't break when numbered versions are retired |
| `GEMINI_WRITING_MODELS` | optional, comma-separated. Stronger models tried first for form answers, cover letters and outreach (default `gemini-3.8-flash,gemini-3-flash-preview`). If they're busy (common on the free tier) the app falls back to `GEMINI_MODEL` automatically |
| `GEMINI_REASONING_EFFORT` | optional: `none` / `low` makes responses faster |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | your notification bot (step 5) |
| `APP_URL` | your public URL, e.g. `https://jobhunt-yourname.vercel.app` |

## 3. Dashboard — deploy to Vercel

1. Push this repo to a **private** GitHub repository.
2. On <https://vercel.com/new>, import it and set **Root Directory = `apps/web`**.
3. Add all the env vars above, then deploy.
4. The daily digest cron (`vercel.json`, 09:00 IST) is picked up automatically.

Then open the dashboard, go to **Profile & prefs** and fill in everything once, and go to **Resumes** and upload 2–3 PDFs (for example *Frontend*, *Backend*, *Analytics*).

## 4. Chrome extension

1. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `apps/extension`.
2. Pin it and click the icon to open the side panel → **Settings** → enter your dashboard URL and `API_TOKEN` (also shown on the dashboard's **Setup** page).

Using it on an application:

1. Open the job page → **Analyze page** → fit score, the best resume (★), and what to edit if none fit well.
2. Open the application form → **⚡ Autofill** (or press **Alt+Shift+F**).
   - Green outline = from your profile or answer bank. Amber = AI draft; read it before submitting.
   - The recommended resume is attached to the upload field.
   - Consent/terms checkboxes are never ticked for you.
   - Multi-step forms (Workday, LinkedIn Easy Apply): autofill again on each step.
3. Edit anything you want, then **Save answers to bank** so next time it's instant, and click Submit yourself.
4. **Mark applied ✓** → logged in the tracker with a follow-up reminder.

Extras: right-click selected text (for example a LinkedIn "we're hiring" post) → **Send selection to Job Hunt**. The **Write** buttons draft a cover letter, referral ask, recruiter email or follow-up.

## 5. Telegram notifications (your own bot)

1. In Telegram, message **@BotFather** → `/newbot` → copy the token → `TELEGRAM_BOT_TOKEN`.
2. Open your bot and press **Start**.
3. In the dashboard: **Setup → Detect my chat ID** → set `TELEGRAM_CHAT_ID` → redeploy → **Send test message**.

## 6. Telegram group sync (worker)

1. Get an API ID and hash at <https://my.telegram.org> → *API development tools*.
2. Log in once, locally:
   ```bash
   cd apps/worker
   cp .env.example .env     # fill TELEGRAM_API_ID / TELEGRAM_API_HASH, APP_URL, API_TOKEN
   npm install
   npm run login            # phone + code (+ 2FA) → prints TELEGRAM_SESSION
   ```
   Put the printed session string in `.env`. **Treat it like a password**: it is a logged-in session of your account.
3. Choose groups: after the first sync, open the dashboard's **Setup → Telegram groups to read** and tick the groups/channels to scan (search box, "looks job-related" filter). The list refreshes every sync, so groups you join later appear automatically. `TELEGRAM_GROUPS` is optional — it only seeds the initial selection.
4. Test once locally: `npm run sync`. The first run only imports the last 30 posts (`INITIAL_BACKFILL`).
5. Automate it: in your GitHub repo → *Settings → Secrets and variables → Actions*, add `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, `APP_URL` and `API_TOKEN` (plus optional `TELEGRAM_GROUPS`). The workflow `.github/workflows/telegram-sync.yml` runs every 20 minutes (you can also trigger it manually from the Actions tab).

Want it instant instead of every 20 minutes? Run `npm run watch` on any always-on machine (Railway, Fly.io, a Raspberry Pi) instead of GitHub Actions.

---

## Notes and limits

- **Cost**: $0 on the Gemini free tier. Each Telegram post uses about 2 calls (extract, then score per job) and each autofill about 1. The free tier is rate-limited per minute and per day (check your limits in AI Studio); the app retries automatically when it's throttled, so a burst of posts just syncs a bit slower. For better (but slower, lower-limit) answers you can try `GEMINI_MODEL=gemini-flash-latest`.
- **Privacy**: Google may use free-tier API inputs (your profile, resume text, job posts) to improve its products. If that matters to you, enable billing on the Gemini key, which turns that off.
- **Account safety**: autofill runs only when you click, in your own browser, and never submits. That is deliberate: bots that auto-submit on LinkedIn get accounts restricted.
- **Workday and custom dropdowns**: text fields fill reliably. Some custom dropdowns (react-select or Workday pickers) are best effort; anything unfilled is listed under "Needs you" in the side panel.
- **Resumes** must be text-based PDFs (not scans) so the AI can read them.
- The `telegram` (GramJS) package is now archived upstream; if it ever breaks, swap it for its maintained fork `teleproto` (API-compatible).
- Testing autofill without Chrome: `node apps/extension/test/serve.mjs` → <http://localhost:5178/test/form.html>.

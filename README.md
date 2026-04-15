# Quorum — Private Decision Intelligence
### Council MVP

Six AI advisor personas. One decision. Zero bias left unexamined.

---

## Stack

| Layer | Service |
|---|---|
| Frontend + API | Next.js 15 (App Router) |
| AI | Claude claude-sonnet-4-20250514 via Anthropic API |
| Database | Supabase Postgres |
| Auth | Supabase Auth (email magic link) |
| Hosting | Railway |

---

## Local Setup

### 1. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/quorum.git
cd quorum
npm install
```

### 2. Create Supabase project

1. Go to https://supabase.com → New project
2. Note your **Project URL** and **API keys** (Settings → API)
3. Go to **SQL Editor** → paste contents of `supabase/schema.sql` → Run

### 3. Environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in all values:

```
ANTHROPIC_API_KEY=sk-ant-api03-...
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Run locally

```bash
npm run dev
```

Open http://localhost:3000

---

## Deploy to Railway

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial Quorum build"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/quorum.git
git push -u origin main
```

> Make sure `.env.local` is in `.gitignore` (it is). Never commit real keys.

---

### Step 2 — Create Railway project

1. Go to https://railway.app → **New Project**
2. Choose **Deploy from GitHub repo**
3. Select your `quorum` repository
4. Railway auto-detects Next.js via Nixpacks — no config needed

---

### Step 3 — Add environment variables on Railway

In your Railway project → **Variables** tab, add each of the following:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/ → API Keys |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key (secret) |
| `NEXT_PUBLIC_APP_URL` | Your Railway domain, e.g. `https://quorum-production.up.railway.app` |

> **Do NOT add `PORT`** — Railway sets this automatically.

---

### Step 4 — Get your Railway domain

1. Railway project → **Settings** → **Domains**
2. Click **Generate Domain** → copy the URL
3. Update `NEXT_PUBLIC_APP_URL` variable to this URL
4. Redeploy (Railway redeploys automatically on variable changes)

---

### Step 5 — Verify deployment

1. Visit your Railway URL
2. Enter a test decision → click **Convene the Council**
3. All 6 panels should stream responses in parallel
4. Click **Save Decision Record** → verify PDF export works

---

## Supabase Auth Setup (optional for MVP)

The MVP works without auth — sessions are created without a `user_id`.
To add email magic link auth later:

1. Supabase → **Authentication** → **Providers** → enable **Email**
2. Set **Site URL** to your Railway domain
3. Add redirect URL: `https://your-app.railway.app/auth/callback`
4. Implement auth flow using `@supabase/supabase-js` client

---

## Project Structure

```
quorum/
├── app/
│   ├── page.tsx                  Landing — decision input
│   ├── session/[id]/page.tsx     Active session — 6 persona panels
│   ├── record/[id]/page.tsx      Decision Record — full log + PDF export
│   └── api/
│       ├── session/route.ts      Create / fetch sessions
│       ├── persona/route.ts      Streaming Claude API call (core)
│       └── record/route.ts       Save + fetch Decision Records
├── components/
│   ├── PersonaPanel.tsx          Single streaming advisor panel
│   ├── SessionView.tsx           6-panel grid orchestrator
│   └── RecordExport.tsx          jsPDF export
├── lib/
│   ├── personas.ts               All 6 system prompts + PERSONAS map
│   ├── supabase.ts               Supabase client helpers
│   └── types.ts                  TypeScript interfaces
├── supabase/
│   └── schema.sql                Database schema — run in Supabase SQL editor
├── railway.toml                  Railway deployment config
└── .env.example                  Environment variable template
```

---

## Troubleshooting

**Panels show "Connection error"**
→ Check `ANTHROPIC_API_KEY` is set correctly in Railway variables
→ Check the API key has available credits at console.anthropic.com

**"Failed to create session"**
→ Check Supabase URL and service role key
→ Verify you ran `schema.sql` in Supabase SQL editor

**Streaming stops mid-response**
→ Railway free tier has a 60s timeout — upgrade to Hobby plan ($5/mo) for longer timeouts
→ The `X-Accel-Buffering: no` header in the API route handles Nginx buffering

**PDF export blank**
→ jsPDF runs client-side — ensure you are on the `/record/` page, not mid-session

---

## Cost at Scale

| Usage | Monthly cost |
|---|---|
| 0 sessions | $0 |
| 10 sessions/day (~60 API calls/day) | ~$15–25 |
| 50 sessions/day | ~$75–120 |
| Railway hosting | $5/mo (Hobby plan) |
| Supabase | Free tier covers 500MB, 2GB transfer |

---

## The System Prompts Are the Product

The technology is commodity. The six persona system prompts in `lib/personas.ts` are your IP. Every session tests them. When a persona produces a generic response, debug the prompt — not the code.

Keep them private. Improve them continuously.

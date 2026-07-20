# Deploying the Education Center ERP

The app is a standard Next.js 16 app. Production uses **PostgreSQL** (dev uses
SQLite). Recommended host: **Vercel** + a managed Postgres (**Neon** free tier).

The production build is verified: `next build` compiles all routes (dashboard,
calendar, check-in, sessions, billing, payroll, expenses, settings).

---

## Prerequisites (accounts you create)

- A **GitHub** account (for the Vercel-from-Git path), or the **Vercel CLI** for
  a direct deploy.
- A **Vercel** account.
- A **PostgreSQL** database — e.g. Neon (https://neon.tech) or Supabase. Copy its
  connection string, which looks like:
  `postgresql://USER:PASSWORD@HOST/DB?sslmode=require`

---

## Step 1 — Point Prisma at PostgreSQL

In `prisma/schema.prisma`, change the datasource provider:

```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
  url      = env("DATABASE_URL")
}
```

No model changes are needed — the schema is portable (enum-like values are
strings, JSON is stored as text).

## Step 2 — Create the schema + seed on the production DB

Run these **once** from your machine, pointing at the prod database. On Windows
(this project lives under a path containing `&`), call the binaries via `node`
directly rather than `npx`:

```bash
# PowerShell / bash — set the prod URL for these commands only
export DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"

node node_modules/prisma/build/index.js db push      # create tables
node node_modules/tsx/dist/cli.mjs prisma/seed.ts     # grade levels, price matrix, categories, admin user
```

The seed creates the admin login `admin@center.qa` / `admin123` — **change this
password after first login** (Settings → Users), or edit `prisma/seed.ts` first.

Optional — load the center's historical data from the workbook:

```bash
node node_modules/tsx/dist/cli.mjs prisma/import-legacy-xlsx.ts
```

## Step 3 — Generate a session secret

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Use the output as `AUTH_SECRET`.

## Step 4 — Deploy

Vercel runs `npm install` (which triggers `prisma generate` via the `postinstall`
script) and then `next build`. Set two environment variables in Vercel:

| Variable       | Value                                             |
| -------------- | ------------------------------------------------- |
| `DATABASE_URL` | your Postgres connection string                   |
| `AUTH_SECRET`  | the secret from Step 3                             |

### Option A — Vercel CLI (deploy straight from this folder)

```bash
node node_modules/.bin/vercel            # or: npm i -g vercel && vercel
#   → link/create a project, then add the env vars above when prompted
node node_modules/.bin/vercel --prod     # production deploy
```

### Option B — GitHub + Vercel dashboard

```bash
git add -A && git commit -m "Deploy: calendar, check-in, group booking"
git remote add origin https://github.com/<you>/education-center-erp.git
git push -u origin master
```

Then on vercel.com: **New Project → import the repo → add `DATABASE_URL` and
`AUTH_SECRET` → Deploy**. Every push to `master` redeploys.

---

## Notes

- **HTTPS is required** for the home-session **GPS check-in** and the "use current
  location" button — browser geolocation only works on secure origins. Vercel
  serves HTTPS by default, so this works in production (it does not on plain
  `http://localhost` in some browsers).
- Check-in/out timestamps display in **Asia/Qatar** time; session start times are
  stored as UTC wall-clock (see `lib/session-time.ts`).
- To keep dev on SQLite while prod is Postgres, leave your local `.env` as
  `DATABASE_URL="file:./dev.db"` and only set the Postgres URL in Vercel. The
  `provider` line change from Step 1 is the one thing shared across both — Prisma
  reads the provider from the schema, so committing `"postgresql"` means local dev
  also needs Postgres **unless** you keep the provider change on a separate branch
  or switch it back locally. Simplest: use Postgres for both (point local `.env`
  at a separate Neon dev database).

# نظام إدارة المركز التعليمي — Education Center ERP

A fully custom, **bilingual (Arabic-first RTL / English LTR)** ERP for a private
tutoring / education center. Built from the center's real Excel workbook, it
replaces the spreadsheet with sessions, billing, student balances, teacher
payroll, expenses, and financial dashboards.

> Login (seed): **admin@center.qa** / **admin123**

## Features

- **Sessions (الحصص)** — daily tutoring sessions with **automatic pricing** from a
  grade-level × location matrix (e.g. Secondary/Center = 175, Secondary/Home = 200),
  calendar-style list, filters (date/teacher/status), and CSV export.
- **Billing (المدفوعات)** — payments/receipts (Cash / POS / Qpay / Transfer),
  auto receipt numbers, printable bilingual receipts, prepaid **packages (الباقات)**,
  and per-student **ledgers** with running balance.
- **Teachers & Payroll (الرواتب)** — commission %, auto-computed expected vs.
  collected income, advances, payout runs, and printable payslips.
- **Expenses & Dashboard** — categorized expenses (12 editable categories),
  income/expense/net KPIs, revenue-by-teacher, expenses-by-category, and a
  monthly-trend chart.
- **Settings** — editable price matrix, expense categories, and center profile.
- **Security** — role-based access (Admin / Accountant / Receptionist / Teacher /
  Parent), session auth, immutable audit log on financial records, soft deletes.
- **Bilingual** — Arabic default (RTL) + English (LTR), switchable live.

## Tech stack

Next.js 16 (App Router) · TypeScript · Prisma · SQLite (dev) / PostgreSQL (prod) ·
Tailwind CSS v4 · next-intl · Recharts · custom JWT auth (jose + bcrypt) · Zod.

## Getting started

```bash
npm install
cp .env.example .env            # then edit AUTH_SECRET

# create the local SQLite DB and generate the client
node node_modules/prisma/build/index.js db push
node --import tsx prisma/seed.ts   # reference data + admin + demo rows

# run
node node_modules/next/dist/bin/next dev   # http://localhost:3000
```

> **Windows note:** this project lives in a path containing `&` ("Code & Projects"),
> which breaks the `npx`/`.bin` shims. Invoke binaries directly via
> `node node_modules/<pkg>/…` as shown above (the npm scripts assume a normal path).

## Importing the real workbook

```bash
node --import tsx prisma/import-legacy-xlsx.ts
```

Wipes transactional tables and loads **sessions, payments, and expenses** from
`مراكز تعليمية.xlsx` (auto-found in Downloads, or set `WORKBOOK`). It prints a
reconciliation report — the imported expense total matches the workbook's
`اجماليات` sheet exactly (11,052).

## Deploying to production (PostgreSQL + Vercel)

See **[DEPLOY.md](DEPLOY.md)** for the full copy-paste guide. In short:

1. In `prisma/schema.prisma`, set `datasource.provider = "postgresql"`.
2. Provision Postgres (Neon or Supabase) and set `DATABASE_URL` + `AUTH_SECRET`
   in your host's env.
3. `prisma db push` against the Postgres URL, then run the seed.
4. Deploy on Vercel (CLI or GitHub import). The schema is portable — no model
   changes needed when switching providers. Note: the home-session **GPS check-in**
   needs HTTPS, which Vercel provides by default.

## Project structure

```
app/[locale]/(auth)/login      Login
app/[locale]/(app)/…           Dashboard, sessions, students, teachers,
                               guardians, payments, packages, expenses,
                               payroll, settings  (auth-guarded shell)
app/[locale]/receipt/[id]      Printable payment receipt
app/[locale]/payslip/[id]      Printable payslip
app/api/export/sessions        CSV export (UTF-8 BOM)
lib/                           db, session, rbac, pricing, money, balances,
                               payroll, reports, audit
components/                    ui/ (shadcn-style), crud/ (reusable dialogs),
                               charts/, app-shell/
prisma/                        schema.prisma, seed.ts, import-legacy-xlsx.ts
messages/{ar,en}.json          i18n catalogs
```

## Tests

```bash
node --import tsx node_modules/vitest/vitest.mjs run
```

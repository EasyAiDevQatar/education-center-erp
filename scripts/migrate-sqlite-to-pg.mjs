/**
 * One-off data migration: SQLite (prod.db) → PostgreSQL.
 *
 * Run ON THE SERVER, after `prisma/schema.prisma` has provider "postgresql",
 * `DATABASE_URL` points at Postgres, and the schema was pushed:
 *
 *   npm install --no-save better-sqlite3
 *   SQLITE_PATH=/var/www/education-center/prisma/prod.db node scripts/migrate-sqlite-to-pg.mjs
 *
 * Reads raw rows via better-sqlite3 and converts using the Prisma client's own
 * DMMF: SQLite stores DateTime as ms-since-epoch integers and Boolean as 0/1.
 * Idempotent: `createMany({ skipDuplicates: true })` — safe to re-run.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const Database = require("better-sqlite3");
const { PrismaClient, Prisma } = require("@prisma/client");

const SQLITE_PATH = process.env.SQLITE_PATH ?? "./prisma/prod.db";

/** FK-safe insertion order (parents before children). */
const ORDER = [
  "Teacher",
  "Guardian",
  "GradeLevel",
  "PriceRule",
  "Student",
  "User",
  "Term",
  "Package",
  "Session",
  "Payment",
  "ExpenseCategory",
  "Expense",
  "TeacherPayout",
  "Integration",
  "NotificationLog",
  "AuditLog",
  "Setting",
  "LoginAttempt",
];

const db = new PrismaClient();
const lite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });

const models = Prisma.dmmf.datamodel.models;

function converterFor(modelName) {
  const model = models.find((m) => m.name === modelName);
  if (!model) throw new Error(`Model ${modelName} not in DMMF`);
  const dateFields = new Set();
  const boolFields = new Set();
  for (const f of model.fields) {
    if (f.kind !== "scalar") continue;
    if (f.type === "DateTime") dateFields.add(f.name);
    if (f.type === "Boolean") boolFields.add(f.name);
  }
  return (row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) {
        out[k] = null;
      } else if (dateFields.has(k)) {
        // SQLite stores DateTime as ms since epoch (integer).
        out[k] = new Date(typeof v === "number" ? v : Number(v));
      } else if (boolFields.has(k)) {
        out[k] = v === 1 || v === true || v === "1";
      } else {
        out[k] = v;
      }
    }
    return out;
  };
}

const CHUNK = 500;

async function migrate() {
  console.log(`Source: ${SQLITE_PATH}`);
  let grandTotal = 0;

  for (const name of ORDER) {
    let rows;
    try {
      rows = lite.prepare(`SELECT * FROM "${name}"`).all();
    } catch {
      console.log(`  ${name}: table missing in source — skipped`);
      continue;
    }
    const convert = converterFor(name);
    const data = rows.map(convert);
    const client = db[name.charAt(0).toLowerCase() + name.slice(1)];

    let inserted = 0;
    for (let i = 0; i < data.length; i += CHUNK) {
      const res = await client.createMany({
        data: data.slice(i, i + CHUNK),
        skipDuplicates: true,
      });
      inserted += res.count;
    }
    const pgCount = await client.count();
    grandTotal += inserted;
    console.log(
      `  ${name}: source=${rows.length} inserted=${inserted} pgTotal=${pgCount}` +
        (pgCount !== rows.length ? "  ← MISMATCH, investigate" : ""),
    );
  }

  // Money reconciliation (mirrors the dashboard's اجماليات).
  const [sqlitePay] = lite.prepare(`SELECT SUM(amount) s FROM "Payment"`).all();
  const [sqliteExp] = lite.prepare(`SELECT SUM(amount) s FROM "Expense"`).all();
  const [sqliteSess] = lite
    .prepare(`SELECT SUM(total) s FROM "Session" WHERE status != 'DRAFT'`)
    .all();
  const pgPay = await db.payment.aggregate({ _sum: { amount: true } });
  const pgExp = await db.expense.aggregate({ _sum: { amount: true } });
  const pgSess = await db.session.aggregate({
    _sum: { total: true },
    where: { status: { not: "DRAFT" } },
  });

  console.log("\nReconciliation (sqlite → postgres):");
  console.log(`  payments : ${sqlitePay.s} → ${pgPay._sum.amount}`);
  console.log(`  expenses : ${sqliteExp.s} → ${pgExp._sum.amount}`);
  console.log(`  sessions : ${sqliteSess.s} → ${pgSess._sum.total}`);
  console.log(`\nInserted ${grandTotal} rows total.`);
}

migrate()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    lite.close();
    await db.$disconnect();
  });

/**
 * Swap the Prisma datasource provider between "postgresql" (canonical, prod)
 * and "sqlite" (zero-setup local dev), then regenerate the client.
 *
 *   npm run db:use-sqlite    → provider sqlite  + DATABASE_URL=file:./dev.db expected
 *   npm run db:use-postgres  → provider postgresql (restore before committing!)
 *
 * The committed schema must always say "postgresql" — the provider line is the
 * only thing this script touches, so `git diff prisma/schema.prisma` makes any
 * forgotten swap obvious.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const target = process.argv[2];
if (!["sqlite", "postgresql"].includes(target)) {
  console.error("usage: node scripts/set-db-provider.mjs <sqlite|postgresql>");
  process.exit(1);
}

const path = "prisma/schema.prisma";
const src = readFileSync(path, "utf8");
const out = src.replace(
  /provider = "(sqlite|postgresql)"\s*\n(\s*)url\s*=\s*env\("DATABASE_URL"\)/,
  `provider = "${target}"\n$2url      = env("DATABASE_URL")`,
);
if (out === src && !src.includes(`provider = "${target}"`)) {
  console.error("datasource block not found — schema layout changed?");
  process.exit(1);
}
writeFileSync(path, out);
console.log(`provider → ${target}`);
execSync("node node_modules/prisma/build/index.js generate", { stdio: "inherit" });

#!/usr/bin/env node
/**
 * Upload one backup file to Google Drive using the service account stored in
 * the Setting table (keys: backupDriveSa, backupDriveFolder).
 *
 * Called by the nightly cron AFTER pg_dump:
 *   node scripts/drive-upload.mjs /var/backups/education/edu_erp-….sql.gz
 *
 * Deliberately self-contained (cron cannot import the app's TypeScript), and
 * silent-exit-0 when Drive is not configured — an unconfigured integration
 * must never fail the backup job it rides on.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createSign } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const file = process.argv[2];
if (!file) {
  console.error("usage: drive-upload.mjs <file>");
  process.exit(2);
}

const db = new PrismaClient();

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(sa.private_key));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

try {
  const rows = await db.setting.findMany({
    where: { key: { in: ["backupDriveSa", "backupDriveFolder"] } },
  });
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (!s.backupDriveSa || !s.backupDriveFolder) {
    console.log("drive-upload: not configured, skipping");
    process.exit(0);
  }
  const sa = JSON.parse(s.backupDriveSa);

  const content = await readFile(file);
  const token = await accessToken(sa);
  const boundary = "edu-erp-" + Date.now().toString(36);
  const meta = JSON.stringify({ name: basename(file), parents: [s.backupDriveFolder] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) throw new Error(`upload ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  console.log(`drive-upload: ok ${basename(file)} -> ${out.id}`);
} catch (err) {
  // Non-zero so the cron log shows the failure — but the dump itself already
  // succeeded before we were called, so local backups are unaffected.
  console.error("drive-upload: failed:", err.message ?? err);
  process.exit(1);
} finally {
  await db.$disconnect();
}

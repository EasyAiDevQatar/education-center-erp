"use server";

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { parseServiceAccount, driveUpload } from "@/lib/drive";
import { BACKUP_DIR, PRERESTORE_KEEP, backupPath } from "@/lib/backups";
import { RESTORE_PHRASE } from "@/lib/data-zone";

export type BackupState = { ok?: boolean; error?: string; detail?: string };

async function guard() {
  const s = await getSession();
  return !s || s.role !== "ADMIN";
}

/**
 * Save the Drive configuration. The JSON is shape-checked (client_email +
 * private key) before it is stored; a typo'd paste failing at 03:00 in a cron
 * log helps nobody.
 */
export async function saveBackupDrive(
  locale: string,
  _prev: BackupState,
  formData: FormData,
): Promise<BackupState> {
  if (await guard()) return { error: "forbidden" };

  const folder = (formData.get("backupDriveFolder") ?? "").toString().trim();
  const saJson = (formData.get("backupDriveSa") ?? "").toString().trim();

  // Both empty = deliberately disabling the integration.
  if (!folder && !saJson) {
    await db.setting.deleteMany({ where: { key: { in: ["backupDriveSa", "backupDriveFolder"] } } });
    await writeAudit("Setting", "backupDrive", "DELETE");
    revalidatePath(`/${locale}/settings`);
    return { ok: true };
  }

  if (!/^[A-Za-z0-9_-]{10,80}$/.test(folder)) return { error: "invalid_folder" };

  // An empty key box with a key already stored means "keep the current key" —
  // the stored key is never echoed into the page, so this is the only way a
  // folder-only edit can work.
  if (saJson === "") {
    const existing = await db.setting.findUnique({ where: { key: "backupDriveSa" } });
    if (!existing?.value) return { error: "invalid_sa" };
  } else if (!parseServiceAccount(saJson)) {
    return { error: "invalid_sa" };
  }

  const writes: [string, string][] = [["backupDriveFolder", folder]];
  if (saJson !== "") writes.push(["backupDriveSa", saJson]);
  for (const [key, value] of writes) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  // The audit records THAT it changed, never the key material itself.
  await writeAudit("Setting", "backupDrive", "UPDATE", { after: { folder } });
  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}

/**
 * Prove the configuration end to end by uploading a small test file. This is
 * the same code path the nightly upload uses, so a green check here means the
 * 03:00 run will work.
 */
export async function testBackupDrive(locale: string): Promise<BackupState> {
  if (await guard()) return { error: "forbidden" };
  void locale;

  const rows = await db.setting.findMany({
    where: { key: { in: ["backupDriveSa", "backupDriveFolder"] } },
  });
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (!s.backupDriveSa || !s.backupDriveFolder) return { error: "notConfigured" };
  const sa = parseServiceAccount(s.backupDriveSa);
  if (!sa) return { error: "invalid_sa" };

  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const id = await driveUpload(
      sa,
      s.backupDriveFolder,
      `edu-erp-test-${stamp}.txt`,
      Buffer.from("Education Center ERP backup test — safe to delete.\n"),
      "text/plain",
    );
    return { ok: true, detail: id };
  } catch (err) {
    return { error: "driveFailed", detail: (err as Error).message?.slice(0, 300) };
  }
}


/* ---------------------------------------------------------------- restore ---
 *
 * Restoring is the other half of backing up, and until now the app only did
 * the first half: it wrote dumps every night and offered them for download,
 * which means the recovery plan was "copy the file off the server and find
 * somebody who knows psql". This is that person.
 *
 * The order below is the whole safety argument:
 *   1. refuse a file that will not decompress — a broken archive must not be
 *      allowed to destroy a working database;
 *   2. dump the present first, so the state being replaced is itself
 *      recoverable if the restore turns out to be the wrong choice;
 *   3. drop and reload inside ONE transaction with ON_ERROR_STOP, so a
 *      restore either lands completely or leaves the database untouched.
 *      There is no half-restored outcome.
 */

type Conn = { host: string; port: string; user: string; db: string; password: string };

/** psql and pg_dump want flags, Prisma wants a URL. This bridges them. */
function connFromEnv(): Conn | null {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return {
      host: u.hostname || "127.0.0.1",
      port: u.port || "5432",
      user: decodeURIComponent(u.username),
      db: decodeURIComponent(u.pathname.replace(/^\//, "")),
      password: decodeURIComponent(u.password),
    };
  } catch {
    return null;
  }
}

const why = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 400);

/** Read the whole archive through gunzip and throw it away — a decompression
 *  dry run. Cheap on a 100 KB dump, and it is the difference between "this
 *  restore will fail" and "this restore will fail after wiping the data". */
async function verifyGzip(file: string): Promise<void> {
  await pipeline(
    createReadStream(file),
    createGunzip(),
    new Writable({ write(_chunk, _enc, cb) { cb(); } }),
  );
}

async function dumpTo(file: string, c: Conn): Promise<void> {
  const pg = spawn("pg_dump", ["-h", c.host, "-p", c.port, "-U", c.user, c.db], {
    env: { ...process.env, PGPASSWORD: c.password },
  });
  let stderr = "";
  pg.stderr.on("data", (d) => { stderr += String(d); });
  // Subscribe before awaiting anything. A short dump can finish and emit
  // "close" while the pipeline is still settling, and a listener attached
  // afterwards waits for an event that has already happened — forever.
  const done = new Promise<number>((res) => pg.on("close", (x) => res(x ?? 1)));
  await pipeline(pg.stdout, createGzip(), createWriteStream(file));
  const code = await done;
  if (code !== 0) throw new Error(stderr.trim() || `pg_dump exited ${code}`);
}

async function restoreFrom(file: string, c: Conn): Promise<void> {
  const psql = spawn(
    "psql",
    [
      "-h", c.host, "-p", c.port, "-U", c.user, "-d", c.db,
      // Both flags matter: ON_ERROR_STOP turns the first error into a failure
      // instead of ploughing on, and --single-transaction makes that failure
      // a rollback of everything, including the schema drop below.
      "-v", "ON_ERROR_STOP=1",
      "--single-transaction",
      "-f", "-",
    ],
    { env: { ...process.env, PGPASSWORD: c.password } },
  );
  let stderr = "";
  psql.stderr.on("data", (d) => { stderr += String(d); });
  // Subscribed before the write below, for the same reason as in dumpTo: psql
  // can be gone before we would otherwise start listening.
  const done = new Promise<number>((res) => psql.on("close", (x) => res(x ?? 1)));
  // When psql rejects the very first statement it exits and closes stdin, and
  // the write side then raises EPIPE. Reporting that would replace postgres'
  // actual reason with a socket error, so the pipe failure is remembered and
  // only used if psql itself had nothing to say.
  psql.stdin.on("error", () => {});

  // pg_dump runs without --clean, so its CREATEs collide with the objects
  // already there. Clearing them in the same transaction is what makes the
  // reload possible without making the wipe permanent on failure.
  //
  // DROP OWNED BY rather than DROP SCHEMA: the schema is only ours to drop
  // when this role happens to own it. Restoring a dump as a different role —
  // exactly what someone doing a manual recovery does — leaves `public` owned
  // by that role, and this button would then fail forever with "must be owner
  // of schema public". Dropping what we own needs no such luck.
  psql.stdin.write("DROP OWNED BY CURRENT_USER;\nCREATE SCHEMA IF NOT EXISTS public;\n");

  let pipeFailed: unknown = null;
  try {
    await pipeline(createReadStream(file), createGunzip(), psql.stdin);
  } catch (e) {
    pipeFailed = e;
  }
  const code = await done;
  // psql is verbose about NOTICEs; the tail is where the actual error lives.
  if (code !== 0) throw new Error(stderr.trim().slice(-400) || `psql exited ${code}`);
  if (pipeFailed) throw pipeFailed;
}

/** Keep the last PRERESTORE_KEEP safety copies; the nightly script prunes
 *  only the tiers it makes, so this tier has to prune itself. */
async function prunePrerestore(): Promise<void> {
  const names = (await readdir(BACKUP_DIR)).filter((n) => n.startsWith("prerestore-"));
  names.sort().reverse();
  for (const old of names.slice(PRERESTORE_KEEP)) {
    await unlink(path.join(BACKUP_DIR, old)).catch(() => {});
  }
}

/** One restore at a time, per process. Two concurrent drops of the same
 *  schema is not a situation worth reasoning about. */
let restoring = false;

export async function restoreBackup(
  locale: string,
  name: string,
  confirm: string,
): Promise<BackupState> {
  if (await guard()) return { error: "forbidden" };
  if (confirm.trim() !== RESTORE_PHRASE) return { error: "confirmMismatch" };

  const file = backupPath(name);
  if (!file) return { error: "notFound" };
  try {
    const s = await stat(file);
    if (!s.isFile() || s.size === 0) return { error: "notFound" };
  } catch {
    return { error: "notFound" };
  }

  const conn = connFromEnv();
  if (!conn) return { error: "noDatabaseUrl" };
  if (restoring) return { error: "restoreBusy" };
  restoring = true;

  try {
    try {
      await verifyGzip(file);
    } catch (e) {
      return { error: "corruptArchive", detail: why(e) };
    }

    // The present, saved before it is replaced. A failure here stops the
    // restore: without this file the operation is irreversible, and an
    // irreversible restore is not one worth offering behind a button.
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const safety = path.join(BACKUP_DIR, `prerestore-${stamp}.sql.gz`);
    try {
      await dumpTo(safety, conn);
    } catch (e) {
      await unlink(safety).catch(() => {});
      return { error: "safetyFailed", detail: why(e) };
    }

    try {
      await restoreFrom(file, conn);
    } catch (e) {
      // The transaction rolled back; the database is as it was.
      return { error: "restoreFailed", detail: why(e) };
    }

    await prunePrerestore().catch(() => {});

    // Counted from the restored database, so the numbers are evidence the
    // reload actually landed rather than a hopeful message.
    const [students, sessions, payments] = await Promise.all([
      db.student.count(),
      db.session.count(),
      db.payment.count(),
    ]);

    // Written after the restore, so it lands in the restored database and sits
    // at the top of its audit log — the record that this history was replaced.
    // A missing user row must not turn a successful restore into an error.
    await writeAudit("Backup", name, "UPDATE", {
      after: { restoredFrom: name, safetyCopy: path.basename(safety) },
    }).catch(() => {});

    revalidatePath(`/${locale}/settings`);
    return {
      ok: true,
      detail: JSON.stringify({ students, sessions, payments, safety: path.basename(safety) }),
    };
  } finally {
    restoring = false;
  }
}

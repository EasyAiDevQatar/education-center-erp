"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { parseServiceAccount, driveUpload } from "@/lib/drive";

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

import "server-only";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Reads the backup directory the nightly cron writes into. The app and the
 * cron run on the same box, so listing the directory is the source of truth —
 * no table to drift out of sync with the filesystem.
 */
export const BACKUP_DIR = process.env.BACKUP_DIR || "/var/backups/education";

/** daily = edu_erp-*, weekly-/monthly- = tier promotions, predeploy- = manual. */
export type BackupTier = "daily" | "weekly" | "monthly" | "predeploy" | "other";

export type BackupFile = {
  name: string;
  tier: BackupTier;
  sizeBytes: number;
  modifiedAt: string; // ISO
};

/** Strict allow-list — these names go into download URLs. */
export const BACKUP_NAME_RE = /^[A-Za-z0-9_.-]+\.sql\.gz$/;

export function tierOf(name: string): BackupTier {
  if (name.startsWith("edu_erp-")) return "daily";
  if (name.startsWith("weekly-")) return "weekly";
  if (name.startsWith("monthly-")) return "monthly";
  if (name.startsWith("predeploy-")) return "predeploy";
  return "other";
}

export async function listBackups(): Promise<BackupFile[]> {
  let names: string[];
  try {
    names = await readdir(BACKUP_DIR);
  } catch {
    // Directory missing (dev machine) — an empty list, not an error page.
    return [];
  }
  const out: BackupFile[] = [];
  for (const name of names) {
    if (!BACKUP_NAME_RE.test(name)) continue;
    try {
      const s = await stat(path.join(BACKUP_DIR, name));
      if (!s.isFile()) continue;
      out.push({
        name,
        tier: tierOf(name),
        sizeBytes: s.size,
        modifiedAt: s.mtime.toISOString(),
      });
    } catch {
      // Raced with rotation — skip.
    }
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/** Absolute path for a validated backup name; null when the name is not ours. */
export function backupPath(name: string): string | null {
  if (!BACKUP_NAME_RE.test(name)) return null;
  // The regex forbids path separators, so join cannot escape the directory.
  return path.join(BACKUP_DIR, name);
}

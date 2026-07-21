"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { isEarningsMode } from "@/lib/earnings-mode";

export type EarningsState = { ok?: boolean; error?: string; count?: number };

async function guard() {
  const s = await getSession();
  // Pay structure is an owner-level decision, not a reception one.
  return !s || s.role !== "ADMIN";
}

/** The centre-wide default every teacher without an explicit mode follows. */
export async function saveDefaultEarningsMode(
  locale: string,
  mode: string,
): Promise<EarningsState> {
  if (await guard()) return { error: "forbidden" };
  if (!isEarningsMode(mode)) return { error: "invalid" };

  await db.setting.upsert({
    where: { key: "teacherEarningsMode" },
    create: { key: "teacherEarningsMode", value: mode },
    update: { value: mode },
  });
  await writeAudit("Setting", "teacherEarningsMode", "UPDATE", { after: { value: mode } });
  revalidatePath(`/${locale}/settings`);
  revalidatePath(`/${locale}/payroll`);
  return { ok: true };
}

/**
 * Set one earnings mode on every active teacher.
 *
 * `inherit` clears the per-teacher override instead of writing a value, so the
 * centre default becomes live again for everyone — the only way back once
 * individual teachers have been set.
 */
export async function applyEarningsModeToAll(
  locale: string,
  mode: string,
): Promise<EarningsState> {
  if (await guard()) return { error: "forbidden" };
  if (mode !== "inherit" && !isEarningsMode(mode)) return { error: "invalid" };
  const value = mode === "inherit" ? null : mode;

  const res = await db.teacher.updateMany({
    where: { active: true },
    data: { earningsMode: value },
  });
  await writeAudit("Teacher", "bulk", "UPDATE", {
    after: { earningsMode: value, count: res.count },
  });
  revalidatePath(`/${locale}/settings`);
  revalidatePath(`/${locale}/teachers`);
  revalidatePath(`/${locale}/payroll`);
  return { ok: true, count: res.count };
}

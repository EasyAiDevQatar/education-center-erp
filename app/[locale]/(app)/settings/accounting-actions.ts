"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { ensureChartOfAccounts } from "@/lib/accounting/journal-data";

export type AccountingSettingsState = { ok?: boolean; error?: string };

/**
 * Toggle the optional accounting module. Turning it ON seeds (or repairs) the
 * default chart of accounts — idempotent, and it never overwrites names the
 * accountant has edited. Turning it OFF hides the module and pauses
 * auto-posting; nothing is deleted, so the books resume where they stopped.
 */
export async function saveAccountingSettings(
  locale: string,
  _prev: AccountingSettingsState,
  formData: FormData,
): Promise<AccountingSettingsState> {
  const s = await getSession();
  if (!s || s.role !== "ADMIN") return { error: "forbidden" };

  const enabled = formData.get("accountingEnabled") === "on" ? "1" : "0";
  await db.setting.upsert({
    where: { key: "accountingEnabled" },
    create: { key: "accountingEnabled", value: enabled },
    update: { value: enabled },
  });
  if (enabled === "1") await ensureChartOfAccounts();

  await writeAudit("Setting", "accounting", "UPDATE", { after: { enabled } });
  // Layout-wide: the sidebar item appears/disappears with the flag.
  revalidatePath(`/${locale}`, "layout");
  return { ok: true };
}

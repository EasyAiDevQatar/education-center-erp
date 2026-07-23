"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import {
  accountingEnabled,
  backfillJournal,
  ensureChartOfAccounts,
} from "@/lib/accounting/journal-data";

export type AccountingSettingsState = {
  ok?: boolean;
  error?: string;
  summary?: Record<string, number>;
};

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

  // Cheque module knobs — written only when the form carried them (the
  // fields render only while the module is enabled).
  const num = (name: string, fallback: string) => {
    const v = (formData.get(name) ?? "").toString().trim();
    return /^\d+(\.\d+)?$/.test(v) ? v : fallback;
  };
  if (formData.has("chequeConfReceived")) {
    const writes: [string, string][] = [
      ["chequeConfReceived", num("chequeConfReceived", "70")],
      ["chequeConfPending", num("chequeConfPending", "80")],
      ["chequeConfDeposited", num("chequeConfDeposited", "95")],
      ["chequeAlertDays", num("chequeAlertDays", "7")],
      [
        "chequeTemplate",
        JSON.stringify({
          leafW: Number(num("tplLeafW", "176")),
          leafH: Number(num("tplLeafH", "89")),
          date: { x: Number(num("tplDateX", "130")), y: Number(num("tplDateY", "10")) },
          payee: { x: Number(num("tplPayeeX", "25")), y: Number(num("tplPayeeY", "28")) },
          amountWords: {
            x: Number(num("tplWordsX", "30")),
            y: Number(num("tplWordsY", "42")),
            w: Number(num("tplWordsW", "120")),
          },
          amountDigits: { x: Number(num("tplDigitsX", "135")), y: Number(num("tplDigitsY", "42")) },
        }),
      ],
    ];
    for (const [key, value] of writes) {
      await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
  }

  await writeAudit("Setting", "accounting", "UPDATE", { after: { enabled } });
  // Layout-wide: the sidebar item appears/disappears with the flag.
  revalidatePath(`/${locale}`, "layout");
  return { ok: true };
}

/**
 * Post historical payments/expenses/paid-payslips from the given date into
 * the journal. Idempotent — the [sourceType, sourceId] unique turns anything
 * already posted into a skip, so re-running heals gaps instead of duplicating.
 */
export async function runBackfill(
  locale: string,
  fromDateStr: string,
): Promise<AccountingSettingsState> {
  const s = await getSession();
  if (!s || s.role !== "ADMIN") return { error: "forbidden" };
  if (!(await accountingEnabled())) return { error: "notEnabled" };
  const fromDate = new Date(`${fromDateStr}T00:00:00.000Z`);
  if (Number.isNaN(fromDate.getTime())) return { error: "invalid" };

  const summary = await backfillJournal(fromDate);
  await writeAudit("System", "journal-backfill", "CREATE", { after: summary });
  revalidatePath(`/${locale}/accounting/journal`);
  return { ok: true, summary };
}

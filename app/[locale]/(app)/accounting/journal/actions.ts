"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FINANCE_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { guardArchived } from "@/lib/academic-year";
import { accountingEnabled } from "@/lib/accounting/journal-data";
import { isBalanced } from "@/lib/accounting/posting";

export type JournalState = { ok?: boolean; error?: string };

const lineSchema = z.object({
  accountId: z.string().min(1),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  memo: z.string().trim().optional().nullable(),
});

const entrySchema = z.object({
  date: z.string().min(1),
  memo: z.string().trim().min(1),
  lines: z.array(lineSchema).min(2),
});

async function guard() {
  const s = await getSession();
  if (!s || !FINANCE_ROLES.includes(s.role)) return true;
  return !(await accountingEnabled());
}

/** Record a manual journal entry. The lines arrive as a JSON payload from the
 *  multi-line editor; balance is re-checked here — never trusted from a form. */
export async function createManualEntry(
  locale: string,
  input: unknown,
): Promise<JournalState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const lines = d.lines.filter((l) => l.debit > 0 || l.credit > 0);
  if (lines.length < 2) return { error: "invalid" };
  if (
    !isBalanced(
      lines.map((l) => ({ accountCode: l.accountId, debit: l.debit, credit: l.credit })),
    )
  ) {
    return { error: "unbalanced" };
  }

  const date = new Date(`${d.date}T00:00:00.000Z`);
  const frozen = await guardArchived(date);
  if (frozen) return { error: frozen };

  // Validate the accounts exist and are active in one query.
  const ids = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await db.account.findMany({ where: { id: { in: ids } } });
  if (accounts.length !== ids.length) return { error: "invalid" };

  const created = await db.journalEntry.create({
    data: {
      date,
      memo: d.memo,
      sourceType: "MANUAL",
      sourceId: null,
      createdById: (await getSession())?.userId ?? null,
      lines: {
        create: lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          memo: l.memo || null,
        })),
      },
    },
  });
  await writeAudit("JournalEntry", created.id, "CREATE", {
    after: { memo: d.memo, lines: lines.length },
  });
  revalidatePath(`/${locale}/accounting/journal`);
  return { ok: true };
}

/**
 * Only MANUAL entries can be deleted here — auto-posted entries live and die
 * with their source documents, and deleting one by hand would desync the GL.
 */
export async function deleteManualEntry(locale: string, id: string): Promise<JournalState> {
  if (await guard()) return { error: "forbidden" };
  const entry = await db.journalEntry.findUnique({ where: { id } });
  if (!entry) return { error: "notfound" };
  if (entry.sourceType !== "MANUAL") return { error: "notManual" };
  const frozen = await guardArchived(entry.date);
  if (frozen) return { error: frozen };
  await db.journalEntry.delete({ where: { id } });
  await writeAudit("JournalEntry", id, "DELETE");
  revalidatePath(`/${locale}/accounting/journal`);
  return { ok: true };
}

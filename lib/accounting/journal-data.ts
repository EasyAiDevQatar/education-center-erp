import "server-only";
import { db } from "@/lib/db";
import { DEFAULT_ACCOUNTS } from "./coa";
import { isBalanced, type DraftEntry } from "./posting";

/**
 * The module's on switch. Read per request — never cached at module level, so
 * flipping the setting takes effect immediately.
 */
export async function accountingEnabled(): Promise<boolean> {
  const row = await db.setting.findUnique({ where: { key: "accountingEnabled" } });
  return row?.value === "1";
}

/**
 * Seed/repair the default chart of accounts. Upsert by code and never touch
 * the names of an existing row — the accountant may have renamed accounts,
 * and re-enabling the module must not undo that.
 */
export async function ensureChartOfAccounts(): Promise<void> {
  const byCode = new Map<string, string>();
  for (const a of DEFAULT_ACCOUNTS) {
    const row = await db.account.upsert({
      where: { code: a.code },
      update: { system: true },
      create: {
        code: a.code,
        nameAr: a.nameAr,
        nameEn: a.nameEn,
        type: a.type,
        system: true,
      },
    });
    byCode.set(a.code, row.id);
  }
  // Parents in a second pass so order in DEFAULT_ACCOUNTS never matters.
  for (const a of DEFAULT_ACCOUNTS) {
    if (!a.parentCode) continue;
    const parentId = byCode.get(a.parentCode);
    if (parentId) {
      await db.account.update({ where: { code: a.code }, data: { parentId } });
    }
  }
}

/** Prisma transaction client — structural, so both db and $transaction work. */
type Tx = Pick<typeof db, "journalEntry" | "account">;

async function accountIdsFor(tx: Tx, draft: DraftEntry): Promise<Map<string, string> | null> {
  const codes = [...new Set(draft.lines.map((l) => l.accountCode))];
  const accounts = await tx.account.findMany({ where: { code: { in: codes } } });
  if (accounts.length !== codes.length) return null;
  return new Map(accounts.map((a) => [a.code, a.id]));
}

/**
 * Write one journal entry. Idempotent on `[sourceType, sourceId]`: a re-run
 * (double click, replayed action) is silently skipped, the same convention the
 * payroll unique follows. Refuses unbalanced drafts outright — the builders
 * are tested, but this is the last line between a bug and crooked books.
 */
export async function postSource(tx: Tx, draft: DraftEntry): Promise<void> {
  if (!isBalanced(draft.lines)) {
    throw new Error(`unbalanced journal draft: ${draft.sourceType}/${draft.sourceId}`);
  }
  const ids = await accountIdsFor(tx, draft);
  if (!ids) throw new Error("journal draft references unknown account code");
  try {
    await tx.journalEntry.create({
      data: {
        date: draft.date,
        memo: draft.memo,
        sourceType: draft.sourceType,
        sourceId: draft.sourceId,
        lines: {
          create: draft.lines.map((l) => ({
            accountId: ids.get(l.accountCode)!,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo ?? null,
          })),
        },
      },
    });
  } catch (err) {
    // P2002 on [sourceType, sourceId] = already posted. Skip, by design.
    if ((err as { code?: string }).code !== "P2002") throw err;
  }
}

/** Replace the entry for an edited source document (delete + recreate, one tx). */
export async function repostSource(tx: Tx, draft: DraftEntry): Promise<void> {
  if (draft.sourceId == null) throw new Error("repost needs a sourceId");
  await tx.journalEntry.deleteMany({
    where: { sourceType: draft.sourceType, sourceId: draft.sourceId },
  });
  await postSource(tx, draft);
}

/** Remove the entry for a deleted source document. Missing = already clean. */
export async function unpostSource(
  tx: Tx,
  sourceType: string,
  sourceId: string,
): Promise<void> {
  await tx.journalEntry.deleteMany({ where: { sourceType, sourceId } });
}

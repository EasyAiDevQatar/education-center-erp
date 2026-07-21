import "server-only";
import { db } from "./db";
import { anyDateInRanges, type YearRange } from "./academic-year-rules";

/**
 * Write guard for archived academic years.
 *
 * Archiving freezes the *money and attendance* record of a closed year —
 * sessions, payments, payouts and expenses — while leaving people records
 * editable, so a misspelled student name can still be corrected. Reports and
 * statements read normally; nothing here touches reads.
 *
 * Membership is by date range rather than a foreign key, because a record's own
 * date already says which year it belongs to.
 */

/** Error key returned to callers; rendered via `common.errors.*`. */
export const ARCHIVED_YEAR_ERROR = "yearArchived";

async function archivedRanges(): Promise<YearRange[]> {
  const years = await db.academicYear.findMany({
    where: { archived: true },
    select: { startDate: true, endDate: true },
  });
  return years.map((y) => ({ start: y.startDate, end: y.endDate }));
}

/** Does this date fall inside any archived year? */
export async function isDateArchived(date: Date | string | null | undefined): Promise<boolean> {
  if (!date) return false;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return false;
  return anyDateInRanges(await archivedRanges(), [d]);
}

/**
 * Guard a write against every date it touches.
 *
 * Pass **both** the record's current date and its new one when editing: moving
 * a session *out of* a frozen year is as much a change to that year's history
 * as editing it in place, and moving one *into* a frozen year would smuggle a
 * new record past the freeze. Checking only one side would let both through.
 *
 * Returns an error key when any date is frozen, or null when the write is fine.
 */
export async function guardArchived(
  ...dates: (Date | string | null | undefined)[]
): Promise<string | null> {
  const ranges = await archivedRanges();
  if (ranges.length === 0) return null; // nothing archived — skip the work
  return anyDateInRanges(ranges, dates) ? ARCHIVED_YEAR_ERROR : null;
}

export type AcademicYearRow = {
  id: string;
  nameAr: string;
  nameEn: string;
  startDate: string;
  endDate: string;
  archived: boolean;
  isCurrent: boolean;
  /** How much is frozen (or would be), so the UI can warn before archiving. */
  counts: { sessions: number; payments: number; payouts: number; expenses: number };
};

/** Years with the volume of records each one covers. */
export async function listAcademicYears(): Promise<AcademicYearRow[]> {
  const years = await db.academicYear.findMany({ orderBy: { startDate: "desc" } });

  return Promise.all(
    years.map(async (y) => {
      const range = { gte: y.startDate, lte: y.endDate };
      const [sessions, payments, payouts, expenses] = await Promise.all([
        db.session.count({ where: { date: range } }),
        db.payment.count({ where: { date: range } }),
        db.teacherPayout.count({ where: { periodStart: range } }),
        db.expense.count({ where: { date: range } }),
      ]);
      return {
        id: y.id,
        nameAr: y.nameAr,
        nameEn: y.nameEn,
        startDate: y.startDate.toISOString().slice(0, 10),
        endDate: y.endDate.toISOString().slice(0, 10),
        archived: y.archived,
        isCurrent: y.isCurrent,
        counts: { sessions, payments, payouts, expenses },
      };
    }),
  );
}

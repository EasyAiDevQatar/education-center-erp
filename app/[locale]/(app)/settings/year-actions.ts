"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";

export type YearState = { ok?: boolean; error?: string; id?: string };

async function guardAdmin() {
  const s = await getSession();
  return !s || s.role !== "ADMIN" ? null : s;
}

function revalidate(locale: string) {
  revalidatePath(`/${locale}/settings`);
  // The guard reads archived ranges on every money/attendance write, so a
  // change here can flip whether other pages accept edits at all.
  revalidatePath(`/${locale}`, "layout");
}

const saveSchema = z.object({
  id: z.string().optional().nullable(),
  nameAr: z.string().trim().min(1),
  nameEn: z.string().trim().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function saveAcademicYear(
  locale: string,
  input: z.infer<typeof saveSchema>,
): Promise<YearState> {
  if (!(await guardAdmin())) return { error: "forbidden" };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const start = new Date(`${d.startDate}T00:00:00.000Z`);
  const end = new Date(`${d.endDate}T23:59:59.999Z`);
  if (end <= start) return { error: "invalidPeriod" };

  // Overlapping years would make "which year is this date in" ambiguous, and
  // the archive guard answers exactly that question.
  const clash = await db.academicYear.findFirst({
    where: {
      ...(d.id ? { id: { not: d.id } } : {}),
      startDate: { lte: end },
      endDate: { gte: start },
    },
  });
  if (clash) return { error: "yearOverlap" };

  const data = { nameAr: d.nameAr, nameEn: d.nameEn, startDate: start, endDate: end };
  const year = d.id
    ? await db.academicYear.update({ where: { id: d.id }, data })
    : await db.academicYear.create({ data });

  await writeAudit("AcademicYear", year.id, d.id ? "UPDATE" : "CREATE", { after: data });
  revalidate(locale);
  return { ok: true, id: year.id };
}

/**
 * Close a year: archive it and make the next one current.
 *
 * Archiving is reversible on purpose — a centre that closes a year a week early
 * needs a way back that doesn't involve a database console.
 */
export async function setYearArchived(
  locale: string,
  id: string,
  archived: boolean,
): Promise<YearState> {
  if (!(await guardAdmin())) return { error: "forbidden" };

  const year = await db.academicYear.findUnique({ where: { id } });
  if (!year) return { error: "notfound" };

  // Archiving the current year would leave new work with nowhere to default to.
  if (archived && year.isCurrent) return { error: "cannotArchiveCurrent" };

  await db.academicYear.update({ where: { id }, data: { archived } });
  await writeAudit("AcademicYear", id, "UPDATE", { after: { archived } });
  revalidate(locale);
  return { ok: true };
}

/** Make one year the default for new work; exactly one is current. */
export async function setCurrentYear(locale: string, id: string): Promise<YearState> {
  if (!(await guardAdmin())) return { error: "forbidden" };

  const year = await db.academicYear.findUnique({ where: { id } });
  if (!year) return { error: "notfound" };
  if (year.archived) return { error: "cannotCurrentArchived" };

  await db.$transaction([
    db.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } }),
    db.academicYear.update({ where: { id }, data: { isCurrent: true } }),
  ]);
  await writeAudit("AcademicYear", id, "UPDATE", { after: { isCurrent: true } });
  revalidate(locale);
  return { ok: true };
}

export async function deleteAcademicYear(locale: string, id: string): Promise<YearState> {
  if (!(await guardAdmin())) return { error: "forbidden" };
  const year = await db.academicYear.findUnique({ where: { id } });
  if (!year) return { error: "notfound" };
  // Deleting an archived year would quietly unfreeze everything inside it.
  if (year.archived) return { error: "cannotDeleteArchived" };

  await db.academicYear.delete({ where: { id } });
  await writeAudit("AcademicYear", id, "DELETE", {});
  revalidate(locale);
  return { ok: true };
}

const rolloverSchema = z.object({
  nameAr: z.string().trim().min(1),
  nameEn: z.string().trim().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Archive the outgoing current year in the same step. */
  archivePrevious: z.coerce.boolean().default(true),
});

/**
 * Start a new year: create it, make it current, and archive the outgoing one.
 *
 * One action rather than three clicks, because doing it in pieces leaves the
 * centre in states that don't make sense — two current years, or a new year
 * that nothing defaults into.
 */
export async function startNewYear(
  locale: string,
  input: z.infer<typeof rolloverSchema>,
): Promise<YearState> {
  if (!(await guardAdmin())) return { error: "forbidden" };
  const parsed = rolloverSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const created = await saveAcademicYear(locale, {
    nameAr: d.nameAr,
    nameEn: d.nameEn,
    startDate: d.startDate,
    endDate: d.endDate,
  });
  if (!created.ok || !created.id) return created;

  const previous = await db.academicYear.findFirst({ where: { isCurrent: true } });

  await db.$transaction([
    db.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } }),
    db.academicYear.update({ where: { id: created.id }, data: { isCurrent: true } }),
    ...(d.archivePrevious && previous
      ? [db.academicYear.update({ where: { id: previous.id }, data: { archived: true } })]
      : []),
  ]);

  await writeAudit("AcademicYear", created.id, "CREATE", {
    after: { rollover: true, archivedPrevious: d.archivePrevious ? previous?.id : null },
  });
  revalidate(locale);
  return { ok: true, id: created.id };
}

import "server-only";
import { db } from "./db";
import { toNumber } from "./money";
import type { LocationType } from "./enums";
import { studentSpecialPrice } from "./special-price";

/**
 * Resolve the price-per-hour for a grade level + location from the versioned
 * PriceRule matrix — the newest active rule effective on/before `on`.
 * Returns 0 if no matching rule exists.
 */
export async function resolvePricePerHour(
  gradeLevelId: string,
  location: LocationType,
  on: Date = new Date(),
): Promise<number> {
  const rule = await db.priceRule.findFirst({
    where: {
      gradeLevelId,
      location,
      active: true,
      effectiveFrom: { lte: on },
    },
    orderBy: { effectiveFrom: "desc" },
  });
  return rule ? toNumber(rule.pricePerHour) : 0;
}

/** Student-specific agreed pricing wins over the matrix for every new lesson. */
export async function resolveStudentPricePerHour(
  studentId: string,
  teacherId: string | null,
  gradeLevelId: string,
  location: LocationType,
  on: Date = new Date(),
): Promise<number> {
  const student = await db.student.findUnique({
    where: { id: studentId },
    select: {
      specialPricePerHour: true,
      specialPriceTeachers: { select: { teacherId: true } },
    },
  });
  const special = studentSpecialPrice(
    student?.specialPricePerHour == null ? null : toNumber(student.specialPricePerHour),
    student?.specialPriceTeachers.map((row) => row.teacherId),
    teacherId,
  );
  if (special != null) return special;
  return resolvePricePerHour(gradeLevelId, location, on);
}

/** Full current matrix for the settings screen and session form defaults. */
export async function currentPriceMatrix() {
  const levels = await db.gradeLevel.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    include: {
      priceRules: {
        where: { active: true },
        orderBy: { effectiveFrom: "desc" },
      },
    },
  });
  return levels.map((lvl) => {
    const latest = (loc: LocationType) =>
      lvl.priceRules.find((r) => r.location === loc);
    return {
      gradeLevel: { id: lvl.id, code: lvl.code, nameAr: lvl.nameAr, nameEn: lvl.nameEn },
      CENTER: latest("CENTER") ? toNumber(latest("CENTER")!.pricePerHour) : null,
      HOME: latest("HOME") ? toNumber(latest("HOME")!.pricePerHour) : null,
    };
  });
}

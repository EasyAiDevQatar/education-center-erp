import { z } from "zod";

export const MAX_GUARDIAN_HOMES = 10;
export const MAX_BULK_GUARDIAN_STUDENTS = 25;

export type GuardianHomeInput = {
  id: string | null;
  label: string;
  address: string | null;
  homeCode: string | null;
  homeLat: number | null;
  homeLng: number | null;
  isDefault: boolean;
};

export type BulkGuardianStudentInput = {
  name: string;
  nameEn: string | null;
  gradeLevelId: string | null;
  gradeYear: number | null;
};

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: "invalid" | "tooMany" | "noStudents" };

/**
 * Resolve only from homes already loaded for the guardian. This is the
 * ownership boundary used by server actions: a well-formed id from another
 * family must never be accepted merely because it exists in the database.
 */
export function selectGuardianHome<T extends { id: string; isDefault: boolean }>(
  homes: T[],
  requestedId: string | null,
): { ok: true; value: T | null } | { ok: false; error: "invalidHome" } {
  if (requestedId) {
    const selected = homes.find((home) => home.id === requestedId);
    return selected
      ? { ok: true, value: selected }
      : { ok: false, error: "invalidHome" };
  }
  return {
    ok: true,
    value: homes.find((home) => home.isDefault) ?? homes[0] ?? null,
  };
}

const nullableCoordinate = (minimum: number, maximum: number) =>
  z.preprocess(
    (value) => {
      if (value === null || value === undefined || value === "") return null;
      return typeof value === "number" ? value : Number(value);
    },
    z.number().finite().min(minimum).max(maximum).nullable(),
  );

const guardianHomeSchema = z.object({
  id: z.string().trim().min(1).max(128).optional().nullable(),
  label: z.string().trim().max(80).default(""),
  address: z.string().trim().max(500).optional().nullable(),
  homeCode: z.string().trim().max(40).optional().nullable(),
  homeLat: nullableCoordinate(-90, 90),
  homeLng: nullableCoordinate(-180, 180),
  isDefault: z.boolean().optional().default(false),
});

/**
 * Parse the repeatable guardian-home editor payload.
 *
 * A fully blank editor row is ignored. A real row needs a friendly label and
 * either a written address or a complete map pin. Exactly one home is marked
 * as the default; when the user did not choose one, the first is used.
 */
export function parseGuardianHomes(raw: FormDataEntryValue | null): ParseResult<GuardianHomeInput[]> {
  let value: unknown;
  try {
    value = JSON.parse(String(raw ?? "[]"));
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (!Array.isArray(value)) return { ok: false, error: "invalid" };
  if (value.length > MAX_GUARDIAN_HOMES) return { ok: false, error: "tooMany" };

  const parsed = z.array(guardianHomeSchema).safeParse(value);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const populated = parsed.data
    .map((home) => ({
      id: home.id || null,
      label: home.label,
      address: home.address?.trim() || null,
      homeCode: home.homeCode?.trim() || null,
      homeLat: home.homeLat,
      homeLng: home.homeLng,
      isDefault: home.isDefault,
    }))
    .filter(
      (home) =>
        home.label !== "" ||
        home.address !== null ||
        home.homeCode !== null ||
        home.homeLat !== null ||
        home.homeLng !== null,
    );

  for (const home of populated) {
    const hasCompletePin = home.homeLat !== null && home.homeLng !== null;
    const hasPartialPin = (home.homeLat === null) !== (home.homeLng === null);
    if (!home.label || hasPartialPin || (!home.address && !hasCompletePin)) {
      return { ok: false, error: "invalid" };
    }
  }

  if (populated.length === 0) return { ok: true, value: [] };
  const defaultIndex = populated.findIndex((home) => home.isDefault);
  const selectedIndex = defaultIndex === -1 ? 0 : defaultIndex;
  return {
    ok: true,
    value: populated.map((home, index) => ({ ...home, isDefault: index === selectedIndex })),
  };
}

const optionalId = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : value),
  z.string().trim().min(1).max(128).nullable(),
);

const optionalGradeYear = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : Number(value)),
  z.number().int().min(1).max(12).nullable(),
);

const bulkStudentSchema = z.object({
  name: z.string().trim().max(120).default(""),
  nameEn: z.string().trim().max(120).optional().nullable(),
  gradeLevelId: optionalId,
  gradeYear: optionalGradeYear,
});

/** Parse the compact rows in the post-guardian bulk-student dialog. */
export function parseBulkGuardianStudents(
  raw: FormDataEntryValue | null,
): ParseResult<BulkGuardianStudentInput[]> {
  let value: unknown;
  try {
    value = JSON.parse(String(raw ?? "[]"));
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (!Array.isArray(value)) return { ok: false, error: "invalid" };
  if (value.length > MAX_BULK_GUARDIAN_STUDENTS) return { ok: false, error: "tooMany" };

  const parsed = z.array(bulkStudentSchema).safeParse(value);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const populated = parsed.data
    .map((row) => ({
      name: row.name,
      nameEn: row.nameEn?.trim() || null,
      gradeLevelId: row.gradeLevelId,
      gradeYear: row.gradeYear,
    }))
    .filter(
      (row) =>
        row.name !== "" ||
        row.nameEn !== null ||
        row.gradeLevelId !== null ||
        row.gradeYear !== null,
    );

  if (populated.length === 0) return { ok: false, error: "noStudents" };
  if (populated.some((row) => row.name === "")) return { ok: false, error: "invalid" };
  return { ok: true, value: populated };
}

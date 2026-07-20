// Pure helpers for the grade-level x location pricing model. Kept free of
// server-only / DB imports so they are unit-testable.

export type LocationType = "CENTER" | "HOME";

const LOCATION: Record<string, LocationType> = { مركز: "CENTER", بيت: "HOME" };

/**
 * Parse a legacy grade cell like "ث مركز" or "ب م مركز" into a level code and
 * location. Returns null when the cell has no recognizable location suffix.
 */
export function parseGrade(
  raw: unknown,
): { level: string; location: LocationType } | null {
  if (raw == null || raw === "") return null;
  const parts = String(raw).trim().split(/\s+/);
  if (parts.length < 2) return null;
  const location = LOCATION[parts[parts.length - 1]];
  if (!location) return null;
  const level = parts.slice(0, -1).join(" ");
  if (!level) return null;
  return { level, location };
}

export type PriceMatrix = Record<
  string,
  { CENTER: number | null; HOME: number | null }
>;

/** Resolve a price-per-hour from an in-memory matrix keyed by grade-level id. */
export function priceFromMatrix(
  matrix: PriceMatrix,
  gradeLevelId: string,
  location: LocationType,
): number {
  const row = matrix[gradeLevelId];
  if (!row) return 0;
  return row[location] ?? 0;
}

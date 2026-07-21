/**
 * Bilingual display names for people records.
 *
 * The centre's records are Arabic-first: `name` is always present and holds the
 * Arabic name, while `nameEn` is optional and fills in over time. Every display
 * therefore falls back to `name` — an English-language page showing a blank
 * where a student should be would be far worse than showing the Arabic name.
 *
 * Lookup tables (grade levels, terms, expense categories, academic years) use
 * required `nameAr`/`nameEn` pairs instead and do not go through this helper;
 * those are authored by the centre, not transcribed from a person's ID.
 */

export type Named = { name: string; nameEn?: string | null };

/** The name to show for `row` in `locale`. */
export function displayName(row: Named, locale: string): string {
  if (locale !== "en") return row.name;
  const en = row.nameEn?.trim();
  return en ? en : row.name;
}

/**
 * Both names, for places that identify a person rather than just label them —
 * pickers where two people share an Arabic name, and 360° page headers.
 * Returns just the one name when the other is missing or identical.
 */
export function fullName(row: Named, locale: string): string {
  const primary = displayName(row, locale);
  const other = locale === "en" ? row.name : row.nameEn?.trim();
  return other && other !== primary ? `${primary} — ${other}` : primary;
}

/** Every spelling of a name, for search and sort keys. */
export function nameSearchText(row: Named): string {
  const en = row.nameEn?.trim();
  return en ? `${row.name} ${en}` : row.name;
}

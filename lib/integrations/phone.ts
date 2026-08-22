/**
 * Phone numbers as the messaging provider wants them: E.164, no spaces.
 *
 * The centre's records are full of numbers a human typed — "5555 1234",
 * "05551234", "+974-5555-1234". The provider accepts none of those, and a
 * rejected number reads in the log as a failed send rather than as a number
 * that was never valid. Normalising here means the failure is visible at the
 * point somebody can fix it.
 *
 * Pure, so it is testable without a provider or a database.
 */

const E164 = /^\+[1-9]\d{6,14}$/;

/** Qatar. Local numbers are 8 digits and the centre's records are full of them. */
const DEFAULT_COUNTRY_CODE = "974";
const QATAR_LOCAL_DIGITS = 8;

/**
 * Best-effort E.164, or null when the input cannot be one.
 *
 * Null rather than a throw: one unreachable guardian must not abort a
 * notification run for everybody else on the session.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;

  // Strip everything a person might type as decoration, keeping a leading +.
  const hasPlus = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = trimmed.replace(/^00/, "").replace(/[^\d]/g, "");
  if (!digits) return null;

  if (!hasPlus) {
    // A bare local number: drop the trunk zero, then add the country code.
    digits = digits.replace(/^0+/, "");
    if (digits.length === QATAR_LOCAL_DIGITS) digits = DEFAULT_COUNTRY_CODE + digits;
  }

  const candidate = `+${digits}`;
  return E164.test(candidate) ? candidate : null;
}

/** Normalise a list, dropping what cannot be dialled and de-duplicating the rest. */
export function normalizePhones(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const phone = normalizePhone(value);
    if (phone) seen.add(phone);
  }
  return [...seen];
}

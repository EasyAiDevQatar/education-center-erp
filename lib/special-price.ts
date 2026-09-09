/**
 * A blank teacher scope means the student's agreed price applies centre-wide.
 * Once teachers are selected, only those teachers receive the override.
 */
export function studentSpecialPrice(
  specialPricePerHour: number | null | undefined,
  specialPriceTeacherIds: readonly string[] | undefined,
  teacherId: string | null | undefined,
): number | null {
  if (specialPricePerHour == null) return null;
  const scoped = specialPriceTeacherIds ?? [];
  if (scoped.length === 0) return specialPricePerHour;
  return teacherId && scoped.includes(teacherId) ? specialPricePerHour : null;
}

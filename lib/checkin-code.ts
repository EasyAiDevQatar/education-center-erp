import "server-only";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";

/**
 * The number on a student's card.
 *
 * It used to be nine random bytes as base64url — "kJ8xQ2mLpZ4a" — which is
 * unguessable and unreadable. Nobody types that at a busy front desk, and a
 * child who has lost their card cannot say it out loud, so the code was only
 * ever usable through a scanner.
 *
 * Five digits is short enough to read off a card, say down a phone, and type
 * with one hand. It is not a secret and does not need to be: the scan endpoint
 * is staff-only, so the code identifies a student rather than authorising
 * anything. Anyone who can use it can already open the student's record.
 */

/** Five digits: 90,000 codes, none starting with a zero that a form would eat. */
export const CODE_LENGTH = 5;
const MIN = 10 ** (CODE_LENGTH - 1);
const MAX = 10 ** CODE_LENGTH;

function draw(): string {
  return String(randomInt(MIN, MAX));
}

/**
 * A code nobody else holds.
 *
 * Retries rather than trusting the draw: at a few hundred students a collision
 * is unlikely but not impossible, and a duplicate would check in the wrong
 * child — the one failure mode that must not be left to chance. The unique
 * index on the column is the real guarantee; this keeps the insert from
 * hitting it.
 */
export async function uniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = draw();
    const taken = await db.student.findUnique({ where: { qrToken: code }, select: { id: true } });
    if (!taken) return code;
  }
  // 20 misses means the space is nearly full, which at five digits means the
  // centre has tens of thousands of students and needs a longer code.
  throw new Error("checkinCodeSpaceExhausted");
}

/** True for a code this system would have issued — used to spot legacy tokens. */
export function isShortCode(token: string | null | undefined): boolean {
  return !!token && new RegExp(`^\\d{${CODE_LENGTH}}$`).test(token);
}

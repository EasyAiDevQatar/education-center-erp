import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/password";
import { writeAudit } from "@/lib/audit";

/**
 * A second lock on the EasyAiConnect module.
 *
 * Signing in as an administrator is not meant to be the same thing as being
 * able to read the centre's messaging credential or change who gets messaged.
 * Anybody who walks past an unlocked machine already has the first; this asks
 * again for the second.
 *
 * The cookie is short-lived and is a convenience only. `requireGate` is called
 * by the page AND by every action in the module, because a gate enforced in a
 * page component is not enforced at all — server actions are reachable
 * directly, and a POST does not go through the page that drew the form.
 */

const COOKIE = "ec_connect";
const KEY = "easyAiConnectPasswordHash";
const MAX_AGE = 60 * 30; // 30 minutes — long enough to configure, short enough to lapse
const MIN_LENGTH = 8;

const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-only-change-me-please-32chars-minimum-secret",
);

/** Wrong guesses per window, per process — enough to stop a script, not a typist. */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; first: number }>();

function tooManyAttempts(userId: string): boolean {
  const now = Date.now();
  const rec = attempts.get(userId);
  if (!rec || now - rec.first > WINDOW_MS) return false;
  return rec.count >= MAX_ATTEMPTS;
}

function recordFailure(userId: string): void {
  const now = Date.now();
  const rec = attempts.get(userId);
  if (!rec || now - rec.first > WINDOW_MS) attempts.set(userId, { count: 1, first: now });
  else rec.count++;
}

/** Has anybody set the module password yet? */
export async function gateIsSet(): Promise<boolean> {
  const row = await db.setting.findUnique({ where: { key: KEY } });
  return Boolean(row?.value);
}

/**
 * Set or change the password. Only an ADMIN, and — once one exists — only
 * somebody who is already through the gate, so an unlocked machine cannot be
 * used to quietly replace the lock.
 */
export async function setGatePassword(plain: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return { error: "forbidden" };
  if (plain.trim().length < MIN_LENGTH) return { error: "tooShort" };
  if ((await gateIsSet()) && !(await gateIsOpen())) return { error: "locked" };

  const value = await hashPassword(plain.trim());
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  // The hash is never in the audit trail, only the fact that it changed.
  await writeAudit("Setting", KEY, "UPDATE");
  await open();
  return { ok: true };
}

async function open(): Promise<void> {
  const session = await getSession();
  const token = await new SignJWT({ userId: session?.userId ?? "" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret);
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

/** Check the password and, if it is right, open the gate for this browser. */
export async function openGate(plain: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return { error: "forbidden" };
  if (tooManyAttempts(session.userId)) return { error: "tooManyAttempts" };

  const row = await db.setting.findUnique({ where: { key: KEY } });
  if (!row?.value) return { error: "notSet" };

  if (!(await verifyPassword(plain, row.value))) {
    recordFailure(session.userId);
    // Recorded because a run of these is the signal that matters.
    await writeAudit("Integration", "gate", "UPDATE", { after: { result: "wrongPassword" } });
    return { error: "wrongPassword" };
  }
  attempts.delete(session.userId);
  await open();
  return { ok: true };
}

export async function closeGate(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

/** Is this browser currently through the gate, for the signed-in user? */
export async function gateIsOpen(): Promise<boolean> {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return false;
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secret);
    // Tied to the user who opened it, so the cookie does not survive a
    // sign-out into somebody else's session on the same browser.
    return (payload as { userId?: string }).userId === session.userId;
  } catch {
    return false;
  }
}

/**
 * The guard every action in this module must call.
 *
 * Returns an error object rather than throwing so a caller returns it straight
 * to the form, in the same shape as every other action's failure.
 */
export async function requireGate(): Promise<{ error: string } | null> {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return { error: "forbidden" };
  // Before a password exists the module is reachable so somebody can set one;
  // after that, the gate is the way in.
  if (!(await gateIsSet())) return null;
  return (await gateIsOpen()) ? null : { error: "locked" };
}

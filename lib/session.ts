import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "./enums";

const COOKIE = "ec_session";
const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-only-change-me-please-32chars-minimum-secret",
);
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type SessionPayload = {
  userId: string;
  name: string;
  role: Role;
  locale: string;
  teacherId?: string | null;
  guardianId?: string | null;
};

export async function encryptSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret);
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await encryptSession(payload);
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

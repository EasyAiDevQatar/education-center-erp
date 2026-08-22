import "server-only";
import { SignJWT, jwtVerify } from "jose";

/**
 * A link to one document, for somebody who cannot sign in.
 *
 * The messaging provider fetches attachments itself, from its own servers, so
 * a statement PDF or a card image has to be reachable without a session — and
 * a statement is somebody's finances. The token is therefore the whole
 * credential: signed so it cannot be forged, scoped to one document so it
 * opens nothing else, and short-lived so a URL that ends up in a screenshot
 * stops working.
 *
 * A day is deliberate. The provider fetches within seconds, so the window only
 * needs to cover a queue or a retry; anything longer is exposure bought for a
 * case that does not happen. The parent keeps the PDF WhatsApp downloaded for
 * them, not the link.
 */

const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-only-change-me-please-32chars-minimum-secret",
);

export const STATEMENT_KINDS = ["student", "guardian", "teacher", "checkin-code"] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];
export type StatementRef = { kind: StatementKind; id: string; locale: string };

const TTL_SECONDS = 60 * 60 * 24;

export async function signStatementToken(ref: StatementRef): Promise<string> {
  return new SignJWT({ ...ref })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret);
}

/** The document this token opens, or null if it opens nothing. */
export async function verifyStatementToken(token: string): Promise<StatementRef | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    const kind = String(payload.kind ?? "");
    const id = String(payload.id ?? "");
    if (!(STATEMENT_KINDS as readonly string[]).includes(kind) || !id) return null;
    return { kind: kind as StatementKind, id, locale: String(payload.locale ?? "ar") };
  } catch {
    return null;
  }
}

/**
 * Does this token open THIS document?
 *
 * Checked per page rather than trusted as "a valid token": a signed link to
 * one child's statement must not open another's just because both pages know
 * how to verify a signature.
 */
export async function tokenOpens(
  token: string | undefined | null,
  kind: StatementKind,
  id: string,
): Promise<boolean> {
  if (!token) return false;
  const ref = await verifyStatementToken(token);
  return !!ref && ref.kind === kind && ref.id === id;
}

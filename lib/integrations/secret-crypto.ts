import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption at rest for provider credentials.
 *
 * The integrations table stored its API key in clear text while the type that
 * carried it claimed to be "decrypted configuration" — a comment describing an
 * intention nobody had implemented. Anyone with a read of the database, a
 * backup file, or one of the nightly dumps had the key.
 *
 * The stored format is self-describing — `v1:iv:tag:ciphertext` — which is what
 * lets a value written before this existed keep working: anything that does not
 * carry the prefix is read back as the plaintext it is, and re-encrypted the
 * next time it is saved. No migration, no window where the credential is
 * unreadable, and no risk of locking the centre out of its own integration.
 */

const FORMAT = "v1";

function key(): Buffer {
  // A dedicated key if one is set, otherwise the session secret — which every
  // deployment already has, so encryption is never silently skipped for want
  // of configuration. Rotating either one makes stored secrets unreadable;
  // they are re-entered from Settings, not recovered.
  const source = process.env.CREDENTIAL_KEY || process.env.AUTH_SECRET;
  if (!source) throw new Error("credentialKeyMissing");
  return createHash("sha256").update(source).digest();
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    FORMAT,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    body.toString("base64"),
  ].join(":");
}

/** True when a stored value is in the encrypted format rather than legacy clear text. */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(`${FORMAT}:`) && stored.split(":").length === 4;
}

/**
 * Read a stored credential. A legacy clear-text value is returned unchanged —
 * see the note above; that is the migration.
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const [, ivValue, tagValue, body] = stored.split(":");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivValue, "base64"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key, or a truncated value. Returning "" rather than throwing keeps
    // a broken credential from taking down every page that reads settings; the
    // integration simply reports that it is not configured.
    return "";
  }
}

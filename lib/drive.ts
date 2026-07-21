import "server-only";
import { createSign } from "node:crypto";

/**
 * Minimal Google Drive upload via a service account — no SDK, one JWT grant
 * and one multipart POST. The service account authenticates itself with its
 * private key; the centre grants access by SHARING the target Drive folder
 * with the service account's email, which is exactly what the settings card's
 * guidance walks through.
 */

export type ServiceAccount = { client_email: string; private_key: string };

/** Parses and shape-checks a pasted service-account JSON. */
export function parseServiceAccount(json: string): ServiceAccount | null {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (
      typeof o.client_email === "string" &&
      o.client_email.includes("@") &&
      typeof o.private_key === "string" &&
      o.private_key.includes("BEGIN PRIVATE KEY")
    ) {
      return { client_email: o.client_email, private_key: o.private_key };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** OAuth2 access token via the JWT bearer grant. */
export async function driveAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      // Full drive scope: with drive.file the account cannot write into a
      // folder it did not itself create, which is the entire use case here.
      scope: "https://www.googleapis.com/auth/drive",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(sa.private_key));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("no access_token in response");
  return body.access_token;
}

/** Multipart upload of a small buffer into a folder. Returns the file id. */
export async function driveUpload(
  sa: ServiceAccount,
  folderId: string,
  fileName: string,
  content: Buffer,
  mimeType = "application/gzip",
): Promise<string> {
  const token = await driveAccessToken(sa);
  const boundary = "edu-erp-" + Date.now().toString(36);
  const meta = JSON.stringify({ name: fileName, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    // supportsAllDrives covers shared-drive folders as well as My Drive ones.
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) throw new Error(`upload ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = (await res.json()) as { id?: string };
  if (!out.id) throw new Error("upload returned no file id");
  return out.id;
}

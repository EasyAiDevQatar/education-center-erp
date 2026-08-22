import { NextResponse } from "next/server";
import { recordInbound } from "@/lib/integrations/inbound";

/**
 * Where EasyAiConnect delivers messages people send to the centre.
 *
 * The secret in the path is the whole credential — that is the provider's
 * model, and it is why the secret is long, random and rotatable from Settings.
 * Rotating it is how a leaked URL is revoked.
 *
 * Always answers 200 once the secret is good, including for messages we choose
 * to ignore. The provider retries anything else, and a retry loop over an
 * event we were never going to store is noise for both sides. A bad secret is
 * the one case that gets a 404 — and it is a 404 rather than a 403 so probing
 * cannot tell the difference between a wrong secret and no integration.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ secret: string }> },
) {
  const { secret } = await ctx.params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const result = await recordInbound(secret, payload);
  if (!result.ok) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json(result, { status: 200 });
}

/**
 * Some providers probe the URL with a GET before saving it. Answering without
 * revealing whether the secret is right keeps that from becoming an oracle.
 */
export async function GET() {
  return new NextResponse(null, { status: 204 });
}

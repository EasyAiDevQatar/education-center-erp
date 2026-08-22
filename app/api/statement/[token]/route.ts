import { NextResponse } from "next/server";
import { verifyStatementToken } from "@/lib/statement-token";
import { renderStatementPdf } from "@/lib/statement-pdf";

/**
 * One statement, as a PDF, to whoever holds a valid link.
 *
 * Public by necessity: the messaging provider fetches attachments from its own
 * servers and cannot present a session. The token is the credential — signed,
 * scoped to a single document, and expiring within a day — so this endpoint
 * checks it and nothing else.
 *
 * `noindex` and `no-store` because a statement is somebody's finances and has
 * no business in a search index or a shared cache.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const ref = await verifyStatementToken(token.replace(/\.pdf$/, ""));
  if (!ref) return new NextResponse("Not found", { status: 404 });

  try {
    const pdf = await renderStatementPdf(ref, token.replace(/\.pdf$/, ""));
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `inline; filename="statement-${ref.kind}.pdf"`,
        "Cache-Control": "no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch {
    // Chrome's reason is in the server log; the caller gets nothing that would
    // help somebody probe for valid tokens.
    return new NextResponse("Unavailable", { status: 503 });
  }
}

import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { verifyStatementToken } from "@/lib/statement-token";

/**
 * One student's check-in card, as a scannable image.
 *
 * The number alone is enough at the desk, but a parent standing at the door
 * with a phone wants something the scanner can read, and a screenshot of five
 * digits is not that. Both go out together: the digits to read aloud, the
 * square to hold up.
 *
 * Public for the same reason the statement PDF is — the messaging provider
 * fetches attachments from its own servers and cannot present a session. The
 * token names one student and expires, so the URL opens that card and nothing
 * else.
 *
 * Generated per request rather than stored: a QR of a five-digit code costs
 * almost nothing to draw, and a file on disk would be one more thing to keep
 * in step when a card is re-issued.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const clean = token.replace(/\.png$/, "");
  const ref = await verifyStatementToken(clean);
  if (!ref || ref.kind !== "checkin-code") {
    return new NextResponse("Not found", { status: 404 });
  }

  const student = await db.student.findUnique({
    where: { id: ref.id },
    select: { qrToken: true },
  });
  if (!student?.qrToken) return new NextResponse("Not found", { status: 404 });

  const png = await QRCode.toBuffer(student.qrToken, {
    type: "png",
    width: 512,
    margin: 2,
    errorCorrectionLevel: "M",
  });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.length),
      "Content-Disposition": `inline; filename="checkin-code.png"`,
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

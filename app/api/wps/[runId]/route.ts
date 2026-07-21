import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { FINANCE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { buildWpsPayload } from "@/lib/wps/build-payload";
import { generateSif, validateSif } from "@/lib/wps/generate";

/**
 * Download the WPS SIF for a payroll run.
 *
 * Validation errors return 422 with the issue list — the file is never
 * emitted with known defects, because a rejected SIF means nobody gets paid
 * on time. A successful download is recorded as a WpsExport with a checksum:
 * the bytes are not stored, but the generator is deterministic, so the file
 * is reproducible and the checksum proves which file the bank received.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  const session = await getSession();
  if (!session || !FINANCE_ROLES.includes(session.role)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const { runId } = await ctx.params;

  const built = await buildWpsPayload(runId, new Date());
  if (!built) return new NextResponse("Not found", { status: 404 });

  const issues = validateSif(built.payload);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    return NextResponse.json({ ok: false, issues: errors }, { status: 422 });
  }

  const { fileName, content, recordCount, totalSalaries } = generateSif(built.payload);
  const checksum = createHash("sha256").update(content, "utf8").digest("hex");

  const exp = await db.wpsExport.create({
    data: {
      runId,
      bankCode: built.payload.payerBankShortName,
      sifVersion: built.payload.sifVersion,
      fileName,
      recordCount,
      totalAmount: totalSalaries,
      checksum,
      createdByUserId: session.userId,
    },
  });
  await writeAudit("WpsExport", exp.id, "CREATE", {
    after: { fileName, recordCount, totalAmount: totalSalaries, checksum },
  });

  return new NextResponse(content, {
    headers: {
      // utf-8 keeps Arabic names intact; the spec mandates CSV, not an encoding.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}

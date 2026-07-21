import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { backupPath } from "@/lib/backups";

/**
 * Stream one backup file to an ADMIN. The name is validated against a strict
 * allow-list pattern before it ever touches the filesystem, so the URL cannot
 * be steered outside the backup directory.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const { name } = await ctx.params;
  const filePath = backupPath(name);
  if (!filePath) return new NextResponse("Not found", { status: 404 });

  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  // Streamed, not buffered — a dump can be far bigger than we want in memory.
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}

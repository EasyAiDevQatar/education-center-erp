import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { StatementRef } from "./statement-token";

/**
 * The statement as a PDF — by printing the page the centre already has.
 *
 * Rendered with the Chrome that is already on this server rather than a PDF
 * library, and the reason is Arabic. A PDF library draws glyphs: it would need
 * a font embedded, the text reversed, and the letters joined by hand, and the
 * usual result is a statement that reads as disconnected letters backwards.
 * Chrome already shapes Arabic correctly, and it is the same engine that
 * renders the statement on screen — so the PDF is the page, not a second
 * implementation of it that can drift.
 *
 * It prints from localhost, so the render never leaves the machine.
 */

const CHROME = process.env.CHROME_BIN || "/usr/bin/google-chrome";
const RENDER_TIMEOUT_MS = 45_000;

function pagePath(ref: StatementRef, token: string): string {
  return `/${ref.locale}/statement/${ref.kind}/${encodeURIComponent(ref.id)}?t=${encodeURIComponent(token)}&pdf=1`;
}

/** The bytes of one statement. Throws with Chrome's own words when it cannot. */
export async function renderStatementPdf(ref: StatementRef, token: string): Promise<Buffer> {
  const port = process.env.PORT || "3005";
  const url = `http://127.0.0.1:${port}${pagePath(ref, token)}`;

  const dir = await mkdtemp(path.join(tmpdir(), "statement-"));
  const out = path.join(dir, "statement.pdf");
  try {
    await new Promise<void>((resolve, reject) => {
      const chrome = spawn(CHROME, [
        "--headless",
        "--disable-gpu",
        // Runs as root on this box; Chrome refuses to start otherwise.
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--no-pdf-header-footer",
        `--print-to-pdf=${out}`,
        url,
      ]);
      let stderr = "";
      chrome.stderr.on("data", (d) => { stderr += String(d); });
      const timer = setTimeout(() => {
        chrome.kill("SIGKILL");
        reject(new Error("statementRenderTimeout"));
      }, RENDER_TIMEOUT_MS);
      // Subscribed before awaiting: a fast render can close before a listener
      // added later would ever hear it.
      chrome.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(stderr.trim().slice(-300) || `chrome exited ${code}`));
      });
      chrome.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export type PublicLeadState = { ok?: boolean; error?: string };

/**
 * The ONLY unauthenticated write in the app besides login, so it borrows
 * login's defences: zod validation, per-IP rate limiting through the existing
 * LoginAttempt table (synthetic email "public-lead" keys the counter), and a
 * honeypot that swallows bots with a fake success.
 */
const MAX_PER_HOUR = 5;

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    // Qatari numbers are 8 digits; allow an international prefix.
    .regex(/^\+?\d{8,15}$/),
  gradeLevelId: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function createPublicLead(
  locale: string,
  _prev: PublicLeadState,
  formData: FormData,
): Promise<PublicLeadState> {
  void locale;

  // Honeypot: a hidden "website" field humans never see. A filled value gets a
  // fake success — telling a bot it was blocked only teaches it.
  if ((formData.get("website") ?? "").toString().trim() !== "") {
    return { ok: true };
  }

  const parsed = schema.safeParse({
    name: formData.get("name"),
    phone: (formData.get("phone") ?? "").toString().replace(/[\s-]/g, ""),
    gradeLevelId: (formData.get("gradeLevelId") ?? "").toString() || null,
    notes: (formData.get("notes") ?? "").toString().trim() || null,
  });
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const ip = await clientIp();
  const windowStart = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db.loginAttempt.count({
    where: { email: "public-lead", ip: ip ?? "unknown", at: { gte: windowStart } },
  });
  if (recent >= MAX_PER_HOUR) return { error: "locked" };
  await db.loginAttempt.create({
    data: { email: "public-lead", ip: ip ?? "unknown", success: true },
  });

  // A repeated submit with the same phone updates the note instead of piling
  // duplicate NEW cards onto the leads board.
  const existing = await db.lead.findFirst({
    where: { phone: d.phone, status: { in: ["NEW", "CONTACTED"] } },
  });
  if (existing) {
    await db.lead.update({
      where: { id: existing.id },
      data: { notes: [existing.notes, d.notes].filter(Boolean).join("\n") || existing.notes },
    });
    return { ok: true };
  }

  // Validate the grade against the real list — the form posts ids, but this is
  // a public endpoint and ids are attacker-controlled.
  let gradeLevelId: string | null = null;
  if (d.gradeLevelId) {
    const level = await db.gradeLevel.findFirst({
      where: { id: d.gradeLevelId, active: true },
    });
    gradeLevelId = level?.id ?? null;
  }

  const created = await db.lead.create({
    data: {
      name: d.name,
      phone: d.phone,
      gradeLevelId,
      notes: d.notes,
      status: "NEW",
      source: "website",
    },
  });
  await writeAudit("Lead", created.id, "CREATE", {
    after: { name: d.name, source: "website" },
  });
  return { ok: true };
}

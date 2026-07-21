"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { HR_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { leaveDays, overlaps } from "@/lib/leave";

export type ActionState = { ok?: boolean; error?: string };

async function guard() {
  const s = await getSession();
  return !s || !HR_ROLES.includes(s.role);
}

const requestSchema = z.object({
  employeeId: z.string().min(1),
  typeCode: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().optional().nullable(),
});

export async function createLeaveRequest(
  locale: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = requestSchema.safeParse({
    employeeId: formData.get("employeeId"),
    typeCode: formData.get("typeCode"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    reason: (formData.get("reason") ?? "").toString().trim() || null,
  });
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  // Days are computed and FROZEN here — a later policy change must not
  // silently alter what this request was approved as. Calendar days, per
  // Qatari annual-leave counting.
  const days = leaveDays(d.startDate, d.endDate);
  if (days <= 0) return { error: "invalidPeriod" };

  // A person cannot be on two leaves at once, and letting it through would
  // double-count days against the balance.
  const existing = await db.leaveRequest.findMany({
    where: { employeeId: d.employeeId, status: { in: ["PENDING", "APPROVED"] } },
  });
  const clash = existing.some((r) =>
    overlaps(
      { start: d.startDate, end: d.endDate },
      {
        start: r.startDate.toISOString().slice(0, 10),
        end: r.endDate.toISOString().slice(0, 10),
      },
    ),
  );
  if (clash) return { error: "leaveOverlap" };

  const created = await db.leaveRequest.create({
    data: {
      employeeId: d.employeeId,
      typeCode: d.typeCode,
      startDate: new Date(`${d.startDate}T00:00:00.000Z`),
      endDate: new Date(`${d.endDate}T00:00:00.000Z`),
      days,
      reason: d.reason,
    },
  });
  await writeAudit("LeaveRequest", created.id, "CREATE", { after: { ...d, days } });
  revalidatePath(`/${locale}/hr/leave`);
  return { ok: true };
}

export async function decideLeaveRequest(
  locale: string,
  id: string,
  decision: "APPROVED" | "REJECTED",
  note?: string,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const s = await getSession();
  const req = await db.leaveRequest.findUnique({ where: { id } });
  if (!req) return { error: "notfound" };
  // Only a pending request can be decided — re-deciding an approved one would
  // silently rewrite a balance that may already have been acted on.
  if (req.status !== "PENDING") return { error: "alreadyDecided" };

  await db.leaveRequest.update({
    where: { id },
    data: {
      status: decision,
      decidedByUserId: s?.userId ?? null,
      decidedAt: new Date(),
      decisionNote: note?.trim() || null,
    },
  });
  await writeAudit("LeaveRequest", id, "UPDATE", { after: { status: decision } });
  revalidatePath(`/${locale}/hr/leave`);
  return { ok: true };
}

export async function cancelLeaveRequest(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const req = await db.leaveRequest.findUnique({ where: { id } });
  if (!req) return { error: "notfound" };
  await db.leaveRequest.update({ where: { id }, data: { status: "CANCELLED" } });
  await writeAudit("LeaveRequest", id, "UPDATE", { after: { status: "CANCELLED" } });
  revalidatePath(`/${locale}/hr/leave`);
  return { ok: true };
}

const adjustSchema = z.object({
  employeeId: z.string().min(1),
  typeCode: z.string().min(1),
  // Positive credits days (opening balance, carry-forward), negative debits.
  days: z.coerce.number().min(-365).max(365),
  reason: z.string().trim().min(1),
});

export async function createLeaveAdjustment(
  locale: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const s = await getSession();
  const parsed = adjustSchema.safeParse({
    employeeId: formData.get("employeeId"),
    typeCode: formData.get("typeCode") || "ANNUAL",
    days: formData.get("days"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: "invalid" };
  if (parsed.data.days === 0) return { error: "invalid" };

  const created = await db.leaveAdjustment.create({
    data: {
      ...parsed.data,
      effectiveOn: new Date(),
      createdByUserId: s?.userId ?? null,
    },
  });
  await writeAudit("LeaveAdjustment", created.id, "CREATE", { after: parsed.data });
  revalidatePath(`/${locale}/hr/leave`);
  return { ok: true };
}

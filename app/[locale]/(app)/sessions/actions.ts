"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { resolvePricePerHour } from "@/lib/pricing";
import { writeAudit } from "@/lib/audit";
import { guardArchived } from "@/lib/academic-year";
import { combineDateTime } from "@/lib/session-time";
import { notifySession } from "@/lib/integrations/notify";
import { applyPackageHours, syncSessionPaymentStatus } from "@/lib/billing";
import { LOCATIONS, PAYMENT_STATUSES } from "@/lib/enums";

export type ActionState = { ok?: boolean; error?: string };

const schema = z.object({
  date: z.string().min(1),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  studentId: z.string().min(1),
  teacherId: z.string().min(1),
  gradeLevelId: z.string().min(1),
  location: z.enum(LOCATIONS),
  hours: z.coerce.number().positive(),
  paymentStatus: z.enum(PAYMENT_STATUSES).default("UNPAID"),
  notes: z.string().trim().optional().nullable(),
  packageId: z.string().trim().optional().nullable(),
  subjectId: z.string().trim().optional().nullable(),
});

async function guard() {
  const s = await getSession();
  return !s || !STAFF_ROLES.includes(s.role);
}

export async function saveSession(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };

  const parsed = schema.safeParse({
    date: formData.get("date"),
    time: formData.get("time") || null,
    studentId: formData.get("studentId"),
    teacherId: formData.get("teacherId"),
    gradeLevelId: formData.get("gradeLevelId"),
    location: formData.get("location"),
    hours: formData.get("hours"),
    paymentStatus: formData.get("paymentStatus") || "UNPAID",
    notes: formData.get("notes") || null,
    packageId: formData.get("packageId") || null,
    subjectId: formData.get("subjectId") || null,
  });
  if (!parsed.success) return { error: "invalid" };

  const d = parsed.data;
  const date = combineDateTime(d.date, d.time);

  // Both dates: an edit must not move a session out of a frozen year either.
  const priorSession = id ? await db.session.findUnique({ where: { id } }) : null;
  const frozen = await guardArchived(date, priorSession?.date);
  if (frozen) return { error: frozen };
  // Authoritative price resolution from the matrix (client preview is advisory).
  const pricePerHour = await resolvePricePerHour(d.gradeLevelId, d.location, date);
  const total = pricePerHour * d.hours;

  const data = {
    date,
    studentId: d.studentId,
    teacherId: d.teacherId,
    gradeLevelId: d.gradeLevelId,
    location: d.location,
    hours: d.hours,
    pricePerHour,
    total,
    paymentStatus: d.paymentStatus,
    notes: d.notes,
    packageId: d.packageId || null,
    subjectId: d.subjectId || null,
  };

  if (id) {
    await db.session.update({ where: { id }, data });
    await writeAudit("Session", id, "UPDATE", { after: data });
    await notifySession("SESSION_RESCHEDULED", id);
  } else {
    const created = await db.session.create({ data });
    // Package-covered sessions are settled by the package purchase, so reflect
    // that in paymentStatus straight away. Hours are only drawn down once the
    // session is actually taught (confirm / check-out).
    if (data.packageId) {
      await db.$transaction((tx) => syncSessionPaymentStatus(tx, created.id));
    }
    await writeAudit("Session", created.id, "CREATE", { after: data });
    await notifySession("SESSION_BOOKED", created.id);
  }
  revalidatePath(`/${locale}/sessions`);
  revalidatePath(`/${locale}/calendar`);
  return { ok: true };
}

export async function deleteSession(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const prior = await db.session.findUnique({ where: { id } });
  const frozen = await guardArchived(prior?.date);
  if (frozen) return { error: frozen };
  await db.session.delete({ where: { id } });
  await writeAudit("Session", id, "DELETE");
  revalidatePath(`/${locale}/sessions`);
  revalidatePath(`/${locale}/calendar`);
  return { ok: true };
}

/* -------- Group booking: register many students to one teacher at once -------- */

const groupSchema = z.object({
  // One or more occurrence dates (recurring bookings expand to many).
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(60),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  teacherId: z.string().min(1),
  location: z.enum(LOCATIONS),
  hours: z.coerce.number().positive(),
  // Optional grade override applied to all; otherwise each student's own grade is used.
  gradeLevelId: z.string().optional().nullable(),
  paymentStatus: z.enum(PAYMENT_STATUSES).default("UNPAID"),
  studentIds: z.array(z.string().min(1)).min(1).max(200),
  // Per-student agreed price (a saved group / "course"): overrides the matrix
  // for that student. Absent entries fall back to the matrix as before.
  prices: z
    .array(z.object({ studentId: z.string().min(1), pricePerHour: z.coerce.number().nonnegative() }))
    .optional(),
});

export type GroupResult = { ok?: boolean; error?: string; created?: number; skipped?: number };

/** Safety cap on a single batch (occurrences × students). */
const MAX_GROUP_ROWS = 800;

/** Create one session per (occurrence date × selected student), all sharing the
 *  same teacher / slot. Price is resolved per student from the matrix using the
 *  grade override or the student's own grade. Students with no resolvable grade
 *  are skipped. Recurring bookings pass multiple `dates`. */
export async function createGroupSessions(
  locale: string,
  input: z.infer<typeof groupSchema>,
): Promise<GroupResult> {
  if (await guard()) return { error: "forbidden" };
  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  const dates = [...new Set(d.dates)].sort();
  const priceOverride = new Map<string, number>(
    (d.prices ?? []).map((x) => [x.studentId, x.pricePerHour]),
  );

  const students = await db.student.findMany({
    where: { id: { in: d.studentIds } },
    select: { id: true, gradeLevelId: true },
  });

  // Cache price lookups by grade+location+date (date matters for versioned rules).
  const priceCache = new Map<string, number>();
  const priceFor = async (gradeLevelId: string, on: Date) => {
    const key = `${gradeLevelId}|${d.location}|${on.toISOString().slice(0, 10)}`;
    if (!priceCache.has(key)) {
      priceCache.set(key, await resolvePricePerHour(gradeLevelId, d.location, on));
    }
    return priceCache.get(key)!;
  };

  const rows: {
    date: Date; studentId: string; teacherId: string; gradeLevelId: string;
    location: string; hours: number; pricePerHour: number; total: number; paymentStatus: string;
  }[] = [];
  const skippedStudents = new Set<string>();

  for (const dateStr of dates) {
    const date = combineDateTime(dateStr, d.time);
    for (const s of students) {
      const gradeLevelId = d.gradeLevelId || s.gradeLevelId;
      if (!gradeLevelId) { skippedStudents.add(s.id); continue; }
      const override = priceOverride.get(s.id);
      const pricePerHour = override != null ? override : await priceFor(gradeLevelId, date);
      rows.push({
        date,
        studentId: s.id,
        teacherId: d.teacherId,
        gradeLevelId,
        location: d.location,
        hours: d.hours,
        pricePerHour,
        total: pricePerHour * d.hours,
        paymentStatus: d.paymentStatus,
      });
    }
  }

  // `skipped` counts distinct students that couldn't be priced (per occurrence).
  const skipped = skippedStudents.size;
  if (rows.length === 0) return { error: "noGrade", created: 0, skipped };
  if (rows.length > MAX_GROUP_ROWS) return { error: "tooMany", skipped };

  const created = await db.$transaction(
    rows.map((data) => db.session.create({ data })),
  );
  await Promise.all(
    created.map((c) => writeAudit("Session", c.id, "CREATE", { after: { group: true, teacherId: d.teacherId } })),
  );
  // Notify each booked student/parent/teacher (best-effort, never blocking).
  for (const c of created) await notifySession("SESSION_BOOKED", c.id);

  revalidatePath(`/${locale}/sessions`);
  revalidatePath(`/${locale}/calendar`);
  return { ok: true, created: created.length, skipped };
}

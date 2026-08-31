"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { flagTripsForSession } from "@/lib/transport/trip-data";
import { findBlockingOverlap } from "@/lib/session-overlap";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { resolvePricePerHour } from "@/lib/pricing";
import { writeAudit } from "@/lib/audit";
import { guardArchived } from "@/lib/academic-year";
import { combineDateTime } from "@/lib/session-time";
import { notifySession } from "@/lib/integrations/notify";
import { revertPackageHours, syncSessionPaymentStatus } from "@/lib/billing";
import { LOCATIONS, PAYMENT_STATUSES } from "@/lib/enums";
import { canCancelSession } from "@/lib/session-lifecycle";

export type ActionState = {
  ok?: boolean;
  error?: string;
  /** A HOME session was booked with no trip serving it yet. */
  homeNeedsTrip?: { count: number; date: string } | null;
  /** Who is already booked, so a refusal names the clash instead of just saying no. */
  detail?: string;
};

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

  // The clash check the screens only ever warned about. Group rows are exempt
  // from the teacher rule — see findBlockingOverlap.
  const clash = await findBlockingOverlap({
    id,
    teacherId: d.teacherId,
    studentId: d.studentId,
    date,
    hours: d.hours,
    groupId: (formData.get("groupId") as string) || priorSession?.groupId || null,
    bookingBatchId: priorSession?.bookingBatchId ?? null,
  });
  if (clash) {
    const t = clash.startsAt.toISOString().slice(11, 16);
    return {
      error: clash.kind === "STUDENT" ? "studentBusy" : "teacherBusy",
      detail: `${clash.kind === "STUDENT" ? clash.studentName : clash.teacherName} — ${clash.studentName} ${t}`,
    };
  }
  // Authoritative price resolution from the matrix (client preview is advisory).
  const pricePerHour = await resolvePricePerHour(d.gradeLevelId, d.location, date);
  // Editing a finalized session may change its planned timetable details, but
  // its historical billable snapshot remains the financial source of truth.
  const financialHours = priorSession?.billableHours == null
    ? d.hours
    : Number(priorSession.billableHours);
  const total = pricePerHour * financialHours;

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
    // A session edit can move its timing/location — flag any linked trips.
    await flagTripsForSession(id, "SESSION_CHANGED");
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
    revalidatePath(`/${locale}/sessions`);
    revalidatePath(`/${locale}/calendar`);
    // A freshly booked home lesson has no ride yet by definition — prompt.
    if (data.location === "HOME") {
      return { ok: true, homeNeedsTrip: { count: 1, date: d.date } };
    }
    return { ok: true };
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

/** Cancel a lesson without deleting its history or its receipt trail. */
export async function cancelSession(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const prior = await db.session.findUnique({ where: { id } });
  if (!prior) return { error: "notfound" };
  const frozen = await guardArchived(prior.date);
  if (frozen) return { error: frozen };
  if (prior.status === "CANCELLED") return { ok: true };
  if (!canCancelSession(prior.status)) return { error: "badSessionTransition" };

  await db.$transaction(async (tx) => {
    await revertPackageHours(tx, id);
    // The receipt remains real money. Removing only its lesson allocation turns
    // it into unapplied student credit rather than silently deleting cash.
    await tx.paymentAllocation.deleteMany({ where: { sessionId: id } });
    await tx.session.update({
      where: { id },
      data: {
        status: "CANCELLED",
        paymentStatus: "PAID",
        autoCompleted: false,
        needsTeacher: false,
      },
    });
  });

  await flagTripsForSession(id, "SESSION_CANCELLED");
  await writeAudit("Session", id, "UPDATE", { after: { status: "CANCELLED" } });
  await notifySession("SESSION_CANCELLED", id);
  revalidatePath(`/${locale}/sessions`);
  revalidatePath(`/${locale}/calendar`);
  revalidatePath(`/${locale}/payments`);
  revalidatePath(`/${locale}/dashboard`);
  return { ok: true };
}

const bulkCancelSchema = z.object({
  sessionIds: z.array(z.string().min(1)).min(2).max(200),
});

export type BulkCancelResult = ActionState & { cancelled?: number };

type GroupOccurrenceIdentity = {
  bookingBatchId: string | null;
  groupId: string | null;
  date: Date;
  teacherId: string | null;
  location: string;
  hours: { toString(): string };
  createdAt: Date;
};

/** Prove that client-supplied rows are one real group occurrence, never merely simultaneous. */
function isOneGroupOccurrence(rows: GroupOccurrenceIdentity[]): boolean {
  if (rows.length < 2) return false;
  const first = rows[0];
  const sameSchedule = (row: GroupOccurrenceIdentity) =>
    row.date.getTime() === first.date.getTime() &&
    row.teacherId === first.teacherId &&
    row.location === first.location &&
    row.hours.toString() === first.hours.toString();
  if (first.bookingBatchId) {
    return rows.every(
      (row) => row.bookingBatchId === first.bookingBatchId && sameSchedule(row),
    );
  }
  if (first.groupId) {
    return rows.every(
      (row) => !row.bookingBatchId && row.groupId === first.groupId && sameSchedule(row),
    );
  }
  return rows.every(
    (row) =>
      !row.groupId &&
      row.createdAt.getTime() === first.createdAt.getTime() &&
      sameSchedule(row),
  );
}

/** Cancel every per-student row belonging to one group-booking occurrence. */
export async function cancelGroupOccurrence(
  locale: string,
  input: z.infer<typeof bulkCancelSchema>,
): Promise<BulkCancelResult> {
  if (await guard()) return { error: "forbidden" };
  const parsed = bulkCancelSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };

  const ids = [...new Set(parsed.data.sessionIds)];
  if (ids.length !== parsed.data.sessionIds.length) return { error: "invalid" };
  const rows = await db.session.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      date: true,
      hours: true,
      teacherId: true,
      location: true,
      groupId: true,
      bookingBatchId: true,
      status: true,
      createdAt: true,
    },
  });
  if (rows.length !== ids.length) return { error: "notfound" };

  const first = rows[0];
  if (!isOneGroupOccurrence(rows)) return { error: "invalidGroupOccurrence" };

  const active = rows.filter((row) => row.status !== "CANCELLED");
  if (active.some((row) => !canCancelSession(row.status))) {
    return { error: "badSessionTransition" };
  }
  if (active.length === 0) return { ok: true, cancelled: 0 };

  const frozen = await guardArchived(first.date);
  if (frozen) return { error: frozen };

  await db.$transaction(async (tx) => {
    for (const row of active) {
      await revertPackageHours(tx, row.id);
      await tx.paymentAllocation.deleteMany({ where: { sessionId: row.id } });
      await tx.session.update({
        where: { id: row.id },
        data: {
          status: "CANCELLED",
          paymentStatus: "PAID",
          autoCompleted: false,
          needsTeacher: false,
        },
      });
    }
  });

  for (const row of active) {
    await flagTripsForSession(row.id, "SESSION_CANCELLED");
    await writeAudit("Session", row.id, "UPDATE", {
      after: { status: "CANCELLED", bulkGroupCancellation: true },
    });
    await notifySession("SESSION_CANCELLED", row.id);
  }

  for (const path of ["sessions", "calendar", "payments", "accounting", "dashboard"]) {
    revalidatePath(`/${locale}/${path}`);
  }
  return { ok: true, cancelled: active.length };
}

const updateGroupRosterSchema = z.object({
  sessionIds: z.array(z.string().min(1)).min(2).max(200),
  studentIds: z.array(z.string().min(1)).min(1).max(200),
});

export type UpdateGroupRosterResult = ActionState & { added?: number; removed?: number };

/** Replace the active roster for one group-session occurrence. */
export async function updateGroupOccurrenceRoster(
  locale: string,
  input: z.infer<typeof updateGroupRosterSchema>,
): Promise<UpdateGroupRosterResult> {
  if (await guard()) return { error: "forbidden" };
  const parsed = updateGroupRosterSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const sessionIds = [...new Set(parsed.data.sessionIds)];
  const desiredStudentIds = [...new Set(parsed.data.studentIds)];
  if (sessionIds.length !== parsed.data.sessionIds.length) return { error: "invalid" };

  const rows = await db.session.findMany({
    where: { id: { in: sessionIds } },
    select: {
      id: true,
      studentId: true,
      status: true,
      date: true,
      hours: true,
      teacherId: true,
      location: true,
      groupId: true,
      bookingBatchId: true,
      createdAt: true,
      subjectId: true,
      sessionType: true,
    },
  });
  if (rows.length !== sessionIds.length) return { error: "notfound" };
  if (!isOneGroupOccurrence(rows)) return { error: "invalidGroupOccurrence" };
  const first = rows[0];
  if (!first.teacherId) return { error: "invalid" };
  const frozen = await guardArchived(first.date);
  if (frozen) return { error: frozen };

  const activeRows = rows.filter((row) => row.status !== "CANCELLED");
  const activeByStudent = new Map(activeRows.map((row) => [row.studentId, row]));
  const desired = new Set(desiredStudentIds);
  const removals = activeRows.filter((row) => !desired.has(row.studentId));
  const additionIds = desiredStudentIds.filter((studentId) => !activeByStudent.has(studentId));
  if (
    (removals.length > 0 || additionIds.length > 0) &&
    activeRows.some((row) => !canCancelSession(row.status))
  ) {
    return { error: "badSessionTransition" };
  }

  const students = await db.student.findMany({
    where: { id: { in: additionIds }, active: true },
    select: { id: true, gradeLevelId: true },
  });
  if (students.length !== additionIds.length) return { error: "notfound" };
  if (students.some((student) => !student.gradeLevelId)) return { error: "noGrade" };

  const batchId = first.bookingBatchId ?? randomUUID();
  const savedGroup = first.groupId
    ? await db.studentGroup.findUnique({
        where: { id: first.groupId },
        select: {
          defaultPricePerHour: true,
          members: {
            where: { studentId: { in: additionIds } },
            select: { studentId: true, pricePerHour: true },
          },
        },
      })
    : null;
  const memberPrices = new Map(
    (savedGroup?.members ?? []).map((member) => [member.studentId, member.pricePerHour]),
  );

  const additions: {
    date: Date;
    studentId: string;
    teacherId: string;
    gradeLevelId: string;
    location: string;
    hours: number;
    pricePerHour: number;
    total: number;
    paymentStatus: string;
    groupId: string | null;
    bookingBatchId: string;
    subjectId: string | null;
    sessionType: string;
  }[] = [];
  for (const student of students) {
    const clash = await findBlockingOverlap({
      id: null,
      teacherId: first.teacherId,
      studentId: student.id,
      date: first.date,
      hours: Number(first.hours),
      groupId: first.groupId,
      bookingBatchId: batchId,
      ignoreTeacherConflicts: true,
    });
    if (clash) {
      return {
        error: "studentBusy",
        detail: `${clash.studentName} — ${clash.startsAt.toISOString().slice(11, 16)}`,
      };
    }
    const agreed = memberPrices.get(student.id) ?? savedGroup?.defaultPricePerHour ?? null;
    const pricePerHour =
      agreed === null
        ? await resolvePricePerHour(
            student.gradeLevelId!,
            first.location as "CENTER" | "HOME",
            first.date,
          )
        : Number(agreed);
    additions.push({
      date: first.date,
      studentId: student.id,
      teacherId: first.teacherId,
      gradeLevelId: student.gradeLevelId!,
      location: first.location,
      hours: Number(first.hours),
      pricePerHour,
      total: pricePerHour * Number(first.hours),
      paymentStatus: "UNPAID",
      groupId: first.groupId,
      bookingBatchId: batchId,
      subjectId: first.subjectId,
      sessionType: first.sessionType,
    });
  }

  const created = await db.$transaction(async (tx) => {
    await tx.session.updateMany({
      where: { id: { in: sessionIds } },
      data: { bookingBatchId: batchId },
    });
    for (const row of removals) {
      await revertPackageHours(tx, row.id);
      await tx.paymentAllocation.deleteMany({ where: { sessionId: row.id } });
      await tx.session.update({
        where: { id: row.id },
        data: {
          status: "CANCELLED",
          paymentStatus: "PAID",
          autoCompleted: false,
          needsTeacher: false,
        },
      });
    }
    const newRows = [];
    for (const data of additions) newRows.push(await tx.session.create({ data }));
    return newRows;
  });

  for (const row of removals) {
    await flagTripsForSession(row.id, "SESSION_CANCELLED");
    await writeAudit("Session", row.id, "UPDATE", {
      after: { status: "CANCELLED", removedFromGroupOccurrence: batchId },
    });
    await notifySession("SESSION_CANCELLED", row.id);
  }
  for (const row of created) {
    await writeAudit("Session", row.id, "CREATE", {
      after: { addedToGroupOccurrence: batchId },
    });
    await notifySession("SESSION_BOOKED", row.id);
  }
  await writeAudit("GroupOccurrence", batchId, "UPDATE", {
    after: { added: created.length, removed: removals.length, students: desiredStudentIds.length },
  });
  for (const path of ["sessions", "calendar", "payments", "accounting", "dashboard"]) {
    revalidatePath(`/${locale}/${path}`);
  }
  return { ok: true, added: created.length, removed: removals.length };
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
  // The saved group this booking was loaded from, stamped on every created
  // session so the group 360 can list its lessons.
  groupId: z.string().optional().nullable(),
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
    groupId: string | null; bookingBatchId: string;
  }[] = [];
  const skippedStudents = new Set<string>();

  for (const dateStr of dates) {
    const date = combineDateTime(dateStr, d.time);
    // Recurrences are separate teaching occurrences even though they were
    // submitted together, so each date gets its own calendar/cancellation key.
    const bookingBatchId = randomUUID();
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
        groupId: d.groupId ?? null,
        bookingBatchId,
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

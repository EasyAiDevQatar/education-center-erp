"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { combineDateTime } from "@/lib/session-time";
import { LEAD_STATUSES } from "@/lib/leads";
import { LOCATIONS } from "@/lib/enums";

export type LeadState = { ok?: boolean; error?: string; id?: string };

async function guard() {
  const s = await getSession();
  return !s || !STAFF_ROLES.includes(s.role);
}

function revalidate(locale: string) {
  revalidatePath(`/${locale}/leads`);
  revalidatePath(`/${locale}`);
}

const leadSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  source: z.string().trim().max(60).optional().nullable(),
  status: z.enum(LEAD_STATUSES).default("NEW"),
  gradeLevelId: z.string().trim().optional().nullable(),
  followUpAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export async function saveLead(
  locale: string,
  id: string | null,
  input: z.infer<typeof leadSchema>,
): Promise<LeadState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const data = {
    name: d.name,
    phone: d.phone || null,
    email: d.email || null,
    source: d.source || null,
    status: d.status,
    gradeLevelId: d.gradeLevelId || null,
    followUpAt: d.followUpAt ? new Date(`${d.followUpAt}T00:00:00.000Z`) : null,
    notes: d.notes || null,
  };

  const lead = id
    ? await db.lead.update({ where: { id }, data })
    : await db.lead.create({ data });

  await writeAudit("Lead", lead.id, id ? "UPDATE" : "CREATE", { after: data });
  revalidate(locale);
  return { ok: true, id: lead.id };
}

const moveSchema = z.object({ id: z.string().min(1), status: z.enum(LEAD_STATUSES) });

/** Drag-and-drop between board columns. */
export async function moveLead(
  locale: string,
  input: z.infer<typeof moveSchema>,
): Promise<LeadState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };

  await db.lead.update({
    where: { id: parsed.data.id },
    data: { status: parsed.data.status },
  });
  await writeAudit("Lead", parsed.data.id, "UPDATE", { after: { status: parsed.data.status } });
  revalidate(locale);
  return { ok: true };
}

export async function deleteLead(locale: string, id: string): Promise<LeadState> {
  if (await guard()) return { error: "forbidden" };
  // Detach any trial sessions first — the lesson happened, so keep the record.
  await db.session.updateMany({ where: { leadId: id }, data: { leadId: null } });
  await db.lead.delete({ where: { id } });
  await writeAudit("Lead", id, "DELETE", {});
  revalidate(locale);
  return { ok: true };
}

/* ---------------- trial sessions ---------------- */

const trialSchema = z.object({
  leadId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  teacherId: z.string().min(1),
  gradeLevelId: z.string().min(1),
  location: z.enum(LOCATIONS),
  hours: z.coerce.number().min(0.25).max(12),
  /** A trial needs a Student row to hang off; we create a placeholder. */
  studentId: z.string().optional().nullable(),
});

/**
 * Book a free trial lesson for a lead.
 *
 * The session is a zero-price DRAFT: it appears on the calendar and planner so
 * the teacher's day is accurate, but contributes nothing to the ledger or
 * payroll (both already exclude DRAFT). A placeholder Student is created and
 * marked inactive so the trial has something to attach to without polluting the
 * active roster — converting the lead promotes that same record.
 */
export async function bookTrialSession(
  locale: string,
  input: z.infer<typeof trialSchema>,
): Promise<LeadState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = trialSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const lead = await db.lead.findUnique({ where: { id: d.leadId } });
  if (!lead) return { error: "notfound" };

  // Reuse the lead's student if one already exists (second trial, or converted).
  let studentId = lead.studentId;
  if (!studentId) {
    const placeholder = await db.student.create({
      data: {
        name: lead.name,
        phone: lead.phone,
        gradeLevelId: d.gradeLevelId,
        active: false,
        notes: `TRIAL — lead ${lead.id}`,
      },
    });
    studentId = placeholder.id;
    await db.lead.update({ where: { id: lead.id }, data: { studentId } });
  }

  const session = await db.session.create({
    data: {
      date: combineDateTime(d.date, d.time),
      studentId,
      teacherId: d.teacherId,
      gradeLevelId: d.gradeLevelId,
      location: d.location,
      hours: d.hours,
      pricePerHour: 0,
      total: 0,
      paymentStatus: "PAID", // nothing to collect
      status: "DRAFT",
      isTrial: true,
      leadId: lead.id,
    },
  });

  // Booking a trial is itself a pipeline event.
  if (lead.status === "NEW" || lead.status === "CONTACTED") {
    await db.lead.update({ where: { id: lead.id }, data: { status: "TRIAL" } });
  }

  await writeAudit("Session", session.id, "CREATE", {
    after: { isTrial: true, leadId: lead.id },
  });
  revalidate(locale);
  revalidatePath(`/${locale}/calendar`);
  revalidatePath(`/${locale}/planner`);
  return { ok: true, id: session.id };
}

/* ---------------- conversion ---------------- */

const convertSchema = z.object({
  leadId: z.string().min(1),
  gradeLevelId: z.string().trim().optional().nullable(),
  guardianName: z.string().trim().optional().nullable(),
  guardianPhone: z.string().trim().optional().nullable(),
});

/**
 * Turn a lead into a real student.
 *
 * If trials were already booked, the placeholder student is promoted rather
 * than duplicated, so the trial history follows the student into enrolment.
 */
export async function convertLead(
  locale: string,
  input: z.infer<typeof convertSchema>,
): Promise<LeadState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = convertSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const lead = await db.lead.findUnique({ where: { id: d.leadId } });
  if (!lead) return { error: "notfound" };
  if (lead.status === "ENROLLED") return { error: "alreadyConverted" };

  const gradeLevelId = d.gradeLevelId || lead.gradeLevelId || null;

  // Optional guardian, created only when a name was supplied.
  let guardianId: string | null = null;
  if (d.guardianName) {
    const guardian = await db.guardian.create({
      data: { name: d.guardianName, phone: d.guardianPhone || null },
    });
    guardianId = guardian.id;
  }

  const studentId = lead.studentId;
  const student = studentId
    ? await db.student.update({
        where: { id: studentId },
        data: {
          active: true,
          gradeLevelId,
          guardianId,
          notes: lead.notes,
        },
      })
    : await db.student.create({
        data: {
          name: lead.name,
          phone: lead.phone,
          gradeLevelId,
          guardianId,
          active: true,
          notes: lead.notes,
        },
      });

  await db.lead.update({
    where: { id: lead.id },
    data: { status: "ENROLLED", studentId: student.id },
  });

  await writeAudit("Lead", lead.id, "UPDATE", {
    after: { status: "ENROLLED", studentId: student.id, converted: true },
  });
  revalidate(locale);
  revalidatePath(`/${locale}/students`);
  return { ok: true, id: student.id };
}

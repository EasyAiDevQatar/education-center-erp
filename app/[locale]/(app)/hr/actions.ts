"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { HR_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import {
  DEPARTMENTS,
  EMPLOYEE_STATUSES,
  CONTRACT_TYPES,
  EMPLOYEE_DOC_TYPES,
} from "@/lib/enums";
import { WPS_BANKS } from "@/lib/wps/banks";

export type ActionState = { ok?: boolean; error?: string };

async function guard() {
  const s = await getSession();
  return !s || !HR_ROLES.includes(s.role);
}

/** Empty strings from the form become null — an unset QID must be absent,
    not "" (which would collide on the unique index the second time). */
function orNull(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

function dateOrNull(v: FormDataEntryValue | null): Date | null {
  const s = orNull(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00.000Z`);
}

const BANK_CODES = WPS_BANKS.map((b) => b.code) as [string, ...string[]];

/**
 * Everything except `name` is optional: an employee record must be creatable
 * on the hire date, before a QID is issued. The WPS export validates presence
 * at export time instead, so HR is never blocked from recording a new hire.
 */
const schema = z.object({
  name: z.string().trim().min(1),
  nameEn: z.string().trim().max(120).optional().nullable(),
  employeeNo: z.string().trim().max(20).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
  qid: z.string().trim().regex(/^\d{11}$/).optional().nullable(),
  visaId: z.string().trim().max(12).optional().nullable(),
  passportNo: z.string().trim().max(20).optional().nullable(),
  nationality: z.string().trim().max(60).optional().nullable(),
  jobTitle: z.string().trim().max(80).optional().nullable(),
  department: z.enum(DEPARTMENTS).optional().nullable(),
  contractType: z.enum(CONTRACT_TYPES).optional().nullable(),
  status: z.enum(EMPLOYEE_STATUSES).default("ACTIVE"),
  iban: z
    .string()
    .trim()
    .toUpperCase()
    // Qatari IBAN is exactly 29 chars (QA + 2 check + 4 bank + 21 account).
    .regex(/^QA\d{2}[A-Z0-9]{25}$/)
    .optional()
    .nullable(),
  bankShortName: z.enum(BANK_CODES).optional().nullable(),
  basicSalary: z.coerce.number().min(0).default(0),
  allowances: z.coerce.number().min(0).default(0),
  teacherId: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export async function saveEmployee(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = schema.safeParse({
    name: formData.get("name"),
    nameEn: orNull(formData.get("nameEn")),
    employeeNo: orNull(formData.get("employeeNo")),
    phone: orNull(formData.get("phone")),
    email: orNull(formData.get("email")),
    qid: orNull(formData.get("qid")),
    visaId: orNull(formData.get("visaId")),
    passportNo: orNull(formData.get("passportNo")),
    nationality: orNull(formData.get("nationality")),
    jobTitle: orNull(formData.get("jobTitle")),
    department: orNull(formData.get("department")),
    contractType: orNull(formData.get("contractType")),
    status: formData.get("status") || "ACTIVE",
    iban: orNull(formData.get("iban")),
    bankShortName: orNull(formData.get("bankShortName")),
    basicSalary: formData.get("basicSalary") || 0,
    allowances: formData.get("allowances") || 0,
    teacherId: orNull(formData.get("teacherId")),
    notes: orNull(formData.get("notes")),
  });
  if (!parsed.success) {
    // Name the first failing field — "invalid" on a 20-field form is useless.
    const field = parsed.error.issues[0]?.path[0];
    return { error: field ? `invalid_${String(field)}` : "invalid" };
  }
  const data = {
    ...parsed.data,
    dob: dateOrNull(formData.get("dob")),
    hireDate: dateOrNull(formData.get("hireDate")),
  };

  try {
    if (id) {
      await db.employee.update({ where: { id }, data });
      await writeAudit("Employee", id, "UPDATE", { after: data });
    } else {
      const created = await db.employee.create({ data });
      await writeAudit("Employee", created.id, "CREATE", { after: data });
    }
  } catch (e) {
    // The unique indexes (qid, employeeNo, teacherId) surface here.
    if ((e as { code?: string }).code === "P2002") return { error: "duplicate" };
    throw e;
  }

  revalidatePath(`/${locale}/hr`);
  return { ok: true };
}

/**
 * Terminate rather than delete: an employee with payslips, documents and leave
 * history is a legal record. endDate also stops leave accrual (lib/leave.ts).
 */
export async function terminateEmployee(
  locale: string,
  id: string,
  lastWorkingDay: string,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const end = dateOrNull(lastWorkingDay);
  if (!end) return { error: "invalid" };
  await db.employee.update({
    where: { id },
    data: { status: "TERMINATED", endDate: end },
  });
  await writeAudit("Employee", id, "UPDATE", {
    after: { status: "TERMINATED", endDate: lastWorkingDay },
  });
  revalidatePath(`/${locale}/hr`);
  return { ok: true };
}

/* ------------------------------------------------------------- documents */

const docSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(EMPLOYEE_DOC_TYPES),
  number: z.string().trim().max(40).optional().nullable(),
  // A link to the scan in the centre's own storage. Validated as a URL so a
  // typo doesn't become an unopenable "document" nobody notices until renewal.
  fileUrl: z.string().trim().url().max(500).optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export async function saveDocument(
  locale: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = docSchema.safeParse({
    employeeId: formData.get("employeeId"),
    type: formData.get("type"),
    number: orNull(formData.get("number")),
    fileUrl: orNull(formData.get("fileUrl")),
    notes: orNull(formData.get("notes")),
  });
  if (!parsed.success) return { error: "invalid" };

  // Always a new row — a renewal must not overwrite the old document's dates,
  // or the history of what was valid when is lost.
  const created = await db.employeeDocument.create({
    data: {
      ...parsed.data,
      issuedOn: dateOrNull(formData.get("issuedOn")),
      expiresOn: dateOrNull(formData.get("expiresOn")),
    },
  });
  await writeAudit("EmployeeDocument", created.id, "CREATE", { after: parsed.data });
  revalidatePath(`/${locale}/hr`);
  return { ok: true };
}

export async function deleteDocument(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  await db.employeeDocument.delete({ where: { id } });
  await writeAudit("EmployeeDocument", id, "DELETE");
  revalidatePath(`/${locale}/hr`);
  return { ok: true };
}

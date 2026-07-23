"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { transportEnabled } from "@/lib/transport/settings";
import { shiftIsValid } from "@/lib/transport/fleet";

export type ActionState = { ok?: boolean; error?: string };

async function guard() {
  const s = await getSession();
  if (!s || !STAFF_ROLES.includes(s.role)) return true;
  return !(await transportEnabled());
}

function orNull(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

function dateOrNull(v: FormDataEntryValue | null): Date | null {
  const s = orNull(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00.000Z`);
}

/** "HH:MM" → minutes from midnight; blank stays null (= no shift set). */
function minutesOrNull(v: FormDataEntryValue | null): number | null {
  const s = orNull(v);
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]);
  return total >= 0 && total <= 24 * 60 ? total : null;
}

const schema = z.object({
  employeeId: z.string().min(1),
  licenceNo: z.string().trim().max(60).nullable(),
  defaultVehicleId: z.string().min(1).nullable(),
  active: z.coerce.boolean().default(true),
  notes: z.string().trim().max(500).nullable(),
});

export async function saveDriver(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = schema.safeParse({
    employeeId: formData.get("employeeId"),
    licenceNo: orNull(formData.get("licenceNo")),
    defaultVehicleId: orNull(formData.get("defaultVehicleId")),
    active: formData.get("active") === "on" || formData.get("active") === "true",
    notes: orNull(formData.get("notes")),
  });
  if (!parsed.success) return { error: "invalid" };

  const shiftStartMin = minutesOrNull(formData.get("shiftStartMin"));
  const shiftEndMin = minutesOrNull(formData.get("shiftEndMin"));
  // Reject a back-to-front window rather than storing one the allocator will
  // silently ignore — a driver who looks rostered but never gets a leg is worse
  // than an error message.
  if ((shiftStartMin !== null || shiftEndMin !== null) && !shiftIsValid(shiftStartMin, shiftEndMin)) {
    return { error: "invalidShift" };
  }

  const data = {
    ...parsed.data,
    licenceExpiry: dateOrNull(formData.get("licenceExpiry")),
    shiftStartMin,
    shiftEndMin,
  };

  // One Driver row per employee: the role is layered onto the person, not a
  // second identity. Report the clash instead of hitting the unique index.
  const clash = await db.driver.findFirst({
    where: { employeeId: data.employeeId, ...(id ? { NOT: { id } } : {}) },
    select: { id: true },
  });
  if (clash) return { error: "driverExists" };

  if (id) {
    await db.driver.update({ where: { id }, data });
    await writeAudit("Driver", id, "UPDATE", { after: data });
  } else {
    const created = await db.driver.create({ data });
    await writeAudit("Driver", created.id, "CREATE", { after: data });
  }
  revalidatePath(`/${locale}/transport/drivers`);
  return { ok: true };
}

export async function deleteDriver(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  // Deleting the driving role never touches the Employee record behind it.
  await db.driver.delete({ where: { id } });
  await writeAudit("Driver", id, "DELETE");
  revalidatePath(`/${locale}/transport/drivers`);
  return { ok: true };
}

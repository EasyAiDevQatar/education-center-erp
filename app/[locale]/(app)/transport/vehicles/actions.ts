"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { VEHICLE_DOC_TYPES } from "@/lib/enums";
import { transportEnabled } from "@/lib/transport/settings";

export type ActionState = { ok?: boolean; error?: string };

/** Staff role AND the module flag — the nav item being hidden is only UX. */
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

const schema = z.object({
  // Plates are compared by humans and unique in the DB; normalise case and
  // inner spacing so "12345 " and "12345" can't both be created.
  plate: z.string().trim().min(1).max(20).transform((s) => s.toUpperCase().replace(/\s+/g, " ")),
  make: z.string().trim().max(60).nullable(),
  model: z.string().trim().max(60).nullable(),
  year: z.coerce.number().int().min(1950).max(2100).nullable(),
  capacity: z.coerce.number().int().min(1).max(60).default(4),
  odometerKm: z.coerce.number().int().min(0).max(5_000_000).default(0),
  active: z.coerce.boolean().default(true),
  notes: z.string().trim().max(500).nullable(),
});

export async function saveVehicle(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = schema.safeParse({
    plate: formData.get("plate"),
    make: orNull(formData.get("make")),
    model: orNull(formData.get("model")),
    year: orNull(formData.get("year")),
    capacity: formData.get("capacity") || 4,
    odometerKm: formData.get("odometerKm") || 0,
    active: formData.get("active") === "on" || formData.get("active") === "true",
    notes: orNull(formData.get("notes")),
  });
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  // The plate is the natural key: report the clash instead of letting the
  // unique index surface as a raw Prisma error.
  const clash = await db.vehicle.findFirst({
    where: { plate: d.plate, ...(id ? { NOT: { id } } : {}) },
    select: { id: true },
  });
  if (clash) return { error: "plateTaken" };

  if (id) {
    await db.vehicle.update({ where: { id }, data: d });
    await writeAudit("Vehicle", id, "UPDATE", { after: d });
  } else {
    const created = await db.vehicle.create({ data: d });
    await writeAudit("Vehicle", created.id, "CREATE", { after: d });
  }
  revalidatePath(`/${locale}/transport/vehicles`);
  return { ok: true };
}

export async function deleteVehicle(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const vehicle = await db.vehicle.findUnique({
    where: { id },
    include: { _count: { select: { drivers: true } } },
  });
  if (!vehicle) return { error: "notfound" };
  // A vehicle someone is assigned to stays for the record — deactivate it.
  if (vehicle._count.drivers > 0) return { error: "vehicleInUse" };
  await db.vehicle.delete({ where: { id } });
  await writeAudit("Vehicle", id, "DELETE");
  revalidatePath(`/${locale}/transport/vehicles`);
  return { ok: true };
}

const docSchema = z.object({
  vehicleId: z.string().min(1),
  type: z.enum(VEHICLE_DOC_TYPES),
  number: z.string().trim().max(60).nullable(),
  notes: z.string().trim().max(300).nullable(),
});

export async function saveVehicleDocument(
  locale: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = docSchema.safeParse({
    vehicleId: formData.get("vehicleId"),
    type: formData.get("type"),
    number: orNull(formData.get("number")),
    notes: orNull(formData.get("notes")),
  });
  if (!parsed.success) return { error: "invalid" };

  // Always a new row: a renewal must not overwrite the previous document's
  // dates, or the record of what was valid when is lost.
  const created = await db.vehicleDocument.create({
    data: {
      ...parsed.data,
      issuedOn: dateOrNull(formData.get("issuedOn")),
      expiresOn: dateOrNull(formData.get("expiresOn")),
    },
  });
  await writeAudit("VehicleDocument", created.id, "CREATE", { after: parsed.data });
  revalidatePath(`/${locale}/transport/vehicles`);
  return { ok: true };
}

export async function deleteVehicleDocument(
  locale: string,
  id: string,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  await db.vehicleDocument.delete({ where: { id } });
  await writeAudit("VehicleDocument", id, "DELETE");
  revalidatePath(`/${locale}/transport/vehicles`);
  return { ok: true };
}

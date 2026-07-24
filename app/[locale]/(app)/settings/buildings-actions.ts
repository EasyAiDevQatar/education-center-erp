"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";

export type ActionState = { ok?: boolean; error?: string };

async function adminOnly() {
  const s = await getSession();
  return s && s.role === "ADMIN" ? s : null;
}

const num = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const buildingSchema = z.object({
  name: z.string().min(1),
  nameEn: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sortOrder: z.coerce.number().int().default(0),
  active: z.boolean().default(true),
});

export async function saveBuilding(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await adminOnly())) return { error: "forbidden" };
  const parsed = buildingSchema.safeParse({
    name: formData.get("name"),
    nameEn: formData.get("nameEn")?.toString().trim() || null,
    address: formData.get("address")?.toString().trim() || null,
    notes: formData.get("notes")?.toString().trim() || null,
    sortOrder: num(formData.get("sortOrder")),
    active: formData.get("active") === "on" || formData.get("active") === "true",
  });
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;
  if (id) {
    await db.building.update({ where: { id }, data });
    await writeAudit("Building", id, "UPDATE", { after: { name: data.name } });
  } else {
    const b = await db.building.create({ data });
    await writeAudit("Building", b.id, "CREATE", { after: { name: data.name } });
  }
  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}

export async function deleteBuilding(locale: string, id: string): Promise<ActionState> {
  if (!(await adminOnly())) return { error: "forbidden" };
  await db.building.delete({ where: { id } });
  await writeAudit("Building", id, "DELETE");
  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}

const floorSchema = z.object({
  buildingId: z.string().min(1),
  name: z.string().min(1),
  level: z.coerce.number().int().default(0),
  notes: z.string().optional().nullable(),
  // "" clears, "__KEEP__" leaves the stored image untouched, else a data URL.
  mapUrl: z.string().optional().nullable(),
});

export async function saveFloor(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await adminOnly())) return { error: "forbidden" };
  const parsed = floorSchema.safeParse({
    buildingId: formData.get("buildingId"),
    name: formData.get("name"),
    level: num(formData.get("level")),
    notes: formData.get("notes")?.toString().trim() || null,
    mapUrl: formData.get("mapUrl")?.toString() ?? "",
  });
  if (!parsed.success) return { error: "invalid" };
  const { mapUrl, ...rest } = parsed.data;

  const mapData: { mapUrl?: string | null } =
    mapUrl === "__KEEP__" ? {} : { mapUrl: mapUrl ? mapUrl : null };

  if (id) {
    await db.floor.update({ where: { id }, data: { ...rest, ...mapData } });
    await writeAudit("Floor", id, "UPDATE", { after: { name: rest.name } });
  } else {
    const f = await db.floor.create({ data: { ...rest, mapUrl: mapUrl && mapUrl !== "__KEEP__" ? mapUrl : null } });
    await writeAudit("Floor", f.id, "CREATE", { after: { name: rest.name } });
  }
  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}

export async function deleteFloor(locale: string, id: string): Promise<ActionState> {
  if (!(await adminOnly())) return { error: "forbidden" };
  await db.floor.delete({ where: { id } });
  await writeAudit("Floor", id, "DELETE");
  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { transportEnabled } from "@/lib/transport/settings";
import { accountingEnabled } from "@/lib/accounting/journal-data";
import { MAINTENANCE_KINDS } from "@/lib/enums";

export type ActionState = { ok?: boolean; error?: string };

async function guard() {
  const s = await getSession();
  if (!s || !STAFF_ROLES.includes(s.role)) return true;
  return !(await transportEnabled());
}

const orNull = (v: FormDataEntryValue | null) => {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
};
const intOrNull = (v: FormDataEntryValue | null) => {
  const s = orNull(v);
  if (s === null) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const dateOrNull = (v: FormDataEntryValue | null) => {
  const s = orNull(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00.000Z`);
};

/**
 * Which expense category fleet costs land in.
 *
 * Resolved server-side rather than asked for in the form: the person logging a
 * fill-up is a coordinator, not a bookkeeper. Preference order is explicit so
 * the choice is auditable — the account-mapped category wins, because that is
 * what actually decides the journal line when accounting is on.
 */
async function fleetCategoryId(): Promise<string | null> {
  const byAccount = await db.expenseCategory.findFirst({
    where: { active: true, account: { code: "5100" } },
    select: { id: true },
  });
  if (byAccount) return byAccount.id;
  const byName = await db.expenseCategory.findFirst({
    where: { active: true, OR: [{ nameAr: { contains: "مواصلات" } }, { nameAr: { contains: "بترول" } }] },
    select: { id: true },
  });
  if (byName) return byName.id;
  const any = await db.expenseCategory.findFirst({ where: { active: true }, select: { id: true } });
  return any?.id ?? null;
}

/**
 * Create the Expense behind a fuel or maintenance log.
 *
 * Mirrors saveExpense: with accounting on the expense starts DRAFT and reaches
 * the journal only through the normal approval, so fleet costs cannot sneak
 * onto the books by a side door.
 */
async function createLinkedExpense(input: {
  date: Date;
  description: string;
  amount: number;
  supplierId: string | null;
}): Promise<string | null> {
  const categoryId = await fleetCategoryId();
  if (!categoryId) return null; // no categories configured yet — log still saves
  const posting = await accountingEnabled();
  const expense = await db.expense.create({
    data: {
      date: input.date,
      description: input.description,
      categoryId,
      amount: input.amount,
      supplierId: input.supplierId,
      status: posting ? "DRAFT" : "APPROVED",
    },
  });
  return expense.id;
}

/** Move the vehicle's odometer forward, never backward. */
async function bumpOdometer(vehicleId: string, reading: number | null) {
  if (reading == null) return;
  const v = await db.vehicle.findUnique({ where: { id: vehicleId }, select: { odometerKm: true } });
  // A lower reading is a typo or a retrospective entry; either way the vehicle
  // has not travelled backwards.
  if (v && reading > v.odometerKm) {
    await db.vehicle.update({ where: { id: vehicleId }, data: { odometerKm: reading } });
  }
}

const fuelSchema = z.object({
  vehicleId: z.string().min(1),
  litres: z.coerce.number().positive().max(10_000),
  cost: z.coerce.number().min(0).max(1_000_000),
  supplierId: z.string().min(1).nullable(),
  notes: z.string().trim().max(300).nullable(),
});

export async function saveFuelLog(
  locale: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = fuelSchema.safeParse({
    vehicleId: formData.get("vehicleId"),
    litres: formData.get("litres"),
    cost: formData.get("cost"),
    supplierId: orNull(formData.get("supplierId")),
    notes: orNull(formData.get("notes")),
  });
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  const date = dateOrNull(formData.get("date")) ?? new Date();
  const odometerKm = intOrNull(formData.get("odometerKm"));

  const vehicle = await db.vehicle.findUnique({
    where: { id: d.vehicleId },
    select: { plate: true },
  });
  if (!vehicle) return { error: "notfound" };

  const expenseId = await createLinkedExpense({
    date,
    description: `${locale === "ar" ? "وقود" : "Fuel"} — ${vehicle.plate}`,
    amount: d.cost,
    supplierId: d.supplierId,
  });

  const created = await db.fuelLog.create({
    data: { ...d, date, odometerKm, expenseId },
  });
  await bumpOdometer(d.vehicleId, odometerKm);
  await writeAudit("FuelLog", created.id, "CREATE", { after: { ...d, odometerKm } });
  revalidatePath(`/${locale}/transport/costs`);
  revalidatePath(`/${locale}/expenses`);
  return { ok: true };
}

export async function deleteFuelLog(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  // The expense is left alone on purpose: it may already be posted, and money
  // that reached the books is removed through the expenses screen, not here.
  await db.fuelLog.delete({ where: { id } });
  await writeAudit("FuelLog", id, "DELETE");
  revalidatePath(`/${locale}/transport/costs`);
  return { ok: true };
}

const maintSchema = z.object({
  vehicleId: z.string().min(1),
  kind: z.enum(MAINTENANCE_KINDS),
  description: z.string().trim().min(1).max(300),
  cost: z.coerce.number().min(0).max(1_000_000),
  supplierId: z.string().min(1).nullable(),
  notes: z.string().trim().max(300).nullable(),
});

export async function saveMaintenanceLog(
  locale: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = maintSchema.safeParse({
    vehicleId: formData.get("vehicleId"),
    kind: formData.get("kind"),
    description: formData.get("description"),
    cost: formData.get("cost"),
    supplierId: orNull(formData.get("supplierId")),
    notes: orNull(formData.get("notes")),
  });
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  const date = dateOrNull(formData.get("date")) ?? new Date();
  const odometerKm = intOrNull(formData.get("odometerKm"));

  const vehicle = await db.vehicle.findUnique({
    where: { id: d.vehicleId },
    select: { plate: true },
  });
  if (!vehicle) return { error: "notfound" };

  const expenseId = await createLinkedExpense({
    date,
    description: `${d.description} — ${vehicle.plate}`,
    amount: d.cost,
    supplierId: d.supplierId,
  });

  const created = await db.maintenanceLog.create({
    data: {
      ...d,
      date,
      odometerKm,
      expenseId,
      nextDueKm: intOrNull(formData.get("nextDueKm")),
      nextDueOn: dateOrNull(formData.get("nextDueOn")),
    },
  });
  await bumpOdometer(d.vehicleId, odometerKm);
  await writeAudit("MaintenanceLog", created.id, "CREATE", { after: { ...d, odometerKm } });
  revalidatePath(`/${locale}/transport/costs`);
  revalidatePath(`/${locale}/expenses`);
  return { ok: true };
}

export async function deleteMaintenanceLog(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  await db.maintenanceLog.delete({ where: { id } });
  await writeAudit("MaintenanceLog", id, "DELETE");
  revalidatePath(`/${locale}/transport/costs`);
  return { ok: true };
}

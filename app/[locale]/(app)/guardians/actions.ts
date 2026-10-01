"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { autoFillNameEn } from "@/lib/ai/translate-names";
import {
  parseBulkGuardianStudents,
  parseGuardianHomes,
  selectGuardianHome,
  type GuardianHomeInput,
} from "@/lib/guardian-homes";

export type GuardianHomeResult = {
  id: string;
  label: string;
  address: string | null;
  homeCode: string | null;
  homeLat: number | null;
  homeLng: number | null;
  isDefault: boolean;
  sortOrder: number;
};

export type CreatedGuardianResult = {
  id: string;
  name: string;
  nameEn: string | null;
  homes: GuardianHomeResult[];
};

export type ActionState = {
  ok?: boolean;
  error?: string;
  createdGuardian?: CreatedGuardianResult;
  count?: number;
};

const guardianSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().max(254).optional().nullable(),
  notes: z.string().trim().max(1_000).optional().nullable(),
});

/** Empty strings from forms are absent values in the database. */
function orNull(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

async function staffSession() {
  const session = await getSession();
  return session && STAFF_ROLES.includes(session.role) ? session : null;
}

class ActionFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function homeData(home: GuardianHomeInput, sortOrder: number) {
  return {
    label: home.label,
    address: home.address,
    homeCode: home.homeCode,
    homeLat: home.homeLat,
    homeLng: home.homeLng,
    isDefault: home.isDefault,
    sortOrder,
  };
}

function publicGuardian(guardian: {
  id: string;
  name: string;
  nameEn: string | null;
  homes: GuardianHomeResult[];
}): CreatedGuardianResult {
  return {
    id: guardian.id,
    name: guardian.name,
    nameEn: guardian.nameEn,
    homes: guardian.homes.map((home) => ({
      id: home.id,
      label: home.label,
      address: home.address,
      homeCode: home.homeCode,
      homeLat: home.homeLat,
      homeLng: home.homeLng,
      isDefault: home.isDefault,
      sortOrder: home.sortOrder,
    })),
  };
}

export async function saveGuardian(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffSession();
  if (!session) return { error: "forbidden" };

  const parsed = guardianSchema.safeParse({
    name: formData.get("name"),
    nameEn: orNull(formData.get("nameEn")),
    phone: orNull(formData.get("phone")),
    email: orNull(formData.get("email")),
    notes: orNull(formData.get("notes")),
  });
  if (!parsed.success) return { error: "invalid" };
  const parsedHomes = parseGuardianHomes(formData.get("homesJson"));
  if (!parsedHomes.ok) return { error: parsedHomes.error };

  try {
    const saved = await db.$transaction(async (tx) => {
      if (!id) {
        const guardian = await tx.guardian.create({
          data: {
            ...parsed.data,
            homes: {
              create: parsedHomes.value.map((home, index) => homeData(home, index)),
            },
          },
          include: { homes: { orderBy: { sortOrder: "asc" } } },
        });
        await tx.auditLog.create({
          data: {
            userId: session.userId,
            entity: "Guardian",
            entityId: guardian.id,
            action: "CREATE",
            after: JSON.stringify({ ...parsed.data, homes: guardian.homes }),
          },
        });
        return { guardian, created: true as const };
      }

      const before = await tx.guardian.findUnique({
        where: { id },
        include: { homes: { orderBy: { sortOrder: "asc" } } },
      });
      if (!before) throw new ActionFailure("notfound");

      const existingIds = new Set(before.homes.map((home) => home.id));
      const suppliedIds = parsedHomes.value.flatMap((home) => (home.id ? [home.id] : []));
      if (
        new Set(suppliedIds).size !== suppliedIds.length ||
        suppliedIds.some((homeId) => !existingIds.has(homeId))
      ) {
        throw new ActionFailure("invalid");
      }

      await tx.guardian.update({ where: { id }, data: parsed.data });

      const retainedIds = new Set(suppliedIds);
      const removedIds = before.homes
        .map((home) => home.id)
        .filter((homeId) => !retainedIds.has(homeId));
      if (removedIds.length) {
        await tx.guardianHome.deleteMany({ where: { guardianId: id, id: { in: removedIds } } });
      }

      for (const [index, home] of parsedHomes.value.entries()) {
        if (home.id) {
          const updated = await tx.guardianHome.updateMany({
            where: { id: home.id, guardianId: id },
            data: homeData(home, index),
          });
          if (updated.count !== 1) throw new ActionFailure("invalid");
        } else {
          await tx.guardianHome.create({
            data: { guardianId: id, ...homeData(home, index) },
          });
        }
      }

      const guardian = await tx.guardian.findUniqueOrThrow({
        where: { id },
        include: { homes: { orderBy: { sortOrder: "asc" } } },
      });
      await tx.auditLog.create({
        data: {
          userId: session.userId,
          entity: "Guardian",
          entityId: id,
          action: "UPDATE",
          before: JSON.stringify(before),
          after: JSON.stringify(guardian),
        },
      });
      return { guardian, created: false as const };
    });

    if (saved.created) {
      await autoFillNameEn(
        "guardians",
        saved.guardian.id,
        saved.guardian.name,
        saved.guardian.nameEn,
      );
    }

    revalidatePath(`/${locale}/guardians`);
    revalidatePath(`/${locale}/guardians/${saved.guardian.id}`);
    return saved.created
      ? { ok: true, createdGuardian: publicGuardian(saved.guardian) }
      : { ok: true };
  } catch (error) {
    return { error: error instanceof ActionFailure ? error.code : "invalid" };
  }
}

export async function bulkCreateGuardianStudents(
  locale: string,
  guardianId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffSession();
  if (!session) return { error: "forbidden" };

  const parsedRows = parseBulkGuardianStudents(formData.get("studentsJson"));
  if (!parsedRows.ok) return { error: parsedRows.error };
  const requestedHomeId = orNull(formData.get("guardianHomeId"));

  try {
    const created = await db.$transaction(async (tx) => {
      const guardian = await tx.guardian.findUnique({
        where: { id: guardianId },
        include: { homes: { orderBy: { sortOrder: "asc" } } },
      });
      if (!guardian) throw new ActionFailure("notfound");

      const selectedHome = selectGuardianHome(guardian.homes, requestedHomeId);
      if (!selectedHome.ok) throw new ActionFailure(selectedHome.error);
      const home = selectedHome.value;

      const gradeIds = [
        ...new Set(parsedRows.value.flatMap((row) => (row.gradeLevelId ? [row.gradeLevelId] : []))),
      ];
      if (gradeIds.length) {
        const validGradeCount = await tx.gradeLevel.count({
          where: { id: { in: gradeIds }, active: true },
        });
        if (validGradeCount !== gradeIds.length) throw new ActionFailure("invalidGrade");
      }

      const students: { id: string; name: string; nameEn: string | null }[] = [];
      for (const row of parsedRows.value) {
        const student = await tx.student.create({
          data: {
            name: row.name,
            nameEn: row.nameEn,
            gradeLevelId: row.gradeLevelId,
            gradeYear: row.gradeYear,
            guardianId,
            address: home?.address ?? null,
            homeCode: home?.homeCode ?? null,
            homeLat: home?.homeLat ?? null,
            homeLng: home?.homeLng ?? null,
            active: true,
            studyLocation: "CENTER",
          },
          select: { id: true, name: true, nameEn: true },
        });
        students.push(student);
        await tx.auditLog.create({
          data: {
            userId: session.userId,
            entity: "Student",
            entityId: student.id,
            action: "CREATE",
            after: JSON.stringify({
              ...row,
              guardianId,
              copiedGuardianHomeId: home?.id ?? null,
              address: home?.address ?? null,
              homeCode: home?.homeCode ?? null,
              homeLat: home?.homeLat ?? null,
              homeLng: home?.homeLng ?? null,
            }),
          },
        });
      }
      return students;
    });

    await Promise.all(
      created.map((student) =>
        autoFillNameEn("students", student.id, student.name, student.nameEn),
      ),
    );

    revalidatePath(`/${locale}/guardians`);
    revalidatePath(`/${locale}/guardians/${guardianId}`);
    revalidatePath(`/${locale}/students`);
    return { ok: true, count: created.length };
  } catch (error) {
    return { error: error instanceof ActionFailure ? error.code : "invalid" };
  }
}

export async function deleteGuardian(locale: string, id: string): Promise<ActionState> {
  const session = await staffSession();
  if (!session) return { error: "forbidden" };
  const linked = await db.student.count({ where: { guardianId: id } });
  if (linked > 0) return { error: "linked" };

  try {
    await db.$transaction(async (tx) => {
      const guardian = await tx.guardian.findUnique({ where: { id }, include: { homes: true } });
      if (!guardian) throw new ActionFailure("notfound");
      await tx.guardian.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: session.userId,
          entity: "Guardian",
          entityId: id,
          action: "DELETE",
          before: JSON.stringify(guardian),
        },
      });
    });
    revalidatePath(`/${locale}/guardians`);
    return { ok: true };
  } catch (error) {
    return { error: error instanceof ActionFailure ? error.code : "invalid" };
  }
}

import "server-only";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import type { GroupOpt } from "@/app/[locale]/(app)/sessions/group-booking-dialog";

/**
 * Active saved groups ("courses") shaped for the booking dialogs.
 *
 * Shared by the sessions page and the calendar so the two can never drift —
 * the calendar once mapped its own student options, dropped `gradeYear`, and
 * silently broke the grade filter in the dialog it hosted.
 */
export async function loadGroupOpts(): Promise<GroupOpt[]> {
  const groups = await db.studentGroup.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    include: { members: { select: { studentId: true, pricePerHour: true } } },
  });
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    teacherId: g.teacherId,
    location: g.location as "CENTER" | "HOME",
    gradeLevelId: g.gradeLevelId,
    defaultPricePerHour: g.defaultPricePerHour === null ? null : toNumber(g.defaultPricePerHour),
    members: g.members.map((m) => ({
      studentId: m.studentId,
      pricePerHour: m.pricePerHour === null ? null : toNumber(m.pricePerHour),
    })),
  }));
}

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const noShow = await prisma.setting.findUnique({ where: { key: "noShowPolicy" } });
  const sessions = await prisma.session.findMany({
    where: {
      OR: [
        { studentCheckInAt: { not: null }, studentCheckOutAt: { not: null } },
        { status: { in: ["COMPLETED", "NO_SHOW"] }, billableHours: null },
      ],
    },
    select: {
      id: true,
      status: true,
      hours: true,
      billableHours: true,
      studentCheckInAt: true,
      studentCheckOutAt: true,
    },
  });

  let actualUpdated = 0;
  let billableUpdated = 0;
  for (const session of sessions) {
    const data: { actualHours?: number; billableHours?: number } = {};
    if (session.studentCheckInAt && session.studentCheckOutAt) {
      const minutes = Math.max(
        0,
        Math.round(
          (session.studentCheckOutAt.getTime() - session.studentCheckInAt.getTime()) / 60_000,
        ),
      );
      data.actualHours = minutes / 60;
      actualUpdated++;
    }
    if (
      session.billableHours == null &&
      (session.status === "COMPLETED" ||
        (session.status === "NO_SHOW" && noShow?.value === "TAUGHT"))
    ) {
      // Before billable snapshots existed, finalized sessions always used the
      // booked duration. Preserve that financial history during the upgrade.
      data.billableHours = session.hours.toNumber();
      billableUpdated++;
    }
    if (Object.keys(data).length > 0) {
      await prisma.session.update({ where: { id: session.id }, data });
    }
  }

  console.log(
    `Attendance duration backfill complete: ${actualUpdated} actual, ${billableUpdated} billable.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

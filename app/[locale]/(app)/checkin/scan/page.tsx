import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { ScanStation, type ScanRow } from "./scan-station";

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Dedicated scanning screen for the reception device.
 *
 * Separate from the roster board so a tablet can sit on this page all day
 * without anyone navigating away, and so the camera keeps running between
 * students instead of being torn down with a dialog.
 */
export default async function ScanPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("checkin");
  const day = ymd(new Date());
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(`${day}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  const [todays, settingsRows] = await Promise.all([
    db.session.findMany({
      where: { date: { gte: start, lt: end }, status: { not: "DRAFT" } },
      include: { student: true, teacher: true },
      orderBy: { date: "asc" },
    }),
    db.setting.findMany({ where: { key: { in: ["attendanceWalkIn", "attendancePickSession"] } } }),
  ]);
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));

  const rows: ScanRow[] = todays.map((s) => ({
    id: s.id,
    studentName: s.student.name,
    teacherName: s.teacher?.name ?? null,
    startMin: s.date.getUTCHours() * 60 + s.date.getUTCMinutes(),
    hours: toNumber(s.hours),
    status: s.status,
  }));

  return (
    <div>
      <PageHeader title={t("scanTitle")} description={t("scanSubtitle")} />
      <ScanStation
        day={day}
        recent={rows}
        pickSession={settings.attendancePickSession === "true"}
        walkInMode={settings.attendanceWalkIn ?? "FLAG"}
      />
    </div>
  );
}

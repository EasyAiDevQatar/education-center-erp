import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { CheckinClient, type CheckinItem } from "./checkin-client";

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function CheckinPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("checkin");
  const sp = await searchParams;
  const dParam = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const day = dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam) ? dParam : ymd(new Date());

  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(`${day}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  const sessions = await db.session.findMany({
    // Planner drafts are pending confirmation — not attendable at the kiosk.
    where: { date: { gte: start, lt: end }, status: { not: "DRAFT" } },
    include: { student: true, teacher: true, gradeLevel: true },
    orderBy: { date: "asc" },
  });

  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);
  // Check-in/out are real instants — display them in the center's local time
  // (Qatar) rather than UTC. This can become a configurable setting later.
  const hm = (d: Date | null) =>
    d
      ? d.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "Asia/Qatar",
        })
      : null;

  const items: CheckinItem[] = sessions.map((s) => ({
    id: s.id,
    studentName: s.student.name,
    teacherName: s.teacher.name,
    levelLabel: label(s.gradeLevel.nameAr, s.gradeLevel.nameEn),
    location: s.location as "CENTER" | "HOME",
    startMinutes: s.date.getUTCHours() * 60 + s.date.getUTCMinutes(),
    hours: toNumber(s.hours),
    status: s.status,
    checkedInAt: hm(s.studentCheckInAt),
    checkedOutAt: hm(s.studentCheckOutAt),
    hasPin: !!s.student.checkinPin,
    homeLat: s.student.homeLat ?? null,
    homeLng: s.student.homeLng ?? null,
  }));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <CheckinClient day={day} items={items} />
    </div>
  );
}

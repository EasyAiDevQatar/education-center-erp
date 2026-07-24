import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, HR_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import { EXPIRY_WINDOW_DAYS, daysUntil, expiryLevel, latestPerType } from "@/lib/transport/fleet";
import { PageHeader } from "@/components/page-header";
import { ExpiringDocsClient, type ExpiringRow } from "./expiring-client";

/**
 * Every document that has lapsed or is about to, across employees and vehicles.
 *
 * The HR banner used to be the only place these appeared, as inert chips. This
 * is the screen you work from: filterable, sortable, and every row links to the
 * record where the renewal is entered.
 */
export default async function ExpiringDocumentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, HR_ROLES);
  const t = await getTranslations("expiringDocs");

  const [employees, vehicles] = await Promise.all([
    db.employee.findMany({
      where: { status: { not: "TERMINATED" } },
      include: { documents: true },
    }),
    db.vehicle.findMany({ where: { active: true }, include: { documents: true } }),
  ]);

  const today = new Date();

  // Only the newest document of each type counts: a renewed passport must not
  // keep shouting because the superseded row is still on file.
  const rows: ExpiringRow[] = [
    ...employees.flatMap((e) =>
      latestPerType(e.documents).map((d) => ({
        id: d.id,
        ownerKind: "employee" as const,
        ownerId: e.id,
        ownerName: displayName(e, locale),
        // The staff number, not the job title: a centre can easily have three
        // people called "محاسب 5", and only the number tells them apart.
        ownerHint: e.employeeNo ? `#${e.employeeNo}` : e.jobTitle,
        type: d.type,
        number: d.number,
        expiresOn: d.expiresOn?.toISOString().slice(0, 10) ?? null,
        days: daysUntil(d.expiresOn, today),
        level: expiryLevel(d.expiresOn, today),
      })),
    ),
    ...vehicles.flatMap((v) =>
      latestPerType(v.documents).map((d) => ({
        id: d.id,
        ownerKind: "vehicle" as const,
        ownerId: v.id,
        ownerName: v.plate,
        ownerHint: [v.make, v.model].filter(Boolean).join(" ") || null,
        type: d.type,
        number: d.number,
        expiresOn: d.expiresOn?.toISOString().slice(0, 10) ?? null,
        days: daysUntil(d.expiresOn, today),
        level: expiryLevel(d.expiresOn, today),
      })),
    ),
  ]
    // Undated documents are surfaced too: "we never recorded an expiry" is a
    // gap worth closing, not a clean bill of health.
    .filter((r) => r.level !== "ok")
    .sort((a, b) => (a.days ?? 99_999) - (b.days ?? 99_999));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle", { days: EXPIRY_WINDOW_DAYS })} />
      <ExpiringDocsClient rows={rows} />
    </div>
  );
}

import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, HR_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { displayName } from "@/lib/names";
import { PageHeader } from "@/components/page-header";
import { HrClient, type EmployeeRow, type ExpiryRow, type DocRow } from "./hr-client";

/** Documents flagged this many days ahead of expiry. */
const EXPIRY_WINDOW_DAYS = 60;

export default async function HrPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, HR_ROLES);

  const t = await getTranslations("hr");

  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + EXPIRY_WINDOW_DAYS);

  const [employees, teachers, expiring] = await Promise.all([
    db.employee.findMany({
      orderBy: { name: "asc" },
      include: { documents: { orderBy: { expiresOn: "asc" } }, teacher: true },
    }),
    db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.employeeDocument.findMany({
      where: { expiresOn: { lte: horizon }, employee: { status: { not: "TERMINATED" } } },
      include: { employee: true },
      orderBy: { expiresOn: "asc" },
    }),
  ]);

  const rows: EmployeeRow[] = employees.map((e) => ({
    id: e.id,
    name: e.name,
    nameEn: e.nameEn,
    employeeNo: e.employeeNo,
    phone: e.phone,
    email: e.email,
    qid: e.qid,
    visaId: e.visaId,
    passportNo: e.passportNo,
    nationality: e.nationality,
    dob: e.dob?.toISOString().slice(0, 10) ?? null,
    hireDate: e.hireDate?.toISOString().slice(0, 10) ?? null,
    jobTitle: e.jobTitle,
    department: e.department,
    contractType: e.contractType,
    status: e.status,
    iban: e.iban,
    bankShortName: e.bankShortName,
    basicSalary: toNumber(e.basicSalary),
    allowances: toNumber(e.allowances),
    teacherId: e.teacherId,
    notes: e.notes,
    documents: e.documents.map(
      (d): DocRow => ({
        id: d.id,
        type: d.type,
        number: d.number,
        issuedOn: d.issuedOn?.toISOString().slice(0, 10) ?? null,
        expiresOn: d.expiresOn?.toISOString().slice(0, 10) ?? null,
        notes: d.notes,
      }),
    ),
  }));

  // Latest document per (employee, type) decides the alert — an expired QID
  // that has already been renewed must not keep shouting.
  const latest = new Map<string, (typeof expiring)[number]>();
  for (const d of await db.employeeDocument.findMany({
    where: { employee: { status: { not: "TERMINATED" } } },
    orderBy: [{ expiresOn: "desc" }],
  })) {
    const k = `${d.employeeId}:${d.type}`;
    if (!latest.has(k)) latest.set(k, d as (typeof expiring)[number]);
  }
  const alerts: ExpiryRow[] = expiring
    .filter((d) => latest.get(`${d.employeeId}:${d.type}`)?.id === d.id)
    .map((d) => ({
      id: d.id,
      employeeName: displayName(d.employee, locale),
      type: d.type,
      number: d.number,
      expiresOn: d.expiresOn!.toISOString().slice(0, 10),
    }));

  // Teachers not yet linked to an employee, for the link picker. The teacher
  // already linked to the record being edited stays selectable client-side.
  const linked = new Set(employees.map((e) => e.teacherId).filter(Boolean));
  const teacherOpts = teachers.map((x) => ({
    id: x.id,
    label: displayName(x, locale),
    taken: linked.has(x.id),
  }));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <HrClient employees={rows} teachers={teacherOpts} alerts={alerts} />
    </div>
  );
}

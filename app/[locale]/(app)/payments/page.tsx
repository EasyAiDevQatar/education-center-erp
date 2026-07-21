import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { PaymentsClient, type PaymentRow, type Opt } from "./payments-client";
import { displayName } from "@/lib/names";

export default async function PaymentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("payments");

  const [payments, students, teachers, settingsRows] = await Promise.all([
    db.payment.findMany({
      orderBy: { date: "desc" },
      take: 500,
      include: { student: true, teacher: true },
    }),
    db.student.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.setting.findMany({ where: { key: "currency" } }),
  ]);

  const currency = settingsRows[0]?.value ?? "QAR";
  const rows: PaymentRow[] = payments.map((p) => ({
    id: p.id,
    date: p.date.toISOString().slice(0, 10),
    receiptNo: p.receiptNo,
    studentId: p.studentId,
    studentName: p.student ? displayName(p.student, locale) : "—",
    amount: toNumber(p.amount),
    method: p.method,
    teacherId: p.teacherId,
    teacherName: p.teacher ? displayName(p.teacher, locale) : "—",
    notes: p.notes,
  }));
  const studentOpts: Opt[] = students.map((s) => ({ id: s.id, label: displayName(s, locale) }));
  const teacherOpts: Opt[] = teachers.map((t) => ({ id: t.id, label: displayName(t, locale) }));

  return (
    <div>
      <PageHeader title={t("title")} />
      <PaymentsClient
        payments={rows}
        students={studentOpts}
        teachers={teacherOpts}
        currency={currency}
        locale={locale}
      />
    </div>
  );
}

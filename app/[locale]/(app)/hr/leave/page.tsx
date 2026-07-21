import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, HR_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { displayName } from "@/lib/names";
import { PageHeader } from "@/components/page-header";
import { ensureLeaveTypes, getLeaveBalances } from "@/lib/leave-data";
import { LeaveClient, type RequestRow } from "./leave-client";

export default async function LeavePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, HR_ROLES);

  const t = await getTranslations("leave");
  await ensureLeaveTypes();

  const today = new Date().toISOString().slice(0, 10);
  const [balances, requests, types, employees] = await Promise.all([
    getLeaveBalances(today),
    db.leaveRequest.findMany({
      include: { employee: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.leaveType.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.employee.findMany({
      where: { status: { not: "TERMINATED" } },
      orderBy: { name: "asc" },
    }),
  ]);

  const requestRows: RequestRow[] = requests.map((r) => ({
    id: r.id,
    employeeName: displayName(r.employee, locale),
    typeCode: r.typeCode,
    startDate: r.startDate.toISOString().slice(0, 10),
    endDate: r.endDate.toISOString().slice(0, 10),
    days: toNumber(r.days),
    status: r.status,
    reason: r.reason,
  }));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <LeaveClient
        balances={balances.map((b) => ({
          ...b,
          name: displayName(b, locale),
        }))}
        requests={requestRows}
        types={types.map((x) => ({
          code: x.code,
          label: locale === "ar" ? x.nameAr : x.nameEn,
        }))}
        employees={employees.map((e) => ({ id: e.id, label: displayName(e, locale) }))}
      />
    </div>
  );
}

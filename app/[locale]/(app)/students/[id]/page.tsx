import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { getStudentBalance, getStudentLedger } from "@/lib/balances";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { LedgerTable } from "./ledger-table";

export default async function StudentLedgerPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const student = await db.student.findUnique({
    where: { id },
    include: { gradeLevel: true, guardian: true },
  });
  if (!student) notFound();

  const t = await getTranslations("students");
  const settingsRow = await db.setting.findUnique({ where: { key: "currency" } });
  const currency = settingsRow?.value ?? "QAR";

  const [balance, ledger] = await Promise.all([
    getStudentBalance(id),
    getStudentLedger(id),
  ]);

  return (
    <div>
      <PageHeader
        title={student.name}
        description={
          student.gradeLevel
            ? locale === "ar"
              ? student.gradeLevel.nameAr
              : student.gradeLevel.nameEn
            : undefined
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t("totalCharges")} value={formatMoney(balance.totalCharges)} suffix={currency} icon={TrendingUp} />
        <StatCard label={t("totalPaid")} value={formatMoney(balance.totalPaid)} suffix={currency} icon={TrendingDown} tone="success" />
        <StatCard
          label={t("balance")}
          value={formatMoney(balance.balance)}
          suffix={currency}
          icon={Wallet}
          tone={balance.balance > 0 ? "destructive" : "success"}
        />
      </div>

      <LedgerTable ledger={ledger} />
    </div>
  );
}

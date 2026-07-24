import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { getStudentBalance, getStudentLedger } from "@/lib/balances";
import { formatMoney, formatDate } from "@/lib/money";
import { PrintButton } from "@/components/print-button";
import { fullName } from "@/lib/names";

/** Printable A4 account statement for one student. */
export default async function StudentStatementPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  // Staff open any statement; a parent opens only their own children's.
  const session = await requireAuth(locale);

  const [student, settingsRows] = await Promise.all([
    db.student.findUnique({ where: { id }, include: { gradeLevel: true, guardian: true } }),
    db.setting.findMany(),
  ]);
  if (!student) notFound();
  if (!STAFF_ROLES.includes(session.role)) {
    if (!session.guardianId || student.guardianId !== session.guardianId) notFound();
  }

  const [balance, ledger] = await Promise.all([
    getStudentBalance(id),
    getStudentLedger(id),
  ]);

  const t = await getTranslations("students");
  const tc = await getTranslations("common");
  const tp = await getTranslations("profile");
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const currency = settings.currency ?? "QAR";

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>

      <div data-print="A4" className="rounded-lg border border-border bg-card p-8 shadow-sm">
        {/* Letterhead */}
        <div className="mb-6 flex items-start justify-between gap-4 border-b border-border pb-4">
          <div className="flex items-center gap-3">
            {settings.centerLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={settings.centerLogo} alt="" className="max-h-16 object-contain" />
            )}
            <div>
              <h1 className="text-xl font-bold">{settings.centerName ?? tc("appShort")}</h1>
              {settings.centerAddress && (
                <p className="text-xs text-muted-foreground">{settings.centerAddress}</p>
              )}
              {settings.centerPhone && (
                <p className="text-xs text-muted-foreground" dir="ltr">{settings.centerPhone}</p>
              )}
            </div>
          </div>
          <div className="text-end">
            <p className="font-semibold">{tp("statement")}</p>
            <p className="text-xs tabular-nums text-muted-foreground" dir="ltr">
              {formatDate(new Date(), locale)}
            </p>
          </div>
        </div>

        {/* Student */}
        <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">{tc("name")}: </span>
            <span className="font-medium">{fullName(student, locale)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t("gradeLevel")}: </span>
            <span>
              {student.gradeLevel
                ? locale === "ar"
                  ? student.gradeLevel.nameAr
                  : student.gradeLevel.nameEn
                : "—"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">{t("guardian")}: </span>
            <span>{student.guardian?.name ?? "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{tc("phone")}: </span>
            <span dir="ltr">{student.phone ?? student.guardian?.phone ?? "—"}</span>
          </div>
        </div>

        {/* Ledger */}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-border bg-muted/40">
              <th className="p-2">{tc("date")}</th>
              <th className="p-2">{tc("actions")}</th>
              <th className="p-2">{t("totalCharges")}</th>
              <th className="p-2">{t("totalPaid")}</th>
              <th className="p-2">{t("balance")}</th>
            </tr>
          </thead>
          <tbody>
            {ledger.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-muted-foreground">
                  {tc("noData")}
                </td>
              </tr>
            )}
            {ledger.map((e, i) => (
              <tr key={i} className="border-b border-border/60">
                <td className="p-2 tabular-nums"><span dir="ltr">{e.date}</span></td>
                <td className="p-2">{e.description}</td>
                <td className="p-2 tabular-nums">{e.debit ? formatMoney(e.debit) : "—"}</td>
                <td className="p-2 tabular-nums">{e.credit ? formatMoney(e.credit) : "—"}</td>
                <td className="p-2 tabular-nums font-medium">{formatMoney(e.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <dl className="w-64 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("totalCharges")}</dt>
              <dd className="tabular-nums">{formatMoney(balance.totalCharges)} {currency}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("totalPaid")}</dt>
              <dd className="tabular-nums">{formatMoney(balance.totalPaid)} {currency}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-1 font-semibold">
              <dt>{t("balance")}</dt>
              <dd className="tabular-nums">{formatMoney(balance.balance)} {currency}</dd>
            </div>
          </dl>
        </div>

        {settings.statementFooter && (
          <p className="mt-8 text-center text-xs text-muted-foreground">
            {settings.statementFooter}
          </p>
        )}
      </div>
    </div>
  );
}

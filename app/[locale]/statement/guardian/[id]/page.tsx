import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { getStudentBalance, getStudentLedger } from "@/lib/balances";
import { formatMoney, formatDate } from "@/lib/money";
import { PrintButton } from "@/components/print-button";
import { tokenOpens } from "@/lib/statement-token";

/**
 * Printable A4 account statement for one guardian — every child on one page.
 *
 * A family with three children had to be sent three statements and add them
 * up themselves, which is not what they asked the office for: the question is
 * always "what do I owe you", not "what does each child owe you". Each child
 * keeps their own ledger and running balance, because a parent querying a
 * figure needs to see which lesson it came from, and the family total is the
 * answer to the question they actually asked.
 */
export default async function GuardianStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const token = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  const viaLink = await tokenOpens(token, "guardian", id);

  // Staff open any family's statement; a parent opens only their own.
  const session = viaLink ? null : await requireAuth(locale);

  const [guardian, settingsRows] = await Promise.all([
    db.guardian.findUnique({
      where: { id },
      include: {
        students: {
          where: { active: true },
          include: { gradeLevel: true },
          orderBy: { name: "asc" },
        },
      },
    }),
    db.setting.findMany(),
  ]);
  if (!guardian) notFound();
  if (session && !STAFF_ROLES.includes(session.role) && session.guardianId !== id) notFound();

  const children = await Promise.all(
    guardian.students.map(async (student) => ({
      student,
      balance: await getStudentBalance(student.id),
      ledger: await getStudentLedger(student.id),
    })),
  );

  const family = children.reduce(
    (acc, c) => ({
      charges: acc.charges + c.balance.totalCharges,
      paid: acc.paid + c.balance.totalPaid,
      balance: acc.balance + c.balance.balance,
    }),
    { charges: 0, paid: 0, balance: 0 },
  );

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

        {/* Family */}
        <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">{t("guardian")}: </span>
            <span className="font-medium">{guardian.name}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{tc("phone")}: </span>
            <span dir="ltr">{guardian.phone ?? "—"}</span>
          </div>
        </div>

        {children.length === 0 && (
          <p className="p-4 text-center text-muted-foreground">{tc("noData")}</p>
        )}

        {children.map(({ student, balance, ledger }) => (
          <section key={student.id} className="mb-6">
            <h2 className="mb-1 border-b border-border pb-1 text-sm font-semibold">
              {student.name}
              {student.gradeLevel && (
                <span className="ms-2 font-normal text-muted-foreground">
                  {locale === "ar" ? student.gradeLevel.nameAr : student.gradeLevel.nameEn}
                </span>
              )}
            </h2>

            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="p-2">{tc("date")}</th>
                  <th className="p-2">{tc("description")}</th>
                  <th className="p-2">{t("totalCharges")}</th>
                  <th className="p-2">{t("totalPaid")}</th>
                  <th className="p-2">{t("balance")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-3 text-center text-muted-foreground">
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

            <div className="mt-1 flex justify-end text-xs text-muted-foreground">
              <span className="tabular-nums">
                {t("balance")}: {formatMoney(balance.balance)} {currency}
              </span>
            </div>
          </section>
        ))}

        {/* The family total — the question the parent actually asked. */}
        <div className="mt-4 flex justify-end border-t border-border pt-3">
          <dl className="w-64 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("totalCharges")}</dt>
              <dd className="tabular-nums">{formatMoney(family.charges)} {currency}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("totalPaid")}</dt>
              <dd className="tabular-nums">{formatMoney(family.paid)} {currency}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-1 font-semibold">
              <dt>{t("balance")}</dt>
              <dd className="tabular-nums">{formatMoney(family.balance)} {currency}</dd>
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

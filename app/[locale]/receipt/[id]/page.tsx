import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber, formatMoney, formatDate, formatHours } from "@/lib/money";
import { referenceCode } from "@/lib/reference-code";
import { displayName, fullName } from "@/lib/names";
import { ReceiptPrintControls, type ReceiptFormat } from "./receipt-print-controls";

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ size?: string }>;
}) {
  const { locale, id } = await params;
  const { size } = await searchParams;
  setRequestLocale(locale);
  const session = await requireAuth(locale);

  const [payment, settingsRows] = await Promise.all([
    db.payment.findUnique({
      where: { id },
      include: {
        student: true,
        teacher: true,
        allocations: { orderBy: { session: { date: "asc" } }, include: { session: { include: { teacher: true, subject: true, gradeLevel: true } } } },
      },
    }),
    db.setting.findMany(),
  ]);
  if (!payment) notFound();

  // Staff see every receipt; a parent sees only their own children's. Without
  // this, any logged-in parent could walk the id space and read other families'
  // payments.
  if (!STAFF_ROLES.includes(session.role)) {
    if (!session.guardianId || payment.student?.guardianId !== session.guardianId) notFound();
  }

  const t = await getTranslations("payments");
  const tc = await getTranslations("common");
  const te = await getTranslations("enums");
  const ts = await getTranslations("sessions");
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const currency = settings.currency ?? "QAR";

  const configured = ["POS80", "A4", "A5"].includes(settings.receiptSize)
    ? settings.receiptSize
    : "A4";
  const format = (["POS80", "A4", "A5"].includes(size ?? "") ? size : configured) as ReceiptFormat;
  const isPos = format === "POS80";
  const allocatedTotal = payment.allocations.reduce((sum, row) => sum + toNumber(row.amount), 0);
  const unallocated = Math.max(0, Math.round((toNumber(payment.amount) - allocatedTotal) * 100) / 100);

  return (
    <div className={isPos ? "mx-auto max-w-xs p-4" : format === "A5" ? "mx-auto max-w-2xl p-5" : "mx-auto max-w-4xl p-6"}>
      <ReceiptPrintControls format={format} />
      <div
        data-print={format}
        className={
          isPos
            ? "rounded-lg border border-border bg-card p-4 shadow-sm print:border-0 print:shadow-none"
            : "rounded-lg border border-border bg-card p-5 sm:p-7 shadow-sm print:border-0 print:shadow-none"
        }
      >
        <div className={isPos ? "mb-6 border-b border-border pb-4 text-center" : "mb-6 flex items-start justify-between gap-4 border-b border-border pb-4"}>
          <div className={isPos ? "text-center" : "flex items-center gap-3"}>
            {settings.centerLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={settings.centerLogo}
                alt=""
                className={isPos ? "mx-auto mb-2 max-h-16 object-contain" : "max-h-16 object-contain"}
              />
            )}
            <div>
              <h1 className="text-xl font-bold">{settings.centerName ?? tc("appShort")}</h1>
              {settings.centerAddress && (
                <p className="text-xs text-muted-foreground">{settings.centerAddress}</p>
              )}
              {settings.centerPhone && (
                <p className="text-xs text-muted-foreground" dir="ltr">{settings.centerPhone}</p>
              )}
              {settings.centerTaxNo && (
                <p className="text-xs text-muted-foreground" dir="ltr">{settings.centerTaxNo}</p>
              )}
            </div>
          </div>
          <div className={isPos ? "mt-1 text-sm text-muted-foreground" : "text-end"}>
            <p className={isPos ? undefined : "font-semibold"}>{t("receipt")}</p>
            {!isPos && (
              <>
                <p className="text-sm tabular-nums" dir="ltr">#{payment.receiptNo}</p>
                <p className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                  {formatDate(payment.date, locale)}
                </p>
              </>
            )}
          </div>
        </div>
        <dl className={isPos ? "space-y-2 text-sm" : "grid grid-cols-1 gap-x-8 gap-y-2 rounded-md bg-muted/30 p-3 text-sm sm:grid-cols-2 print:grid-cols-2"}>
          {isPos && (
            <>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("receiptNo")}</dt>
                <dd className="font-medium tabular-nums" dir="ltr">{payment.receiptNo}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{tc("date")}</dt>
                <dd className="tabular-nums" dir="ltr">{formatDate(payment.date, locale)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("student")}</dt>
            <dd className="font-medium">{payment.student ? fullName(payment.student, locale) : "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("method")}</dt>
            <dd>{te(`method.${payment.method}`)}</dd>
          </div>
          {payment.allocations.length === 0 && payment.teacher ? (
            <div className={isPos ? "flex justify-between" : "flex justify-between gap-4 sm:col-span-2"}>
              <dt className="text-muted-foreground">{t("allocateTeacher")}</dt>
              <dd>{displayName(payment.teacher, locale)}</dd>
            </div>
          ) : null}
          {payment.notes && (
            <div className={isPos ? "flex justify-between" : "flex justify-between gap-4 sm:col-span-2"}>
              <dt className="text-muted-foreground">{tc("notes")}</dt>
              <dd>{payment.notes}</dd>
            </div>
          )}
        </dl>
        <section className="mt-5" aria-label={t("receiptSessionDetails")}>
          <h2 className="mb-2 text-sm font-semibold">{t("receiptSessionDetails")}</h2>
          {payment.allocations.length === 0 ? (
            <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">{t("receiptNoSessions")}</p>
          ) : isPos ? (
            <div className="divide-y divide-border border-y border-border">
              {payment.allocations.map(({ session: lesson, amount }) => (
                <div key={lesson.id} className="space-y-1 py-2 text-xs break-inside-avoid">
                  <div className="flex justify-between gap-2"><strong dir="ltr">{referenceCode("session", lesson.referenceNo)}</strong><span dir="ltr">{formatDate(lesson.date, locale)} {lesson.date.toISOString().slice(11, 16)}</span></div>
                  <p>{lesson.teacher ? displayName(lesson.teacher, locale) : "—"} · {locale === "ar" ? lesson.gradeLevel.nameAr : lesson.gradeLevel.nameEn}</p>
                  <p>{lesson.subject ? (locale === "ar" ? lesson.subject.nameAr : lesson.subject.nameEn) : "—"} · {te(`location.${lesson.location}`)} · {formatHours(toNumber(lesson.hours))} {ts("hours")}</p>
                  <div className="flex justify-between gap-2"><span>{t("receiptSessionTotal")}</span><span dir="ltr">{formatMoney(toNumber(lesson.total))} {currency}</span></div>
                  <div className="flex justify-between gap-2 font-semibold"><span>{t("receiptPaidForSession")}</span><span dir="ltr">{formatMoney(toNumber(amount))} {currency}</span></div>
                </div>
              ))}
            </div>
          ) : (
            <table className="w-full table-fixed border-collapse text-xs">
              <thead className="bg-muted/50 text-start"><tr>
                <th className="w-[24%] border-y p-2 text-start">{ts("sessionCode")} / {tc("date")}</th>
                <th className="w-[31%] border-y p-2 text-start">{t("receiptDescription")}</th>
                <th className="w-[11%] border-y p-2 text-end">{ts("hours")}</th>
                <th className="w-[17%] border-y p-2 text-end">{t("receiptSessionTotal")}</th>
                <th className="w-[17%] border-y p-2 text-end">{t("receiptPaidForSession")}</th>
              </tr></thead>
              <tbody>{payment.allocations.map(({ session: lesson, amount }) => (
                <tr key={lesson.id} className="break-inside-avoid align-top">
                  <td className="border-b p-2"><p className="font-medium" dir="ltr">{referenceCode("session", lesson.referenceNo)}</p><p className="mt-1" dir="ltr">{formatDate(lesson.date, locale)}</p><p dir="ltr">{lesson.date.toISOString().slice(11, 16)}</p></td>
                  <td className="border-b p-2 break-words"><p className="font-medium">{lesson.teacher ? displayName(lesson.teacher, locale) : "—"}</p><p className="mt-1 text-muted-foreground">{locale === "ar" ? lesson.gradeLevel.nameAr : lesson.gradeLevel.nameEn}{lesson.subject ? ` · ${locale === "ar" ? lesson.subject.nameAr : lesson.subject.nameEn}` : ""}</p><p className="text-muted-foreground">{te(`location.${lesson.location}`)}</p></td>
                  <td className="border-b p-2 text-end tabular-nums">{formatHours(toNumber(lesson.hours))}</td>
                  <td className="border-b p-2 text-end tabular-nums"><bdi>{formatMoney(toNumber(lesson.total))}</bdi></td>
                  <td className="border-b p-2 text-end font-semibold tabular-nums"><bdi>{formatMoney(toNumber(amount))}</bdi></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{t("receiptCurrency", { currency })}</p>
        </section>
        {unallocated > 0 && <div className="mt-3 flex justify-between gap-3 text-sm"><span>{t("receiptUnallocated")}</span><span dir="ltr">{formatMoney(unallocated)} {currency}</span></div>}
        <div className="mt-4 flex items-center justify-between border-y border-border bg-muted/30 p-3 break-inside-avoid">
          <span className="font-semibold">{t("receiptTotalPaid")}</span>
          <span className="text-xl font-bold tabular-nums" dir="ltr">
            {formatMoney(toNumber(payment.amount))} <span className="text-base">{currency}</span>
          </span>
        </div>
        {settings.receiptFooter && (
          <p className="mt-5 text-center text-xs text-muted-foreground">
            {settings.receiptFooter}
          </p>
        )}
      </div>
    </div>
  );
}

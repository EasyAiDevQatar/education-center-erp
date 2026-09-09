import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber, formatMoney, formatDate } from "@/lib/money";
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
        allocations: { include: { session: { include: { teacher: true } } } },
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
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const currency = settings.currency ?? "QAR";

  const configured = ["POS80", "A4", "A5"].includes(settings.receiptSize)
    ? settings.receiptSize
    : "A4";
  const format = (["POS80", "A4", "A5"].includes(size ?? "") ? size : configured) as ReceiptFormat;
  const isPos = format === "POS80";
  const distribution = new Map<string, { id: string; name: string; amount: number }>();
  for (const allocation of payment.allocations) {
    const teacher = allocation.session.teacher;
    const key = teacher?.id ?? "none";
    const current = distribution.get(key) ?? {
      id: key,
      name: teacher ? displayName(teacher, locale) : "—",
      amount: 0,
    };
    current.amount += toNumber(allocation.amount);
    distribution.set(key, current);
  }

  return (
    <div className={isPos ? "mx-auto max-w-xs p-4" : format === "A5" ? "mx-auto max-w-2xl p-5" : "mx-auto max-w-4xl p-6"}>
      <ReceiptPrintControls format={format} />
      <div
        data-print={format}
        className={
          isPos
            ? "rounded-lg border border-border bg-card p-4 shadow-sm print:border-0 print:shadow-none"
            : "rounded-lg border border-border bg-card p-8 shadow-sm print:border-0 print:shadow-none"
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
        <dl className={isPos ? "space-y-3 text-sm" : "grid grid-cols-1 gap-x-10 gap-y-3 text-sm sm:grid-cols-2"}>
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
          {distribution.size > 0 ? (
            <div className={isPos ? "flex justify-between gap-4" : "flex justify-between gap-4 sm:col-span-2"}>
              <dt className="text-muted-foreground">{t("teacherDistribution")}</dt>
              <dd className="space-y-1 text-end">
                {[...distribution.values()].map((row) => (
                  <div key={row.id}>
                    {row.name} · <span className="tabular-nums" dir="ltr">{formatMoney(row.amount)} {currency}</span>
                  </div>
                ))}
              </dd>
            </div>
          ) : payment.teacher ? (
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
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <span className="font-semibold">{tc("amount")}</span>
          <span className="text-2xl font-bold tabular-nums">
            {formatMoney(toNumber(payment.amount))} <span className="text-base">{currency}</span>
          </span>
        </div>
        {settings.receiptFooter && (
          <p className="mt-8 text-center text-sm text-muted-foreground">
            {settings.receiptFooter}
          </p>
        )}
      </div>
    </div>
  );
}

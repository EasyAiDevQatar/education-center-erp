import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber, formatMoney, formatDate } from "@/lib/money";
import { PrintButton } from "@/components/print-button";
import { displayName, fullName } from "@/lib/names";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await requireAuth(locale);

  const [payment, settingsRows] = await Promise.all([
    db.payment.findUnique({
      where: { id },
      include: { student: true, teacher: true },
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

  const isPos = settings.receiptSize === "POS80";

  return (
    <div className={isPos ? "mx-auto max-w-xs p-4" : "mx-auto max-w-md p-6"}>
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>
      <div
        data-print={isPos ? "POS80" : "A4"}
        className={
          isPos
            ? "rounded-lg border border-border bg-card p-4 shadow-sm print:border-0 print:shadow-none"
            : "rounded-lg border border-border bg-card p-8 shadow-sm print:border-0 print:shadow-none"
        }
      >
        <div className="mb-6 border-b border-border pb-4 text-center">
          {settings.centerLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={settings.centerLogo}
              alt=""
              className="mx-auto mb-2 max-h-16 object-contain"
            />
          )}
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
          <p className="mt-1 text-sm text-muted-foreground">{t("receipt")}</p>
        </div>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("receiptNo")}</dt>
            <dd className="font-medium tabular-nums" dir="ltr">{payment.receiptNo}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{tc("date")}</dt>
            <dd className="tabular-nums" dir="ltr">{formatDate(payment.date, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("student")}</dt>
            <dd className="font-medium">{payment.student ? fullName(payment.student, locale) : "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("method")}</dt>
            <dd>{te(`method.${payment.method}`)}</dd>
          </div>
          {payment.teacher && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("allocateTeacher")}</dt>
              <dd>{displayName(payment.teacher, locale)}</dd>
            </div>
          )}
          {payment.notes && (
            <div className="flex justify-between">
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

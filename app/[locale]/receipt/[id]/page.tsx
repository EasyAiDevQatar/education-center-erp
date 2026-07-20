import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber, formatMoney, formatDate } from "@/lib/money";
import { PrintButton } from "@/components/print-button";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAuth(locale);

  const [payment, settingsRows] = await Promise.all([
    db.payment.findUnique({
      where: { id },
      include: { student: true, teacher: true },
    }),
    db.setting.findMany(),
  ]);
  if (!payment) notFound();

  const t = await getTranslations("payments");
  const tc = await getTranslations("common");
  const te = await getTranslations("enums");
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const currency = settings.currency ?? "QAR";

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="mb-4 flex justify-end">
        <PrintButton />
      </div>
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm print:border-0 print:shadow-none">
        <div className="mb-6 border-b border-border pb-4 text-center">
          <h1 className="text-xl font-bold">{settings.centerName ?? tc("appShort")}</h1>
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
            <dd className="font-medium">{payment.student?.name ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("method")}</dt>
            <dd>{te(`method.${payment.method}`)}</dd>
          </div>
          {payment.teacher && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("allocateTeacher")}</dt>
              <dd>{payment.teacher.name}</dd>
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

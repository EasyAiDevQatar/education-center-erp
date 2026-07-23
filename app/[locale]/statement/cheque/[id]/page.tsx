import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireRole, FINANCE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber, formatMoney } from "@/lib/money";
import { amountToArabicWords } from "@/lib/accounting/tafqit";
import { PrintButton } from "@/components/print-button";

type Template = {
  leafW: number;
  leafH: number;
  date: { x: number; y: number };
  payee: { x: number; y: number };
  amountWords: { x: number; y: number; w: number };
  amountDigits: { x: number; y: number };
};

const DEFAULT_TEMPLATE: Template = {
  leafW: 176,
  leafH: 89,
  date: { x: 130, y: 10 },
  payee: { x: 25, y: 28 },
  amountWords: { x: 30, y: 42, w: 120 },
  amountDigits: { x: 135, y: 42 },
};

function parseTemplate(raw: string | undefined): Template {
  if (!raw) return DEFAULT_TEMPLATE;
  try {
    return { ...DEFAULT_TEMPLATE, ...(JSON.parse(raw) as Partial<Template>) };
  } catch {
    return DEFAULT_TEMPLATE;
  }
}

/**
 * Cheque printing: the leaf goes into the printer at the top of an A4 sheet;
 * fields are absolutely positioned in millimetres from the Setting
 * `chequeTemplate`, calibrated once per bank book in the accounting settings.
 * `?test=1` renders placeholder values for calibration runs.
 */
export default async function ChequePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  await requireRole(locale, FINANCE_ROLES);
  const t = await getTranslations("cheques");

  const isTest = sp.test === "1";
  const cheque = isTest
    ? null
    : await db.cheque.findUnique({ where: { id }, include: { supplier: true } });
  if (!cheque && !isTest) notFound();

  const [templateRow, currencyRow] = await Promise.all([
    db.setting.findUnique({ where: { key: "chequeTemplate" } }),
    db.setting.findUnique({ where: { key: "currency" } }),
  ]);
  const tpl = parseTemplate(templateRow?.value);
  const currency = currencyRow?.value ?? "QAR";

  const amount = cheque ? toNumber(cheque.amount) : 12345.5;
  const payee = cheque ? (cheque.payeeName ?? cheque.supplier?.name ?? "") : "اسم المستفيد التجريبي";
  const date = (cheque?.issueDate ?? new Date()).toISOString().slice(0, 10);
  const words =
    currency === "QAR" ? amountToArabicWords(amount) : amountToArabicWords(amount, currency, "");

  const mm = (n: number) => `${n}mm`;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="no-print mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("printHint")}</p>
        <PrintButton />
      </div>

      {/* The leaf. On screen a dashed border shows the boundary; in print the
          border disappears and only the field text lands on the real cheque. */}
      <div
        data-print="A4"
        className="relative border border-dashed border-border print:border-0"
        style={{ width: mm(tpl.leafW), height: mm(tpl.leafH) }}
      >
        <div
          className="absolute text-sm tabular-nums"
          dir="ltr"
          style={{ insetInlineStart: mm(tpl.date.x), top: mm(tpl.date.y) }}
        >
          {date}
        </div>
        <div
          className="absolute text-sm font-medium"
          style={{ insetInlineStart: mm(tpl.payee.x), top: mm(tpl.payee.y) }}
        >
          {payee}
        </div>
        <div
          className="absolute text-sm"
          style={{
            insetInlineStart: mm(tpl.amountWords.x),
            top: mm(tpl.amountWords.y),
            width: mm(tpl.amountWords.w),
          }}
        >
          {words}
        </div>
        <div
          className="absolute text-sm font-semibold tabular-nums"
          dir="ltr"
          style={{ insetInlineStart: mm(tpl.amountDigits.x), top: mm(tpl.amountDigits.y) }}
        >
          {formatMoney(amount)}
        </div>
      </div>
    </div>
  );
}

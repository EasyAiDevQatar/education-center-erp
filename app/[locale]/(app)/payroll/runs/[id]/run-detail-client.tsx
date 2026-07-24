"use client";

import { useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { Printer, CheckCheck, FileDown } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { printDoc } from "@/lib/print";
import { markRunPaid } from "../actions";

export type ItemRow = {
  id: string;
  name: string;
  fullName: string;
  employeeNo: string | null;
  jobTitle: string | null;
  basicSalary: number;
  allowances: number;
  commission: number;
  deductions: number;
  advances: number;
  netPaid: number;
  workingDays: number | null;
  unpaidLeaveDays: number;
  status: string;
  paymentMethod: string | null;
  earnMode: string | null;
};

/**
 * The printed batch: one payslip per payee, one page each, with signature
 * lines. A payslip handed over for a signature is a receipt — it must carry
 * who, what, when, and a place for both parties to sign.
 */
function RunPrintSheet({
  month,
  items,
  centerName,
  centerLogo,
  currency,
  printedAt,
}: {
  month: string;
  items: ItemRow[];
  centerName: string;
  centerLogo: string;
  currency: string;
  printedAt: string;
}) {
  const t = useTranslations("runs");
  const tp = useTranslations("payroll");
  const te = useTranslations("enums");
  const tc = useTranslations("common");

  const money = (n: number) => `${formatMoney(n)} ${currency}`;

  return (
    <div data-print="A4P" className="hidden print:block">
      {items.map((p, i) => (
        <section
          key={p.id}
          className={i < items.length - 1 ? "break-after-page" : undefined}
        >
          <header className="mb-3 flex items-center justify-between gap-3 border-b-2 border-black pb-2">
            <div className="flex items-center gap-2">
              {centerLogo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={centerLogo} alt="" className="max-h-10 object-contain" />
              )}
              <div>
                <div className="text-sm font-bold">{centerName || tc("appShort")}</div>
                <div className="text-[10px]">{tp("payslip")}</div>
              </div>
            </div>
            <div className="text-end">
              <div className="text-base font-bold">{p.fullName}</div>
              <div className="text-[10px]">
                {p.jobTitle && <span>{p.jobTitle} · </span>}
                {p.employeeNo && (
                  <span dir="ltr">#{p.employeeNo} · </span>
                )}
                <span dir="ltr">{month}</span>
              </div>
            </div>
          </header>

          <table className="w-full border-collapse">
            <tbody>
              {p.basicSalary > 0 && (
                <tr>
                  <td className="w-1/2">{t("printBasic")}</td>
                  <td className="tabular-nums">{money(p.basicSalary)}</td>
                </tr>
              )}
              {p.allowances > 0 && (
                <tr>
                  <td>{t("printAllowances")}</td>
                  <td className="tabular-nums">{money(p.allowances)}</td>
                </tr>
              )}
              {p.commission > 0 && (
                <tr>
                  <td>{tp("grossCommission")}</td>
                  <td className="tabular-nums">{money(p.commission)}</td>
                </tr>
              )}
              {p.deductions > 0 && (
                <tr>
                  <td>{tp("deductions")}</td>
                  <td className="tabular-nums">− {money(p.deductions)}</td>
                </tr>
              )}
              {p.advances > 0 && (
                <tr>
                  <td>{tp("advances")}</td>
                  <td className="tabular-nums">− {money(p.advances)}</td>
                </tr>
              )}
              {p.unpaidLeaveDays > 0 && (
                <tr>
                  <td>{t("printUnpaidDays")}</td>
                  <td className="tabular-nums">{p.unpaidLeaveDays}</td>
                </tr>
              )}
              {p.workingDays !== null && (
                <tr>
                  <td>{t("printWorkingDays")}</td>
                  <td className="tabular-nums">{p.workingDays}</td>
                </tr>
              )}
              {p.paymentMethod && (
                <tr>
                  <td>{t("method")}</td>
                  <td>{te(`payslipMethod.${p.paymentMethod}`)}</td>
                </tr>
              )}
              <tr className="border-t-2 border-black">
                <td className="pt-1 text-sm font-bold">{tp("netPaid")}</td>
                <td className="pt-1 text-sm font-bold tabular-nums">
                  {money(p.netPaid)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Signatures — the reason this document exists on paper. */}
          <div className="mt-12 grid grid-cols-2 gap-10">
            <div>
              <div className="border-t border-black pt-1 text-[10px]">
                {t("signEmployee")}
              </div>
              <div className="mt-4 text-[10px]">{t("signDate")}: ____________</div>
            </div>
            <div>
              <div className="border-t border-black pt-1 text-[10px]">
                {t("signEmployer")}
              </div>
              <div className="mt-4 text-[10px]">{t("signDate")}: ____________</div>
            </div>
          </div>
        </section>
      ))}

      <footer className="print-footer">
        <span>{t("printFooter", { month })}</span>
        <span dir="auto">{printedAt}</span>
      </footer>
    </div>
  );
}

export function RunDetailClient({
  runId,
  month,
  status,
  items,
  centerName,
  centerLogo,
  currency,
}: {
  runId: string;
  month: string;
  status: string;
  items: ItemRow[];
  centerName: string;
  centerLogo: string;
  currency: string;
}) {
  const t = useTranslations("runs");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [printing, setPrinting] = useState(false);
  const [wpsIssues, setWpsIssues] = useState<{ key: string; message: string; recordIndex?: number }[] | null>(null);

  const total = items.reduce((n, i) => n + i.netPaid, 0);

  /**
   * The SIF is fetched rather than linked: a validation failure returns 422
   * with the issue list, and a plain anchor would show the user raw JSON.
   */
  const downloadWps = () =>
    start(async () => {
      setWpsIssues(null);
      const res = await fetch(`/api/wps/${runId}`);
      if (res.status === 422) {
        const body = (await res.json()) as { issues: { key: string; message: string; recordIndex?: number }[] };
        setWpsIssues(body.issues);
        return;
      }
      if (!res.ok) {
        setWpsIssues([{ key: "http", message: String(res.status) }]);
        return;
      }
      const blob = await res.blob();
      const name =
        res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        `SIF-${month}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    });

  const doPrint = () => {
    // flushSync commits the sheet before print; rAF never fires on a hidden
    // page and a plain setState prints an empty document.
    flushSync(() => setPrinting(true));
    try {
      printDoc({
        size: "A4 portrait",
        margin: { top: 10, side: 12, bottom: 18 },
        fileName: `Payslips-${month}`,
      });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <Badge variant={status === "PAID" ? "success" : "warning"}>
          {te(`runStatus.${status}`)}
        </Badge>
        <Badge variant="default">
          {tc("total")}: {formatMoney(total)} {currency}
        </Badge>
        <div className="ms-auto flex gap-2">
          <Button variant="secondary" className="gap-1" onClick={doPrint}>
            <Printer className="size-4" />
            {t("printAll")}
          </Button>
          <Button variant="secondary" className="gap-1" disabled={pending} onClick={downloadWps}>
            <FileDown className="size-4" />
            {t("wpsExport")}
          </Button>
          {status !== "PAID" && (
            <Button
              className="gap-1"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await markRunPaid(locale, runId);
                  router.refresh();
                })
              }
            >
              <CheckCheck className="size-4" />
              {t("markAllPaid")}
            </Button>
          )}
        </div>
      </div>

      {wpsIssues && (
        <div className="no-print rounded-lg border border-destructive/50 bg-destructive/5 p-3">
          <p className="mb-1 text-sm font-semibold text-destructive">{t("wpsBlocked")}</p>
          <ul className="list-inside list-disc space-y-0.5 text-sm">
            {wpsIssues.map((i, n) => (
              <li key={n}>
                {i.recordIndex !== undefined && items[i.recordIndex]
                  ? `${items[i.recordIndex].name}: `
                  : ""}
                {t.has(`wpsIssues.${i.key}`) ? t(`wpsIssues.${i.key}`) : `${i.key} — ${i.message}`}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">{t("wpsBlockedHint")}</p>
        </div>
      )}

      <div className="no-print rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tc("name")}</TableHead>
              <TableHead>{t("printBasic")}</TableHead>
              <TableHead>{t("printAllowances")}</TableHead>
              <TableHead>{t("commission")}</TableHead>
              <TableHead>{t("deductionsCol")}</TableHead>
              <TableHead>{t("net")}</TableHead>
              <TableHead>{t("printWorkingDays")}</TableHead>
              <TableHead>{tc("status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">
                  {p.name}
                  {p.jobTitle && (
                    <span className="ms-1 text-xs text-muted-foreground">· {p.jobTitle}</span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">
                  {p.basicSalary ? formatMoney(p.basicSalary) : "—"}
                </TableCell>
                <TableCell className="tabular-nums">
                  {p.allowances ? formatMoney(p.allowances) : "—"}
                </TableCell>
                <TableCell className="tabular-nums">
                  {p.commission ? formatMoney(p.commission) : "—"}
                </TableCell>
                <TableCell className="tabular-nums">
                  {p.deductions ? formatMoney(p.deductions) : "—"}
                </TableCell>
                <TableCell className="tabular-nums font-semibold">
                  {formatMoney(p.netPaid)}
                </TableCell>
                <TableCell className="tabular-nums">{p.workingDays ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={p.status === "PAID" ? "success" : "warning"}>
                    {te(`payoutStatus.${p.status}`)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {printing && (
        <RunPrintSheet
          month={month}
          items={items}
          centerName={centerName}
          centerLogo={centerLogo}
          currency={currency}
          printedAt={new Date().toLocaleString(locale === "ar" ? "ar-QA" : "en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        />
      )}
    </div>
  );
}

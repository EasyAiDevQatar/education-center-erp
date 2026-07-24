import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BadgeCheck, CalendarDays, Phone, Mail, Wallet, FileText } from "lucide-react";
import { requireRole, HR_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { formatMoney, toNumber } from "@/lib/money";
import { displayName, fullName } from "@/lib/names";
import { expiryLevel, latestPerType } from "@/lib/transport/fleet";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { ProfileTabs } from "@/components/profile-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DocumentLink } from "./document-link";

/** Colour for an expiry bucket. `unknown` is never green. */
function levelVariant(level: string) {
  if (level === "expired") return "destructive" as const;
  if (level === "soon") return "warning" as const;
  if (level === "unknown") return "muted" as const;
  return "success" as const;
}

export default async function EmployeeProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireRole(locale, HR_ROLES);

  const t = await getTranslations("hr");
  const tc = await getTranslations("common");
  const te = await getTranslations("enums");

  const employee = await db.employee.findUnique({
    where: { id },
    include: {
      teacher: true,
      documents: { orderBy: [{ type: "asc" }, { expiresOn: "desc" }] },
      leave: { orderBy: { startDate: "desc" }, take: 50 },
      payslips: { orderBy: { periodStart: "desc" }, take: 50 },
      driver: { include: { defaultVehicle: true } },
    },
  });
  if (!employee) notFound();

  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "overview";

  const today = new Date();
  const ymd = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

  // Only the newest row per type decides whether the employee's papers are in
  // order — a renewal must silence the row it replaced.
  const current = latestPerType(employee.documents);
  const problems = current.filter((d) => {
    const level = expiryLevel(d.expiresOn, today);
    return level === "expired" || level === "soon";
  });

  const basePath = `/hr/${id}`;
  const tabs = [
    { key: "overview", label: tc("overview") },
    { key: "documents", label: t("documents"), count: employee.documents.length },
    { key: "leave", label: t("leaveTab"), count: employee.leave.length },
    { key: "payslips", label: t("payslipsTab"), count: employee.payslips.length },
  ];

  const gross = toNumber(employee.basicSalary) + toNumber(employee.allowances);

  return (
    <div>
      <PageHeader
        title={fullName(employee, locale)}
        description={[employee.jobTitle, employee.employeeNo && `#${employee.employeeNo}`]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("basicSalary")} value={formatMoney(gross)} icon={Wallet} />
        <StatCard
          label={tc("status")}
          value={te(`employeeStatus.${employee.status}`)}
          icon={BadgeCheck}
          tone={employee.status === "ACTIVE" ? "success" : "default"}
        />
        <StatCard label={t("hireDate")} value={ymd(employee.hireDate) ?? "—"} icon={CalendarDays} />
        <StatCard
          label={t("documentsNeedingAttention")}
          value={String(problems.length)}
          icon={FileText}
          tone={problems.length > 0 ? "destructive" : "success"}
        />
      </div>

      <ProfileTabs tabs={tabs} active={tab} basePath={basePath} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("identity")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {[
                [t("qid"), employee.qid],
                [t("nationality"), employee.nationality],
                [t("passportNo"), employee.passportNo],
                [t("dob"), ymd(employee.dob)],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="tabular-nums">
                    <span dir="ltr">{value || "—"}</span>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("contact")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Phone className="size-3.5" />
                  {tc("phone")}
                </span>
                {employee.phone ? (
                  <a href={`tel:${employee.phone}`} className="text-primary hover:underline">
                    <span dir="ltr">{employee.phone}</span>
                  </a>
                ) : (
                  <span>—</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Mail className="size-3.5" />
                  {t("email")}
                </span>
                <span dir="ltr">{employee.email || "—"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{t("department")}</span>
                <span>{employee.department ? te(`department.${employee.department}`) : "—"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{t("contractType")}</span>
                <span>
                  {employee.contractType ? te(`contractType.${employee.contractType}`) : "—"}
                </span>
              </div>
              {employee.driver && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{t("driverRole")}</span>
                  <span dir="ltr">{employee.driver.defaultVehicle?.plate ?? "✓"}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "documents" && (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docType")}</TableHead>
                <TableHead>{t("docNumber")}</TableHead>
                <TableHead>{t("issuedOn")}</TableHead>
                <TableHead>{t("expiresOn")}</TableHead>
                <TableHead>{tc("status")}</TableHead>
                <TableHead className="text-end">{tc("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employee.documents.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {tc("noData")}
                  </TableCell>
                </TableRow>
              )}
              {employee.documents.map((d) => {
                const level = expiryLevel(d.expiresOn, today);
                // A row superseded by a newer document of the same type is
                // history, not a problem to chase.
                const superseded = !current.some((c) => c.id === d.id);
                return (
                  <TableRow key={d.id} className={superseded ? "opacity-60" : undefined}>
                    <TableCell className="font-medium">{te(`docType.${d.type}`)}</TableCell>
                    <TableCell>
                      <span dir="ltr">{d.number ?? "—"}</span>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <span dir="ltr">{ymd(d.issuedOn) ?? "—"}</span>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <span dir="ltr">{ymd(d.expiresOn) ?? "—"}</span>
                    </TableCell>
                    <TableCell>
                      {superseded ? (
                        <Badge variant="muted">{t("superseded")}</Badge>
                      ) : (
                        <Badge variant={levelVariant(level)}>{t(`expiry.${level}`)}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <DocumentLink fileUrl={d.fileUrl} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {tab === "leave" && (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("leaveType")}</TableHead>
                <TableHead>{tc("from")}</TableHead>
                <TableHead>{tc("to")}</TableHead>
                <TableHead className="text-end">{t("days")}</TableHead>
                <TableHead>{tc("status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employee.leave.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {tc("noData")}
                  </TableCell>
                </TableRow>
              )}
              {employee.leave.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.typeCode}</TableCell>
                  <TableCell className="tabular-nums">
                    <span dir="ltr">{ymd(l.startDate)}</span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <span dir="ltr">{ymd(l.endDate)}</span>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{toNumber(l.days)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        l.status === "APPROVED"
                          ? "success"
                          : l.status === "PENDING"
                            ? "warning"
                            : "muted"
                      }
                    >
                      {l.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {tab === "payslips" && (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc("from")}</TableHead>
                <TableHead>{tc("to")}</TableHead>
                <TableHead className="text-end">{t("netPaid")}</TableHead>
                <TableHead>{tc("status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employee.payslips.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    {tc("noData")}
                  </TableCell>
                </TableRow>
              )}
              {employee.payslips.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="tabular-nums">
                    <span dir="ltr">{ymd(p.periodStart)}</span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <span dir="ltr">{ymd(p.periodEnd)}</span>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(toNumber(p.netPaid))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.status === "PAID" ? "success" : "warning"}>{p.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole } from "@/lib/rbac";
import { db } from "@/lib/db";
import { listAcademicYears } from "@/lib/academic-year";
import { currentPriceMatrix } from "@/lib/pricing";
import { PageHeader } from "@/components/page-header";
import { CollapsibleCard, CollapsibleGroup } from "@/components/ui/collapsible-card";
import { AttendanceSettings } from "./attendance-settings";
import { YearsManager } from "./years-manager";
import { PROVIDERS, maskSecret } from "@/lib/integrations/registry";
import { CenterProfileForm } from "./center-profile-form";
import { PriceMatrixEditor, type MatrixRow } from "./price-matrix-editor";
import { CategoriesManager, type CategoryRow } from "./categories-manager";
import { IntegrationsManager, type IntegrationView } from "./integrations-manager";
import { TermsManager, type TermRow } from "./terms-manager";
import { NotificationLogTable, type LogRow } from "./notification-log-table";
import { UsersManager, type UserRow } from "./users-manager";
import { AuditLogTable, type AuditRow } from "./audit-log-table";
import { DataManager, DangerZone } from "./data-manager";

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, ["ADMIN"]);

  const t = await getTranslations("settings");
  const tterm = await getTranslations("terms");
  const tdata = await getTranslations("data");
  const tatt = await getTranslations("attendanceSettings");
  const tyear = await getTranslations("years");

  const [settingsRows, years, matrix, categories, integrationRows, logs, termRows, userRows, auditRows, teacherRows, guardianRows] = await Promise.all([
    db.setting.findMany(),
    listAcademicYears(),
    currentPriceMatrix(),
    db.expenseCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    db.integration.findMany(),
    db.notificationLog.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
    db.term.findMany({ orderBy: { startDate: "desc" } }),
    db.user.findMany({
      orderBy: { name: "asc" },
      include: { teacher: true, guardian: true },
    }),
    db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 400,
      include: { user: true },
    }),
    db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.guardian.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Merge the code-defined provider registry with any stored config. Secrets are
  // masked here so the real API key never reaches the browser.
  const integrations: IntegrationView[] = PROVIDERS.map((p) => {
    const row = integrationRows.find((r) => r.provider === p.key);
    return {
      provider: p.key,
      label: p.label,
      docsUrl: p.docsUrl,
      fields: p.fields.map((f) => ({
        key: f.key,
        labelKey: f.labelKey,
        placeholder: f.placeholder,
        help: f.help,
      })),
      enabled: row?.enabled ?? false,
      baseUrl: row?.baseUrl ?? "",
      apiKeyMask: maskSecret(row?.apiKey),
      hasKey: !!row?.apiKey,
      config: parseJson<Record<string, string>>(row?.config ?? null, {}),
      events: parseJson<string[]>(row?.events ?? null, []),
      audiences: parseJson<string[]>(row?.audiences ?? null, []),
      lastTestAt: row?.lastTestAt ? row.lastTestAt.toISOString() : null,
      lastTestOk: row?.lastTestOk ?? null,
      lastTestMsg: row?.lastTestMsg ?? null,
    };
  });

  const logRows: LogRow[] = logs.map((l) => ({
    id: l.id,
    at: l.createdAt.toISOString().slice(0, 16).replace("T", " "),
    event: l.event,
    audience: l.audience,
    recipient: l.recipient,
    status: l.status,
    error: l.error,
  }));

  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const matrixRows: MatrixRow[] = matrix.map((m) => ({
    id: m.gradeLevel.id,
    code: m.gradeLevel.code,
    nameAr: m.gradeLevel.nameAr,
    nameEn: m.gradeLevel.nameEn,
    center: m.CENTER,
    home: m.HOME,
  }));
  const catRows: CategoryRow[] = categories.map((c) => ({
    id: c.id,
    nameAr: c.nameAr,
    nameEn: c.nameEn,
    sortOrder: c.sortOrder,
    active: c.active,
  }));

  const now = new Date();
  const termRowsView: TermRow[] = termRows.map((x) => ({
    id: x.id,
    nameAr: x.nameAr,
    nameEn: x.nameEn,
    startDate: x.startDate.toISOString().slice(0, 10),
    endDate: x.endDate.toISOString().slice(0, 10),
    active: x.active,
    current: x.active && x.startDate <= now && x.endDate >= now,
  }));

  const users: UserRow[] = userRows.map((u) => ({
    id: u.id,
    name: u.name,
    nameEn: u.nameEn,
    email: u.email,
    role: u.role,
    locale: u.locale,
    active: u.active,
    teacherId: u.teacherId,
    guardianId: u.guardianId,
    linkedLabel: u.teacher?.name ?? u.guardian?.name ?? null,
  }));
  const teacherOpts = teacherRows.map((x) => ({ id: x.id, label: x.name }));
  const guardianOpts = guardianRows.map((x) => ({ id: x.id, label: x.name }));

  const audits: AuditRow[] = auditRows.map((a) => ({
    id: a.id,
    at: a.createdAt.toISOString().slice(0, 16).replace("T", " "),
    userName: a.user?.name ?? null,
    entity: a.entity,
    entityId: a.entityId,
    action: a.action,
  }));

  return (
    <div>
      <PageHeader title={t("title")} />
      <CollapsibleGroup>
      <div className="grid gap-6 lg:grid-cols-2">
        <CollapsibleCard title={t("center")}>
            <CenterProfileForm
              values={{
                centerName: settings.centerName ?? "",
                currency: settings.currency ?? "QAR",
                receiptFooter: settings.receiptFooter ?? "",
                centerAddress: settings.centerAddress ?? "",
                centerPhone: settings.centerPhone ?? "",
                centerTaxNo: settings.centerTaxNo ?? "",
                receiptSize: settings.receiptSize ?? "A4",
                statementFooter: settings.statementFooter ?? "",
                centerLogo: settings.centerLogo ?? "",
              }}
            />
          </CollapsibleCard>

        <CollapsibleCard title={t("priceMatrix")}>
            <PriceMatrixEditor rows={matrixRows} />
          </CollapsibleCard>

        <CollapsibleCard title={t("expenseCategories")} className="lg:col-span-2">
            <CategoriesManager categories={catRows} />
          </CollapsibleCard>

        <CollapsibleCard title={tyear("title")} className="lg:col-span-2">
          <YearsManager years={years} />
        </CollapsibleCard>

        <CollapsibleCard title={tatt("title")} className="lg:col-span-2">
          <AttendanceSettings
            values={{
              walkIn: settings.attendanceWalkIn ?? "FLAG",
              pickSession: settings.attendancePickSession === "true",
              graceHours: settings.autoCompleteGraceHours ?? "6",
            }}
          />
        </CollapsibleCard>

        <CollapsibleCard title={tterm("title")} className="lg:col-span-2">
            <TermsManager
              terms={termRowsView}
              defaultPaymentMode={settings.defaultTeacherPaymentMode ?? "MONTH"}
            />
          </CollapsibleCard>

        <CollapsibleCard title={t("users")} className="lg:col-span-2">
            <UsersManager users={users} teachers={teacherOpts} guardians={guardianOpts} />
          </CollapsibleCard>

        <CollapsibleCard title={t("integrations")} className="lg:col-span-2">
            <IntegrationsManager integrations={integrations} />
          </CollapsibleCard>

        <CollapsibleCard title={t("notificationLog")} className="lg:col-span-2">
            <NotificationLogTable rows={logRows} />
          </CollapsibleCard>

        <CollapsibleCard title={t("auditLog")} className="lg:col-span-2">
            <AuditLogTable rows={audits} />
          </CollapsibleCard>

        <CollapsibleCard title={tdata("title")} className="lg:col-span-2">
            {/* Settings is ADMIN-only, so finance tables are always available. */}
            <DataManager canFinance />
          </CollapsibleCard>

        <CollapsibleCard title={tdata("dangerZone")} tone="danger" className="lg:col-span-2">
            <DangerZone />
          </CollapsibleCard>
      </div>
      </CollapsibleGroup>
    </div>
  );
}

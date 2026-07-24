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
import { SubjectsManager, type SubjectRow } from "./subjects-manager";
import { IntegrationsManager, type IntegrationView } from "./integrations-manager";
import { TermsManager, type TermRow } from "./terms-manager";
import { TeacherPaymentsSettings } from "./teacher-payments-settings";
import { WpsSettings } from "./wps-settings";
import { AccountingSettings } from "./accounting-settings";
import { TransportSettings } from "./transport-settings";
import { AiSettings } from "./ai-settings";
import { parseAssistantRoles } from "@/lib/ai/presets";
import { SiteSettings } from "./site-settings";
import { BackupSettings } from "./backup-settings";
import { listBackups } from "@/lib/backups";
import { parseServiceAccount } from "@/lib/drive";
import { DEFAULT_EARNINGS_MODE, isEarningsMode } from "@/lib/earnings-mode";
import { NotificationLogTable, type LogRow } from "./notification-log-table";
import { UsersManager, type UserRow } from "./users-manager";
import { AuditLogTable, type AuditRow } from "./audit-log-table";
import { DataManager, DangerZone } from "./data-manager";
import { NAV_ITEMS } from "@/components/app-shell/nav-items";
import { EDITABLE_ROLES, loadRolePermissions, loadCustomRoles, parseRoleKeys } from "@/lib/permissions";
import { RolePermissionsSettings } from "./role-permissions-settings";
import { DemoUsersSettings } from "./demo-users-settings";

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

  // Roles & permissions: the staff modules an admin can narrow per role.
  const rolePerms = await loadRolePermissions();
  const customRolesData = await loadCustomRoles();
  const staffModules = NAV_ITEMS.filter(
    (i) => !["dashboard", "teacherPortal", "parentPortal"].includes(i.key),
  ).map((i) => ({ key: i.key, roles: i.roles as unknown as string[] }));
  const builtinMatrixRoles = ["ADMIN", ...EDITABLE_ROLES];
  const customMatrix: Record<string, Record<string, boolean>> = Object.fromEntries(
    customRolesData.map((c) => [c.key, c.permissions]),
  );
  const baseRoleOpts = ["ADMIN", "ACCOUNTANT", "RECEPTIONIST", "TEACHER", "PARENT", "DRIVER"];
  const trRoles = await getTranslations("roles");
  const allRoleOptions = [
    ...baseRoleOpts.map((k) => ({ key: k, label: trRoles(k) })),
    ...customRolesData.map((c) => ({ key: c.key, label: c.name })),
  ];
  const demoUsers = await db.user.findMany({
    where: { email: { endsWith: "@demo.qa" } },
    select: { name: true, email: true, role: true },
    orderBy: { role: "asc" },
  });

  const [settingsRows, years, matrix, categories, subjects, integrationRows, logs, termRows, userRows, auditRows, teacherRows, guardianRows] = await Promise.all([
    db.setting.findMany(),
    listAcademicYears(),
    currentPriceMatrix(),
    db.expenseCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    db.subject.findMany({
      orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
      include: { _count: { select: { teachers: true } } },
    }),
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
  const backups = await listBackups();
  const driveSa = settings.backupDriveSa ? parseServiceAccount(settings.backupDriveSa) : null;
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

  const subjectRows: SubjectRow[] = subjects.map((sbj) => ({
    id: sbj.id,
    nameAr: sbj.nameAr,
    nameEn: sbj.nameEn,
    sortOrder: sbj.sortOrder,
    active: sbj.active,
    teacherCount: sbj._count.teachers,
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
    roleKeys: parseRoleKeys(u.roleKeys, u.role),
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

        <CollapsibleCard title={t("teacherPayments")} className="lg:col-span-2">
          <TeacherPaymentsSettings
            defaultMode={settings.teacherEarningsMode ?? DEFAULT_EARNINGS_MODE}
            overriddenCount={teacherRows.filter((x) => isEarningsMode(x.earningsMode)).length}
            totalCount={teacherRows.length}
          />
        </CollapsibleCard>

        <CollapsibleCard title={t("siteSettings")} className="lg:col-span-2">
          <SiteSettings
            values={{
              publicHome: settings.publicHome ?? "ERP",
              siteHeroTitleAr: settings.siteHeroTitleAr ?? "",
              siteHeroTitleEn: settings.siteHeroTitleEn ?? "",
              siteHeroTextAr: settings.siteHeroTextAr ?? "",
              siteHeroTextEn: settings.siteHeroTextEn ?? "",
              siteAboutAr: settings.siteAboutAr ?? "",
              siteAboutEn: settings.siteAboutEn ?? "",
              siteYears: settings.siteYears ?? "",
              siteStudents: settings.siteStudents ?? "",
              siteSuccessRate: settings.siteSuccessRate ?? "",
              siteBranches: settings.siteBranches ?? "",
              siteWhatsApp: settings.siteWhatsApp ?? "",
            }}
          />
        </CollapsibleCard>

        <CollapsibleCard title={t("backups")} className="lg:col-span-2">
          <BackupSettings
            backups={backups}
            driveConfigured={!!driveSa}
            driveEmail={driveSa?.client_email ?? null}
            driveFolder={settings.backupDriveFolder ?? ""}
          />
        </CollapsibleCard>

        <CollapsibleCard title={t("transportSettings")} className="lg:col-span-2">
          <TransportSettings
            values={{
              enabled: settings.transportEnabled === "1",
              centerLat: settings.centerLat ?? "",
              centerLng: settings.centerLng ?? "",
              avgSpeedKmh: settings.transportAvgSpeedKmh ?? "40",
              rushSpeedKmh: settings.transportRushSpeedKmh ?? "25",
              rushWindows: settings.transportRushWindows ?? "07:00-09:00,16:00-19:00",
              detourFactor: settings.transportDetourFactor ?? "1.35",
              minTripMin: settings.transportMinTripMin ?? "5",
              bufferMin: settings.transportBufferMin ?? "10",
              maxDeadheadKm: settings.transportMaxDeadheadKm ?? "25",
              pingDays: settings.transportPingDays ?? "14",
              trackingVisibility: settings.transportTrackingVisibility ?? "ADMIN_ONLY",
              passengers: settings.transportPassengers ?? "BOTH",
            }}
          />
        </CollapsibleCard>

        <CollapsibleCard title={t("aiSettings")} className="lg:col-span-2">
          <AiSettings
            values={{
              enabled: settings.aiEnabled === "1",
              provider: settings.aiProvider ?? "deepseek",
              baseUrl: settings.aiBaseUrl ?? "",
              model: settings.aiModel ?? "",
              apiKeyMasked: maskSecret(settings.aiApiKey),
              autoTranslateNames: settings.aiAutoTranslateNames === "1",
              floatingChat: settings.aiFloatingChat !== "0",
              assistantRoles: parseAssistantRoles(settings.aiAssistantRoles, [
                "ADMIN",
                "ACCOUNTANT",
                "RECEPTIONIST",
              ]),
            }}
          />
        </CollapsibleCard>

        <CollapsibleCard title={t("accountingSettings")} className="lg:col-span-2">
          <AccountingSettings
            enabled={settings.accountingEnabled === "1"}
            cheque={(() => {
              let tpl: Record<string, { x?: number; y?: number; w?: number } | number> = {};
              try {
                tpl = JSON.parse(settings.chequeTemplate ?? "{}");
              } catch {
                /* stale JSON → defaults */
              }
              const pos = (k: string) => (tpl[k] ?? {}) as { x?: number; y?: number; w?: number };
              return {
                confReceived: settings.chequeConfReceived ?? "70",
                confPending: settings.chequeConfPending ?? "80",
                confDeposited: settings.chequeConfDeposited ?? "95",
                alertDays: settings.chequeAlertDays ?? "7",
                template: {
                  leafW: (tpl.leafW as number) ?? 176,
                  leafH: (tpl.leafH as number) ?? 89,
                  dateX: pos("date").x ?? 130,
                  dateY: pos("date").y ?? 10,
                  payeeX: pos("payee").x ?? 25,
                  payeeY: pos("payee").y ?? 28,
                  wordsX: pos("amountWords").x ?? 30,
                  wordsY: pos("amountWords").y ?? 42,
                  wordsW: pos("amountWords").w ?? 120,
                  digitsX: pos("amountDigits").x ?? 135,
                  digitsY: pos("amountDigits").y ?? 42,
                },
              };
            })()}
          />
        </CollapsibleCard>

        <CollapsibleCard title={t("wpsSettings")} className="lg:col-span-2">
          <WpsSettings
            values={{
              wpsEmployerEID: settings.wpsEmployerEID ?? "",
              wpsPayerEID: settings.wpsPayerEID ?? "",
              wpsPayerQID: settings.wpsPayerQID ?? "",
              wpsPayerBank: settings.wpsPayerBank ?? "",
              wpsPayerIBAN: settings.wpsPayerIBAN ?? "",
              wpsSifVersion: settings.wpsSifVersion ?? "1",
              wpsBasicFloor: settings.wpsBasicFloor ?? "",
            }}
          />
        </CollapsibleCard>

        <CollapsibleCard title={t("priceMatrix")}>
            <PriceMatrixEditor rows={matrixRows} />
          </CollapsibleCard>

        <CollapsibleCard title={t("subjects")} className="lg:col-span-2">
          <SubjectsManager subjects={subjectRows} />
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
            <UsersManager users={users} teachers={teacherOpts} guardians={guardianOpts} roleOptions={allRoleOptions} />
          </CollapsibleCard>

        <CollapsibleCard title={t("rolePermissions")} className="lg:col-span-2">
            <RolePermissionsSettings
              modules={staffModules}
              builtinRoles={builtinMatrixRoles}
              customRoles={customRolesData.map((c) => ({ id: c.id, key: c.key, name: c.name, baseRole: c.baseRole }))}
              baseRoles={baseRoleOpts}
              initialBuiltin={rolePerms}
              initialCustom={customMatrix}
            />
          </CollapsibleCard>

        <CollapsibleCard title={t("demoUsers")} className="lg:col-span-2">
            <DemoUsersSettings users={demoUsers} password="demo1234" />
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

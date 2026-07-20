import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole } from "@/lib/rbac";
import { db } from "@/lib/db";
import { currentPriceMatrix } from "@/lib/pricing";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PROVIDERS, maskSecret } from "@/lib/integrations/registry";
import { CenterProfileForm } from "./center-profile-form";
import { PriceMatrixEditor, type MatrixRow } from "./price-matrix-editor";
import { CategoriesManager, type CategoryRow } from "./categories-manager";
import { IntegrationsManager, type IntegrationView } from "./integrations-manager";
import { NotificationLogTable, type LogRow } from "./notification-log-table";

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

  const [settingsRows, matrix, categories, integrationRows, logs] = await Promise.all([
    db.setting.findMany(),
    currentPriceMatrix(),
    db.expenseCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    db.integration.findMany(),
    db.notificationLog.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
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

  return (
    <div>
      <PageHeader title={t("title")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("center")}</CardTitle>
          </CardHeader>
          <CardContent>
            <CenterProfileForm
              values={{
                centerName: settings.centerName ?? "",
                currency: settings.currency ?? "QAR",
                receiptFooter: settings.receiptFooter ?? "",
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("priceMatrix")}</CardTitle>
          </CardHeader>
          <CardContent>
            <PriceMatrixEditor rows={matrixRows} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("expenseCategories")}</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoriesManager categories={catRows} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("integrations")}</CardTitle>
          </CardHeader>
          <CardContent>
            <IntegrationsManager integrations={integrations} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("notificationLog")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <NotificationLogTable rows={logRows} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

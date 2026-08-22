import { setRequestLocale, getTranslations } from "next-intl/server";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth, STAFF_ROLES } from "@/lib/rbac";
import { redirect } from "@/i18n/navigation";
import { PageHeader } from "@/components/page-header";
import { ProfileTabs } from "@/components/profile-tabs";
import { Badge } from "@/components/ui/badge";
import { INTEGRATION_EVENTS } from "@/lib/integrations/types";
import { builtInBody } from "@/lib/integrations/notify";
import { NotificationLogTable, type LogRow } from "./outbound-log";
import { TemplatesEditor, type TemplateRow } from "./templates-editor";
import { DeliveryPicker } from "./delivery-picker";

/**
 * Messages — what the centre said, what it was told, and how it words it.
 *
 * Open to staff. The connection's credential stays in Settings behind its own
 * password: reading the conversation and choosing which events send are daily
 * work, while the API key is not something a receptionist should be able to
 * read off a screen somebody left open.
 */
export default async function MessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireAuth(locale);
  if (!(STAFF_ROLES as readonly string[]).includes(session.role)) {
    redirect({ href: "/dashboard", locale });
  }

  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "log";
  const t = await getTranslations("messages");

  const [outbound, inboundRows, integration, stored] = await Promise.all([
    db.notificationLog.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
    db.inboundMessage.findMany({
      orderBy: { receivedAt: "desc" },
      take: 200,
      include: {
        student: { select: { name: true } },
        guardian: { select: { name: true } },
        teacher: { select: { name: true } },
        driver: { select: { employee: { select: { name: true } } } },
      },
    }),
    db.integration.findFirst({ where: { provider: "EASYAICONNECT" } }),
    db.messageTemplate.findMany({ where: { active: true } }),
  ]);

  const parseJson = <T,>(raw: string | null, fallback: T): T => {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };

  const logRows: LogRow[] = outbound.map((l) => ({
    id: l.id,
    at: l.createdAt.toISOString().slice(0, 16).replace("T", " "),
    provider: l.provider,
    event: l.event,
    audience: l.audience,
    recipient: l.recipient,
    status: l.status,
    error: l.error,
    message: l.message,
  }));

  // One template row per event per language, so the editor always has a box to
  // type in — an event with nothing stored shows the built-in as its
  // placeholder rather than being absent from the screen.
  const templateRows: TemplateRow[] = INTEGRATION_EVENTS.flatMap((event) =>
    (["ar", "en"] as const).map((lang) => ({
      event,
      locale: lang,
      body: stored.find((s) => s.event === event && s.audience === null && s.locale === lang)?.body ?? "",
      builtIn: builtInBody(event, lang),
    })),
  );

  const tabs = [
    { key: "log", label: t("tabLog"), count: outbound.length },
    { key: "inbound", label: t("tabInbound"), count: inboundRows.length },
    { key: "templates", label: t("tabTemplates") },
    { key: "delivery", label: t("tabDelivery") },
  ];

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ProfileTabs tabs={tabs} active={tab} basePath="/messages" />

      <div className="mt-4">
        {tab === "log" && <NotificationLogTable rows={logRows} />}

        {tab === "inbound" && (
          <div className="rounded-lg border border-border p-4">
            <p className="mb-3 text-xs text-muted-foreground">{t("inboundIntro")}</p>
            {inboundRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("inboundEmpty")}</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {inboundRows.map((m) => (
                    <tr key={m.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pe-2 align-top">
                        <ArrowDownLeft className="size-4 text-[var(--success)]" />
                      </td>
                      <td
                        className="whitespace-nowrap py-2 pe-3 align-top text-xs text-muted-foreground tabular-nums"
                        dir="ltr"
                      >
                        {m.receivedAt.toISOString().slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="py-2 pe-3 align-top">
                        <span className="font-medium">
                          {m.student?.name ??
                            m.guardian?.name ??
                            m.teacher?.name ??
                            m.driver?.employee.name ??
                            m.contactName ??
                            t("unknownNumber")}
                        </span>
                        {m.phone && (
                          <span className="ms-2 text-xs text-muted-foreground" dir="ltr">
                            {m.phone}
                          </span>
                        )}
                      </td>
                      <td className="py-2 align-top" dir="auto">
                        {m.body}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "templates" && <TemplatesEditor rows={templateRows} />}

        {tab === "delivery" && (
          <DeliveryPicker
            provider="EASYAICONNECT"
            configured={Boolean(integration?.apiKey)}
            // Falls back to the cross product the old two columns described, so
            // an existing setup opens showing exactly what it sends today.
            initialMatrix={
              Object.keys(parseJson<Record<string, string[]>>(integration?.deliveryMatrix ?? null, {})).length
                ? parseJson<Record<string, string[]>>(integration?.deliveryMatrix ?? null, {})
                : Object.fromEntries(
                    parseJson<string[]>(integration?.events ?? null, []).map((e) => [
                      e,
                      parseJson<string[]>(integration?.audiences ?? null, []),
                    ]),
                  )
            }
          />
        )}
      </div>

      {tab === "log" && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <ArrowUpRight className="size-3.5" />
          {t("logIntro")}
          {integration?.enabled ? null : <Badge variant="warning">{t("disabled")}</Badge>}
        </p>
      )}
    </div>
  );
}

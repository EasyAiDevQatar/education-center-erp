import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAi } from "@/lib/ai/guard";
import { aiReady } from "@/lib/ai/config";
import { PageHeader } from "@/components/page-header";
import { AssistantClient } from "./assistant-client";

export default async function AssistantPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { config } = await requireAi(locale);
  const t = await getTranslations("assistant");

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AssistantClient ready={aiReady(config)} />
    </div>
  );
}

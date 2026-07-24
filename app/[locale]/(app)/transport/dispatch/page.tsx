import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTransport } from "@/lib/transport/guard";
import { dispatchBoard } from "@/lib/transport/dispatch";
import { PageHeader } from "@/components/page-header";
import { DispatchClient } from "./dispatch-client";

export default async function TransportDispatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireTransport(locale);
  const t = await getTranslations("transportDispatch");

  const sp = await searchParams;
  const dParam = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const day =
    dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam)
      ? dParam
      : new Date().toISOString().slice(0, 10);

  const board = await dispatchBoard(locale, day);

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <DispatchClient board={board} />
    </div>
  );
}

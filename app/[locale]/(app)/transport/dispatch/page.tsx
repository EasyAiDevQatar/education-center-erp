import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTransport } from "@/lib/transport/guard";
import { dispatchBoard } from "@/lib/transport/dispatch";
import { masterBoard } from "@/lib/transport/master";
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
  const auth = await requireTransport(locale);
  const canDrag = auth.role === "ADMIN" || auth.role === "RECEPTIONIST";
  const t = await getTranslations("transportDispatch");

  const sp = await searchParams;
  const dParam = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const day =
    dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam)
      ? dParam
      : new Date().toISOString().slice(0, 10);

  // Both, deliberately. The day's totals and the map still come from the
  // dispatch reader; the timeline itself is now the master planner's own board,
  // so this page cannot draw a driver's day differently from the page that
  // exists to draw it.
  const [board, master] = await Promise.all([
    dispatchBoard(locale, day),
    masterBoard(locale, day, { laneKind: "DRIVER", canDrag }),
  ]);

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <DispatchClient board={board} master={master} />
    </div>
  );
}

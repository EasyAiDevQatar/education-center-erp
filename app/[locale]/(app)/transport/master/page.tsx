import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTransport } from "@/lib/transport/guard";
import { masterBoard, type LaneKind } from "@/lib/transport/master";
import { PageHeader } from "@/components/page-header";
import { MasterClient } from "./master-client";

/**
 * The master planner: one row per person, showing their WHOLE day.
 *
 * The dispatch board draws rides and nothing else, which is why a teacher who
 * taught continuously between two trips looked like she idled for six hours.
 * Here a row carries lessons, travel and the gaps between them, so a blank
 * stretch means something rather than hiding something.
 */
export default async function TransportMasterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireTransport(locale);
  const t = await getTranslations("transportMaster");

  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;

  const dParam = one("date");
  const day =
    dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam)
      ? dParam
      : new Date().toISOString().slice(0, 10);

  // The perspective changes what a ROW is, so unlike the layer toggles it has
  // to be re-read from the server.
  const viewParam = one("view");
  const laneKind: LaneKind =
    viewParam === "DRIVER" || viewParam === "VEHICLE" ? viewParam : "TEACHER";

  // Everything else is loaded; which layers are drawn is the client's
  // business, so a toggle is instant and a hidden centre lesson still marks
  // the row busy.
  const board = await masterBoard(locale, day, { laneKind });

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <MasterClient board={board} />
    </div>
  );
}

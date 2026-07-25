import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTransport } from "@/lib/transport/guard";
import { masterBoard } from "@/lib/transport/master";
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

  // Centre lessons are off by default — a teacher can have a wall of them, and
  // they would bury the home visits this planner exists for.
  const includeCentre = one("centre") === "1";

  const board = await masterBoard(locale, day, { includeCentre });

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <MasterClient board={board} includeCentre={includeCentre} />
    </div>
  );
}

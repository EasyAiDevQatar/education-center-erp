import { redirect } from "@/i18n/navigation";

/**
 * لوحة الإرسال has been folded into the master planner.
 *
 * It drew a driver's day from its own reader, which is how its «غير مسندة»
 * tile came to read 0 on a day whose own timeline was marking a home visit
 * with no ride at all. Everything it did — the lanes, the pool, assigning,
 * the totals, the map, the export — is on المخطط الرئيسي's driver view now,
 * counted from one board.
 *
 * The route stays as a redirect rather than a 404: it has been linked and
 * bookmarked, and a dead link is a worse answer than the page people wanted.
 */
export default async function TransportDispatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const d = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const q = new URLSearchParams({ view: "DRIVER" });
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) q.set("date", d);
  redirect({ href: `/transport/master?${q.toString()}`, locale });
}

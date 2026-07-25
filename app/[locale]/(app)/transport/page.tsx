import { redirect } from "@/i18n/navigation";
import { requireTransport } from "@/lib/transport/guard";

/** Module root: bounce to the planner — the coordinator's daily screen. */
export default async function TransportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  await requireTransport(locale);
  // Carry the day through the bounce. Without this, picking the 1st of August
  // in the session planner and clicking Transport lands you on today: the date
  // survives the click and then dies in the redirect, which is the harder kind
  // of bug to see because the link looked right.
  const sp = await searchParams;
  const d = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const q = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `?date=${d}` : "";
  redirect({ href: `/transport/planner${q}`, locale });
}

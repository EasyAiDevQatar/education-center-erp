import { redirect } from "@/i18n/navigation";
import { requireTransport } from "@/lib/transport/guard";

/** Module root: bounce to the planner — the coordinator's daily screen. */
export default async function TransportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireTransport(locale);
  redirect({ href: "/transport/planner", locale });
}

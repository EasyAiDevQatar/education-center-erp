import { redirect } from "@/i18n/navigation";
import { requireAccounting } from "@/lib/accounting/guard";

/** Module root: bounce to the chart of accounts (the journal arrives next phase). */
export default async function AccountingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireAccounting(locale);
  redirect({ href: "/accounting/accounts", locale });
}

import "server-only";
import { redirect } from "@/i18n/navigation";
import { db } from "./db";
import { OPTIONAL_MODULES, type OptionalModule } from "./modules-shared";

export { OPTIONAL_MODULES };
export type { OptionalModule };

/**
 * Optional modules that are ON until switched off.
 *
 * The distinction from transport, accounting and AI matters. Those three arrived
 * as opt-in extras, so their flag reads `value === "1"` and an absent row means
 * off. HR, Reports and Leads have been in use since before they were optional —
 * reading them the same way would make three working modules vanish from every
 * existing centre the moment this deploys. So absent means ON here, and only an
 * explicit "0" turns one off.
 */
export const OPTIONAL_MODULE_SETTING = {
  hr: "hrEnabled",
  reports: "reportsEnabled",
  leads: "leadsEnabled",
} as const;

export async function moduleEnabled(m: OptionalModule): Promise<boolean> {
  const row = await db.setting.findUnique({ where: { key: OPTIONAL_MODULE_SETTING[m] } });
  return row?.value !== "0";
}

/** All three in one query, for the layout that hands them to the shell. */
export async function moduleFlags(): Promise<Record<OptionalModule, boolean>> {
  const rows = await db.setting.findMany({
    where: { key: { in: Object.values(OPTIONAL_MODULE_SETTING) } },
  });
  const off = new Set(rows.filter((r) => r.value === "0").map((r) => r.key));
  return {
    hr: !off.has("hrEnabled"),
    reports: !off.has("reportsEnabled"),
    leads: !off.has("leadsEnabled"),
  };
}

/**
 * Page guard. Hiding the nav item is UX; this is the enforcement — a bookmarked
 * URL must not reach a module the centre has switched off.
 */
export async function requireModule(locale: string, m: OptionalModule): Promise<void> {
  if (!(await moduleEnabled(m))) redirect({ href: "/dashboard", locale });
}

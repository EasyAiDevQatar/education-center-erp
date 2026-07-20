import { defineRouting } from "next-intl/routing";

/** Arabic is the default locale and renders RTL; English renders LTR. */
export const routing = defineRouting({
  locales: ["ar", "en"],
  defaultLocale: "ar",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];

export function dirForLocale(locale: string): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

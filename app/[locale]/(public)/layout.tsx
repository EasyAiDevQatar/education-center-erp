import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LogIn, Phone, MapPin } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";

/**
 * Always rendered per-request: the page body is decided by live settings
 * (publicHome, hero texts) and DB data. Prerendering would bake the choice
 * into the build and also break builds run without a database.
 */
export const dynamic = "force-dynamic";

/**
 * The public shell: no auth anywhere in this group. Header and footer read the
 * centre's own settings so the site is branded the moment a logo is uploaded,
 * with sensible fallbacks before that.
 */
export default async function PublicLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("site");
  const tc = await getTranslations("common");

  const settingsRows = await db.setting.findMany({
    where: { key: { in: ["centerName", "centerLogo", "centerPhone", "centerAddress", "siteWhatsApp"] } },
  });
  const s = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  const name = s.centerName || tc("appShort");

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2">
            {s.centerLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.centerLogo} alt="" className="max-h-9 object-contain" />
            ) : null}
            <span className="font-bold">{name}</span>
          </Link>

          <nav className="ms-6 hidden items-center gap-4 text-sm sm:flex">
            <Link href="/home" className="text-muted-foreground transition-colors hover:text-foreground">
              {t("navCenter")}
            </Link>
            <Link href="/erp" className="text-muted-foreground transition-colors hover:text-foreground">
              {t("navErp")}
            </Link>
          </nav>

          <div className="ms-auto flex items-center gap-2">
            <LocaleSwitcher />
            <Link href="/login">
              <Button size="sm" className="gap-1">
                <LogIn className="size-4" />
                {t("login")}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{name}</span>
          <span className="flex flex-wrap items-center gap-4">
            {s.centerAddress && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" />
                {s.centerAddress}
              </span>
            )}
            {s.centerPhone && (
              <a href={`tel:${s.centerPhone}`} className="flex items-center gap-1 hover:text-foreground" dir="ltr">
                <Phone className="size-3.5" />
                {s.centerPhone}
              </a>
            )}
          </span>
          <span dir="ltr">© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}

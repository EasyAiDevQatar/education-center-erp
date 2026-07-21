import { getTranslations } from "next-intl/server";
import {
  CalendarRange,
  ClipboardList,
  QrCode,
  Receipt,
  Package,
  BadgeDollarSign,
  BriefcaseBusiness,
  UserRound,
  UserPlus,
  BarChart3,
  Languages,
  ShieldCheck,
  MessageCircle,
  LogIn,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";

/**
 * The EDU ERP features page — the default public landing. Every card below is
 * a real, shipped module of this system, so the page is a product tour rather
 * than marketing promises.
 */
export async function ErpFeatures() {
  const t = await getTranslations("site");

  const settingsRows = await db.setting.findMany({
    where: { key: { in: ["siteWhatsApp", "centerPhone"] } },
  });
  const s = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  const whatsapp = (s.siteWhatsApp || s.centerPhone || "").replace(/[^\d]/g, "");

  const features = [
    { icon: ClipboardList, key: "planner" },
    { icon: CalendarRange, key: "calendar" },
    { icon: QrCode, key: "attendance" },
    { icon: Receipt, key: "billing" },
    { icon: Package, key: "packages" },
    { icon: BadgeDollarSign, key: "payroll" },
    { icon: BriefcaseBusiness, key: "hr" },
    { icon: UserRound, key: "portals" },
    { icon: UserPlus, key: "crm" },
    { icon: BarChart3, key: "reports" },
    { icon: Languages, key: "bilingual" },
    { icon: ShieldCheck, key: "security" },
  ] as const;

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-b from-accent/60 to-background">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center">
          <p className="mb-3 inline-block rounded-full bg-primary/10 px-4 py-1 text-sm font-medium text-primary">
            EDU ERP
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
            {t("erpHeroTitle")}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            {t("erpHeroText")}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/login">
              <Button size="lg" className="gap-2">
                <LogIn className="size-4" />
                {t("login")}
              </Button>
            </Link>
            {whatsapp && (
              <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">
                <Button size="lg" variant="outline" className="gap-2">
                  <MessageCircle className="size-4" />
                  {t("ctaWhatsApp")}
                </Button>
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Stat strip */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-8 text-center sm:grid-cols-4">
          {(
            [
              ["erpStatModules", "20+"],
              ["erpStatLangs", "AR / EN"],
              ["erpStatWps", "WPS"],
              ["erpStatDevices", "100%"],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <div className="text-2xl font-bold text-primary" dir="ltr">
                {value}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{t(key)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Feature grid — the real modules */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold">{t("erpFeaturesTitle")}</h2>
          <p className="mt-2 text-muted-foreground">{t("erpFeaturesSubtitle")}</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.key} className="rounded-xl border border-border bg-card p-6">
              <f.icon className="mb-3 size-7 text-primary" />
              <h3 className="font-semibold">{t(`erpFeature.${f.key}`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`erpFeatureText.${f.key}`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-4 py-14 text-center">
          <h2 className="text-3xl font-bold">{t("erpCtaTitle")}</h2>
          <p className="mx-auto mt-3 max-w-xl opacity-90">{t("erpCtaText")}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/login">
              <Button size="lg" variant="secondary">
                {t("login")}
              </Button>
            </Link>
            <Link href="/home">
              <Button
                size="lg"
                variant="outline"
                className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
              >
                {t("navCenter")}
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

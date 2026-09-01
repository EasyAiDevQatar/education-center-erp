import Image from "next/image";
import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Languages,
  LayoutDashboard,
  Menu,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ArticleFeedback } from "@/components/help/article-feedback";

export async function DashboardNavigationArticle({ locale }: { locale: string }) {
  const t = await getTranslations("help");
  const ta = await getTranslations("help.articles.dashboardNavigation");
  const updated = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", {
    dateStyle: "long",
    timeZone: "Asia/Qatar",
  }).format(new Date("2026-09-01T00:00:00+03:00"));
  const dashboardScreenshot = locale === "ar"
    ? "/help/quick-start/dashboard-ar.png"
    : "/help/quick-start/dashboard-en.png";
  const roleSwitcherGif = locale === "ar"
    ? "/help/dashboard-navigation/role-switcher-ar.gif"
    : "/help/dashboard-navigation/role-switcher-en.gif";
  const sidebarSections = [0, 1, 2, 3, 4].map((index) => ({
    title: ta(`sidebarSections.${index}.title`),
    description: ta(`sidebarSections.${index}.description`),
    items: [0, 1, 2].map((itemIndex) => ta(`sidebarSections.${index}.items.${itemIndex}`)),
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <nav aria-label={t("breadcrumbs")} className="mb-5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/help" className="hover:text-primary">{t("title")}</Link>
        <ChevronRight className="size-3.5 rtl:rotate-180" />
        <span>{t("categories.gettingStarted.title")}</span>
        <ChevronRight className="size-3.5 rtl:rotate-180" />
        <span aria-current="page" className="text-foreground">{ta("title")}</span>
      </nav>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_250px]">
        <article className="min-w-0">
          <header className="border-b border-border pb-6">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-primary/10 px-3 py-1 font-semibold text-primary">
                {t("categories.gettingStarted.title")}
              </span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Clock3 className="size-3.5" />
                {t("readTime", { minutes: 6 })}
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{ta("title")}</h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">{ta("intro")}</p>
            <p className="mt-4 text-sm text-muted-foreground">{t("lastUpdated", { date: updated })}</p>
          </header>

          <section id="before" className="scroll-mt-20 py-7">
            <div className="rounded-xl border border-sky-300 bg-sky-50 p-4 text-sky-950 dark:border-sky-800 dark:bg-sky-950/35 dark:text-sky-100">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-5 shrink-0" />
                <div>
                  <h2 className="font-semibold">{ta("beforeTitle")}</h2>
                  <p className="mt-1 text-sm leading-6">{ta("beforeText")}</p>
                </div>
              </div>
            </div>
          </section>

          <section id="dashboard" className="scroll-mt-20 pb-9">
            <div className="flex items-center gap-2">
              <LayoutDashboard className="size-6 text-primary" />
              <h2 className="text-2xl font-bold">{ta("dashboardTitle")}</h2>
            </div>
            <p className="mt-2 leading-7 text-muted-foreground">{ta("dashboardIntro")}</p>
            <figure className="mt-5 overflow-hidden rounded-xl border border-border bg-muted/30 p-2 sm:p-3">
              <a href={dashboardScreenshot} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg">
                <Image
                  src={dashboardScreenshot}
                  alt={ta("dashboardScreenshotAlt")}
                  width={1569}
                  height={912}
                  priority
                  className="h-auto w-full"
                />
              </a>
              <figcaption className="px-2 pb-1 pt-3 text-sm leading-6 text-muted-foreground">
                {ta("dashboardScreenshotCaption")}
              </figcaption>
            </figure>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[LayoutDashboard, CalendarDays, BarChart3, CheckCircle2].map((Icon, index) => (
                <div key={index} className="rounded-xl border border-border p-4">
                  <Icon className="size-5 text-primary" />
                  <h3 className="mt-3 font-semibold">{ta(`dashboardCards.${index}.title`)}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{ta(`dashboardCards.${index}.text`)}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="sidebar" className="scroll-mt-20 border-t border-border py-9">
            <div className="flex items-center gap-2">
              <Menu className="size-6 text-primary" />
              <h2 className="text-2xl font-bold">{ta("sidebarTitle")}</h2>
            </div>
            <p className="mt-2 leading-7 text-muted-foreground">{ta("sidebarIntro")}</p>
            <div className="mt-5 space-y-3">
              {sidebarSections.map((section, index) => (
                <details key={section.title} open={index === 0} className="group rounded-xl border border-border bg-card open:bg-muted/25">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 font-semibold marker:content-none">
                    <span>{section.title}</span>
                    <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-border px-4 pb-5 pt-4">
                    <p className="leading-7 text-muted-foreground">{section.description}</p>
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                      {section.items.map((item) => (
                        <li key={item} className="flex gap-2">
                          <CheckCircle2 className="mt-1 size-4 shrink-0 text-primary" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section id="language" className="scroll-mt-20 border-t border-border py-9">
            <div className="flex items-center gap-2">
              <Languages className="size-6 text-primary" />
              <h2 className="text-2xl font-bold">{ta("languageTitle")}</h2>
            </div>
            <p className="mt-2 leading-7 text-muted-foreground">{ta("languageText")}</p>
            <figure className="mt-5 overflow-hidden rounded-xl border border-border bg-muted/30 p-2 sm:p-3">
              <Image
                src="/help/dashboard-navigation/language-switch.gif"
                alt={ta("languageGifAlt")}
                width={1046}
                height={608}
                unoptimized
                className="h-auto w-full rounded-lg"
              />
              <figcaption className="px-2 pb-1 pt-3 text-sm leading-6 text-muted-foreground">{ta("languageGifCaption")}</figcaption>
            </figure>
          </section>

          <section id="profile" className="scroll-mt-20 border-t border-border py-9">
            <div className="flex items-center gap-2">
              <UserRoundCog className="size-6 text-primary" />
              <h2 className="text-2xl font-bold">{ta("profileTitle")}</h2>
            </div>
            <p className="mt-2 leading-7 text-muted-foreground">{ta("profileIntro")}</p>
            <figure className="mt-5 overflow-hidden rounded-xl border border-border bg-muted/30 p-2 sm:p-3">
              <Image
                src={roleSwitcherGif}
                alt={ta("roleGifAlt")}
                width={1046}
                height={608}
                unoptimized
                className="h-auto w-full rounded-lg"
              />
              <figcaption className="px-2 pb-1 pt-3 text-sm leading-6 text-muted-foreground">{ta("roleGifCaption")}</figcaption>
            </figure>
            <div className="mt-5 rounded-xl border border-primary/25 bg-primary/[0.04] p-5">
              <h3 className="font-semibold">{ta("roleRulesTitle")}</h3>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                {[0, 1, 2, 3].map((index) => (
                  <li key={index} className="flex gap-2">
                    <CheckCircle2 className="mt-1 size-4 shrink-0 text-primary" />
                    <span>{ta(`roleRules.${index}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section id="tips" className="scroll-mt-20 border-t border-border py-9">
            <h2 className="text-2xl font-bold">{ta("tipsTitle")}</h2>
            <ol className="mt-5 space-y-3">
              {[0, 1, 2, 3, 4].map((index) => (
                <li key={index} className="flex gap-3 rounded-xl border border-border p-4 text-sm leading-6">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{index + 1}</span>
                  <span>{ta(`tips.${index}`)}</span>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild><Link href="/dashboard">{ta("openDashboard")}</Link></Button>
              <Button asChild variant="outline"><Link href="/help">{t("backToHelp")}</Link></Button>
            </div>
          </section>

          <ArticleFeedback question={t("feedbackQuestion")} yes={t("yes")} no={t("no")} thanks={t("feedbackThanks")} />

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
            <Button asChild variant="outline">
              <Link href="/help/quick-start-checklist">
                <ArrowLeft className="rtl:rotate-180" />
                {ta("previousArticle")}
              </Link>
            </Button>
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              {ta("nextArticle")}
              <ArrowRight className="size-4 rtl:rotate-180" />
            </span>
          </div>
        </article>

        <aside className="hidden xl:block">
          <nav aria-label={t("onThisPage")} className="sticky top-5 rounded-xl border border-border bg-card p-4">
            <p className="mb-3 text-sm font-semibold">{t("onThisPage")}</p>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <a href="#before" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("beforeTitle")}</a>
              <a href="#dashboard" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("dashboardTitle")}</a>
              <a href="#sidebar" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("sidebarTitle")}</a>
              <a href="#language" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("languageTitle")}</a>
              <a href="#profile" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("profileTitle")}</a>
              <a href="#tips" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("tipsTitle")}</a>
            </div>
          </nav>
        </aside>
      </div>
    </div>
  );
}

import Image from "next/image";
import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Lightbulb,
  ShieldCheck,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ArticleFeedback } from "@/components/help/article-feedback";
import { QuickStartChecklist, type QuickStartItem } from "@/components/help/quick-start-checklist";

const CHECKLIST_LINKS = [
  "/settings?tab=center&sub=center",
  "/settings?tab=academic&sub=years",
  "/settings?tab=academic&sub=subjects",
  "/settings?tab=academic&sub=priceMatrix",
  "/settings?tab=access&sub=users",
  "/teachers",
  "/students",
  "/packages",
  "/sessions",
  "/checkin",
] as const;

export async function QuickStartArticle({
  locale,
  isAdmin,
}: {
  locale: string;
  isAdmin: boolean;
}) {
  const t = await getTranslations("help");
  const ta = await getTranslations("help.articles.quickStart");
  const updated = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", {
    dateStyle: "long",
    timeZone: "Asia/Qatar",
  }).format(new Date("2026-09-01T00:00:00+03:00"));
  const items: QuickStartItem[] = CHECKLIST_LINKS.map((href, index) => ({
    id: `setup-${index + 1}`,
    title: ta(`checklist.${index}.title`),
    description: ta(`checklist.${index}.description`),
    action: ta(`checklist.${index}.action`),
    href,
  }));
  const dashboardScreenshot = locale === "ar"
    ? "/help/quick-start/dashboard-ar.png"
    : "/help/quick-start/dashboard-en.png";
  const settingsScreenshot = locale === "ar"
    ? "/help/quick-start/center-settings-ar.png"
    : "/help/quick-start/center-settings-en.png";

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
                {t("readTime", { minutes: 7 })}
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
            {!isAdmin && (
              <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100">
                <strong>{ta("adminOnlyTitle")}</strong> {ta("adminOnlyText")}
              </div>
            )}
          </section>

          <section id="real-screens" className="scroll-mt-20 pb-9">
            <h2 className="text-2xl font-bold">{ta("realScreensTitle")}</h2>
            <p className="mt-2 leading-7 text-muted-foreground">{ta("realScreensIntro")}</p>
            <div className="mt-5 space-y-5">
              <figure className="overflow-hidden rounded-xl border border-border bg-muted/30 p-2 sm:p-3">
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
              <figure className="overflow-hidden rounded-xl border border-border bg-muted/30 p-2 sm:p-3">
                <a href={settingsScreenshot} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg">
                  <Image
                    src={settingsScreenshot}
                    alt={ta("settingsScreenshotAlt")}
                    width={1569}
                    height={912}
                    className="h-auto w-full"
                  />
                </a>
                <figcaption className="px-2 pb-1 pt-3 text-sm leading-6 text-muted-foreground">
                  {ta("settingsScreenshotCaption")}
                </figcaption>
              </figure>
            </div>
          </section>

          <section id="order" className="scroll-mt-20 pb-9">
            <h2 className="text-2xl font-bold">{ta("orderTitle")}</h2>
            <p className="mt-2 leading-7 text-muted-foreground">{ta("orderIntro")}</p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <div key={index} className="rounded-xl border border-border bg-card p-4">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{index + 1}</span>
                  <h3 className="mt-3 font-semibold">{ta(`phases.${index}.title`)}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{ta(`phases.${index}.text`)}</p>
                </div>
              ))}
            </div>
          </section>

          <div id="checklist" className="scroll-mt-20">
            <QuickStartChecklist
              items={items}
              labels={{
                title: ta("checklistTitle"),
                progress: ta("progress"),
                complete: ta("markComplete"),
                completed: ta("markIncomplete"),
                reset: ta("resetProgress"),
              }}
            />
          </div>

          <section id="modules" className="scroll-mt-20 py-9">
            <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-5">
              <div className="flex items-start gap-3">
                <Lightbulb className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{ta("modulesTitle")}</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{ta("modulesText")}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {isAdmin && (
                      <Button asChild size="sm">
                        <Link href="/settings?tab=center&sub=modules">{ta("openModules")}</Link>
                      </Button>
                    )}
                    <Button asChild size="sm" variant="outline">
                      <Link href="/help/activate-transport">{ta("transportGuide")}</Link>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="done" className="scroll-mt-20 border-t border-border py-9">
            <div className="flex items-center gap-2">
              <BookOpenCheck className="size-6 text-primary" />
              <h2 className="text-2xl font-bold">{ta("doneTitle")}</h2>
            </div>
            <p className="mt-2 leading-7 text-muted-foreground">{ta("doneIntro")}</p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <li key={index} className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm leading-6">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  {ta(`done.${index}`)}
                </li>
              ))}
            </ul>
          </section>

          <section id="mistakes" className="scroll-mt-20 border-t border-border py-9">
            <div className="flex items-center gap-2">
              <CircleAlert className="size-5 text-amber-600" />
              <h2 className="text-2xl font-bold">{ta("mistakesTitle")}</h2>
            </div>
            <div className="mt-5 space-y-3">
              {[0, 1, 2, 3].map((index) => (
                <details key={index} className="rounded-xl border border-border p-4 open:bg-muted/30">
                  <summary className="cursor-pointer font-semibold">{ta(`mistakes.${index}.title`)}</summary>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{ta(`mistakes.${index}.text`)}</p>
                </details>
              ))}
            </div>
          </section>

          <ArticleFeedback question={t("feedbackQuestion")} yes={t("yes")} no={t("no")} thanks={t("feedbackThanks")} />

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
            <Button asChild variant="outline">
              <Link href="/help">
                <ArrowLeft className="rtl:rotate-180" />
                {t("backToHelp")}
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/help/dashboard-navigation">
                {ta("nextArticle")}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          </div>
        </article>

        <aside className="hidden xl:block">
          <nav aria-label={t("onThisPage")} className="sticky top-5 rounded-xl border border-border bg-card p-4">
            <p className="mb-3 text-sm font-semibold">{t("onThisPage")}</p>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <a href="#before" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("beforeTitle")}</a>
              <a href="#real-screens" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("realScreensTitle")}</a>
              <a href="#order" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("orderTitle")}</a>
              <a href="#checklist" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("checklistTitle")}</a>
              <a href="#done" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("doneTitle")}</a>
              <a href="#mistakes" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("mistakesTitle")}</a>
            </div>
          </nav>
        </aside>
      </div>
    </div>
  );
}

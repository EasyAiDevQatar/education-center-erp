import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  Bus,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  MapPin,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { TransportActivationWalkthrough } from "@/components/help/transport-activation-walkthrough";
import { ArticleFeedback } from "@/components/help/article-feedback";
import { HELP_ARTICLES, findHelpArticle } from "@/lib/help-catalog";
import { requireAuth } from "@/lib/rbac";

export function generateStaticParams() {
  return HELP_ARTICLES.filter((article) => article.published).map((article) => ({
    slug: article.slug,
  }));
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const article = findHelpArticle(slug);
  if (!article?.published || slug !== "activate-transport") notFound();

  const session = await requireAuth(locale);
  const t = await getTranslations("help");
  const ta = await getTranslations("help.articles.activateTransport");
  const isAdmin = session.role === "ADMIN";
  const steps = [0, 1, 2, 3].map((index) => ({
    title: ta(`steps.${index}.title`),
    shortTitle: ta(`steps.${index}.shortTitle`),
    description: ta(`steps.${index}.description`),
  }));
  const updated = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", {
    dateStyle: "long",
    timeZone: "Asia/Qatar",
  }).format(new Date("2026-09-01T00:00:00+03:00"));

  return (
    <div className="mx-auto max-w-6xl">
      <nav aria-label={t("breadcrumbs")} className="mb-5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/help" className="hover:text-primary">{t("title")}</Link>
        <ChevronRight className="size-3.5 rtl:rotate-180" />
        <span>{t("categories.transport.title")}</span>
        <ChevronRight className="size-3.5 rtl:rotate-180" />
        <span aria-current="page" className="text-foreground">{ta("title")}</span>
      </nav>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_250px]">
        <article className="min-w-0">
          <header className="border-b border-border pb-6">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-primary/10 px-3 py-1 font-semibold text-primary">
                {t("categories.transport.title")}
              </span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Clock3 className="size-3.5" />
                {t("readTime", { minutes: 4 })}
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{ta("title")}</h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
              {ta("intro")}
            </p>
            <p className="mt-4 text-sm text-muted-foreground">{t("lastUpdated", { date: updated })}</p>
          </header>

          <section id="before" className="scroll-mt-20 py-7">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-5 shrink-0" />
                <div>
                  <h2 className="font-semibold">{ta("beforeTitle")}</h2>
                  <p className="mt-1 text-sm leading-6">{ta("beforeText")}</p>
                </div>
              </div>
            </div>
          </section>

          <TransportActivationWalkthrough
            steps={steps}
            labels={{
              title: ta("walkthroughTitle"),
              play: t("play"),
              pause: t("pause"),
              previous: t("previousStep"),
              next: t("nextStep"),
              settings: ta("visual.settings"),
              transport: ta("visual.transport"),
              enable: ta("visual.enable"),
              centreLocation: ta("visual.centreLocation"),
              save: ta("visual.save"),
              active: ta("visual.active"),
              moduleIntro: ta("visual.moduleIntro"),
            }}
          />

          <section id="steps" className="scroll-mt-20 py-9">
            <h2 className="text-2xl font-bold">{ta("stepsTitle")}</h2>
            <ol className="mt-6 space-y-7">
              {steps.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                  <div className="pt-1">
                    <h3 className="font-semibold">{step.title}</h3>
                    <p className="mt-1.5 leading-7 text-muted-foreground">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-7 rounded-xl border border-primary/25 bg-primary/[0.04] p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-semibold">{isAdmin ? ta("openSettingsTitle") : ta("askAdminTitle")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isAdmin ? ta("openSettingsText") : ta("askAdminText")}
                  </p>
                </div>
                {isAdmin && (
                  <Button asChild>
                    <Link href="/settings?tab=transport">
                      <Settings />
                      {ta("openSettings")}
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </section>

          <section id="checklist" className="scroll-mt-20 border-t border-border py-9">
            <h2 className="text-2xl font-bold">{ta("checklistTitle")}</h2>
            <p className="mt-2 leading-7 text-muted-foreground">{ta("checklistIntro")}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                { icon: MapPin, title: ta("checklist.centre.title"), text: ta("checklist.centre.text") },
                { icon: Bus, title: ta("checklist.vehicles.title"), text: ta("checklist.vehicles.text") },
                { icon: Users, title: ta("checklist.people.title"), text: ta("checklist.people.text") },
                { icon: CheckCircle2, title: ta("checklist.test.title"), text: ta("checklist.test.text") },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-xl border border-border p-4">
                  <Icon className="size-5 text-primary" />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="troubleshooting" className="scroll-mt-20 border-t border-border py-9">
            <div className="flex items-center gap-2">
              <CircleAlert className="size-5 text-amber-600" />
              <h2 className="text-2xl font-bold">{ta("troubleshootingTitle")}</h2>
            </div>
            <div className="mt-5 space-y-3">
              {[0, 1, 2].map((index) => (
                <details key={index} className="group rounded-xl border border-border p-4 open:bg-muted/30">
                  <summary className="cursor-pointer font-semibold">{ta(`troubleshooting.${index}.question`)}</summary>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{ta(`troubleshooting.${index}.answer`)}</p>
                </details>
              ))}
            </div>
          </section>

          <ArticleFeedback
            question={t("feedbackQuestion")}
            yes={t("yes")}
            no={t("no")}
            thanks={t("feedbackThanks")}
          />

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
            <Button asChild variant="outline">
              <Link href="/help">
                <ArrowLeft className="rtl:rotate-180" />
                {t("backToHelp")}
              </Link>
            </Button>
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              {t("nextGuidePlanned")}
              <ArrowRight className="size-4 rtl:rotate-180" />
            </span>
          </div>
        </article>

        <aside className="hidden xl:block">
          <nav aria-label={t("onThisPage")} className="sticky top-5 rounded-xl border border-border bg-card p-4">
            <p className="mb-3 text-sm font-semibold">{t("onThisPage")}</p>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <a href="#before" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("beforeTitle")}</a>
              <a href="#steps" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("stepsTitle")}</a>
              <a href="#checklist" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("checklistTitle")}</a>
              <a href="#troubleshooting" className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground">{ta("troubleshootingTitle")}</a>
            </div>
          </nav>
        </aside>
      </div>
    </div>
  );
}

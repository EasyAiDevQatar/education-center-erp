import { getTranslations } from "next-intl/server";
import {
  GraduationCap,
  BookOpenCheck,
  Trophy,
  MessagesSquare,
  MessageCircle,
} from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { RegisterForm } from "./register-form";

/**
 * The centre's public homepage, in the shape of the centre's existing site
 * (binjabrcenter.com): hero → vision → about + values → stats → stages →
 * register. Text comes from settings with i18n fallbacks, so the page reads
 * complete before anything is configured; the stages come live from the
 * GradeLevel table, so the site can never disagree with what the centre
 * actually teaches.
 */
export async function CenterHome({ locale }: { locale: string }) {
  const t = await getTranslations("site");

  const [settingsRows, levels] = await Promise.all([
    db.setting.findMany({
      where: {
        key: {
          in: [
            "centerName",
            "centerPhone",
            "siteHeroTitleAr",
            "siteHeroTitleEn",
            "siteHeroTextAr",
            "siteHeroTextEn",
            "siteAboutAr",
            "siteAboutEn",
            "siteYears",
            "siteStudents",
            "siteSuccessRate",
            "siteBranches",
            "siteWhatsApp",
          ],
        },
      },
    }),
    db.gradeLevel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const s = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  const ar = locale === "ar";
  const pick = (arKey: string, enKey: string, fallback: string) =>
    (ar ? s[arKey] : s[enKey]) || s[arKey] || fallback;

  const heroTitle = pick("siteHeroTitleAr", "siteHeroTitleEn", s.centerName || t("heroTitleDefault"));
  const heroText = pick("siteHeroTextAr", "siteHeroTextEn", t("heroTextDefault"));
  const aboutText = pick("siteAboutAr", "siteAboutEn", t("aboutTextDefault"));
  const whatsapp = (s.siteWhatsApp || s.centerPhone || "").replace(/[^\d]/g, "");

  const values = [
    { icon: GraduationCap, title: t("valueTeachers"), text: t("valueTeachersText") },
    { icon: BookOpenCheck, title: t("valuePrograms"), text: t("valueProgramsText") },
    { icon: Trophy, title: t("valueResults"), text: t("valueResultsText") },
    { icon: MessagesSquare, title: t("valueFollowUp"), text: t("valueFollowUpText") },
  ];

  const stats = [
    { value: s.siteYears || "15+", label: t("statYears") },
    { value: s.siteStudents || "1000+", label: t("statStudents") },
    { value: s.siteSuccessRate || "95%", label: t("statSuccess") },
    { value: s.siteBranches || "1", label: t("statBranches") },
  ];

  const levelOpts = levels.map((l) => ({ id: l.id, label: ar ? l.nameAr : l.nameEn }));

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-b from-accent/60 to-background">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center">
          <p className="mb-3 inline-block rounded-full bg-primary/10 px-4 py-1 text-sm font-medium text-primary">
            {t("heroBadge", { n: s.siteStudents || "1000+" })}
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
            {heroTitle}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">{heroText}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="#register">
              <Button size="lg">{t("ctaRegister")}</Button>
            </a>
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

      {/* About + values */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold">{t("aboutTitle")}</h2>
          <p className="mx-auto mt-4 max-w-3xl text-muted-foreground">{aboutText}</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {values.map((v) => (
            <div key={v.title} className="rounded-xl border border-border bg-card p-6 text-center">
              <v.icon className="mx-auto mb-3 size-8 text-primary" />
              <h3 className="font-semibold">{v.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{v.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 py-12 text-center sm:grid-cols-4">
          {stats.map((x) => (
            <div key={x.label}>
              <div className="text-4xl font-bold tabular-nums" dir="ltr">
                {x.value}
              </div>
              <div className="mt-1 text-sm opacity-90">{x.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Stages — live from the DB */}
      {levels.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold">{t("stagesTitle")}</h2>
            <p className="mt-2 text-muted-foreground">{t("stagesSubtitle")}</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {levels.map((l, i) => (
              <div key={l.id} className="rounded-xl border border-border bg-card p-6">
                <span className="text-sm font-bold text-primary tabular-nums" dir="ltr">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-1 text-lg font-semibold">{ar ? l.nameAr : l.nameEn}</h3>
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  <li>· {t("stageBullet1")}</li>
                  <li>· {t("stageBullet2")}</li>
                  <li>· {t("stageBullet3")}</li>
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Register */}
      <section id="register" className="bg-accent/40">
        <div className="mx-auto max-w-3xl px-4 py-16">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold">{t("registerTitle")}</h2>
            <p className="mt-2 text-muted-foreground">{t("registerSubtitle")}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <RegisterForm levels={levelOpts} />
          </div>
        </div>
      </section>
    </div>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Cairo } from "next/font/google";
import { routing, dirForLocale } from "@/i18n/routing";
import "../globals.css";

// Cairo supports both Arabic and Latin — one font for both locales.
const cairo = Cairo({
  subsets: ["arabic", "latin"],
  variable: "--font-cairo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "مركز تعليمي — نظام الإدارة | Education Center ERP",
  description: "نظام إدارة متكامل للمراكز التعليمية",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      dir={dirForLocale(locale)}
      className={`${cairo.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}

import { getTranslations, setRequestLocale } from "next-intl/server";
import { GraduationCap } from "lucide-react";
import { getSession } from "@/lib/session";
import { redirect } from "@/i18n/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Already authenticated → go straight to the dashboard.
  const session = await getSession();
  if (session) redirect({ href: "/", locale });

  const t = await getTranslations("auth");
  const tc = await getTranslations("common");

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <GraduationCap className="size-6" />
        </div>
        <CardTitle className="text-xl">{tc("appShort")}</CardTitle>
        <CardDescription>{t("loginSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { MessageCircle } from "lucide-react";

/** Strip everything but digits and apply Qatar's country code when absent. */
function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("974")) return digits;
  // Local Qatari numbers are 8 digits; anything longer already carries a code.
  return digits.length === 8 ? `974${digits}` : digits;
}

/**
 * Send a student's check-in code to their guardian on WhatsApp.
 *
 * Uses wa.me rather than the Anychat integration on purpose: this is a one-off
 * human action from a staff device, so it should open the sender's own WhatsApp
 * with a drafted message and let them press send, not fire automatically.
 */
export function ShareCardButton({
  name,
  token,
  phone,
}: {
  name: string;
  token: string;
  phone: string | null;
}) {
  const t = useTranslations("checkin");

  if (!phone) {
    return (
      <span className="no-print mt-1 text-[10px] text-muted-foreground">{t("noPhone")}</span>
    );
  }

  const text = t("shareMessage", { name, code: token });
  const href = `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="no-print mt-1 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <MessageCircle className="size-3" />
      {t("shareWhatsApp")}
    </a>
  );
}

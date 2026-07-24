"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssistantChat } from "@/components/assistant-chat";

/**
 * Floating AI assistant: a bubble in the corner of every staff page that
 * slides a chat panel in from the side — no trip to the menu needed. Rendered
 * by the app layout only when the module is configured, the user's role is in
 * the assistant list, and the "floating chat" toggle in Settings is on.
 */
export function AiChatWidget() {
  const t = useTranslations("assistant");
  const [open, setOpen] = useState(false);

  return (
    <>
      {!open && (
        <Button
          type="button"
          size="icon"
          aria-label={t("openChat")}
          title={t("openChat")}
          onClick={() => setOpen(true)}
          className="no-print fixed bottom-5 end-5 z-40 size-14 rounded-full shadow-lg transition-transform hover:scale-105"
        >
          <Sparkles className="size-6" />
        </Button>
      )}

      {open && (
        <div className="no-print fixed bottom-0 end-0 top-0 z-50 flex w-full max-w-[26rem] flex-col border-s border-border bg-background shadow-2xl sm:bottom-4 sm:end-4 sm:top-auto sm:h-[38rem] sm:max-h-[85vh] sm:rounded-xl sm:border">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <span className="flex items-center gap-2 font-semibold">
              <Sparkles className="size-4 text-primary" />
              {t("title")}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("closeChat")}
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 p-3">
            <AssistantChat ready compact />
          </div>
        </div>
      )}
    </>
  );
}

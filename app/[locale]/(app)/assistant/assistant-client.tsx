"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Sparkles, SendHorizonal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { askAssistant } from "./actions";
import type { AssistantTurn } from "@/lib/ai/assistant";

const STORE_KEY = "ec-assistant-chat";

/**
 * Chat over centre data. Conversation lives in sessionStorage only — there is
 * no chat table; the audit log records who asked what.
 */
export function AssistantClient({ ready }: { ready: boolean }) {
  const t = useTranslations("assistant");
  const locale = useLocale();
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (raw) setTurns(JSON.parse(raw));
    } catch {
      // corrupted storage — start fresh
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(turns.slice(-30)));
    } catch {
      // storage full — the chat still works, it just won't survive a reload
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  function ask(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setError(null);
    setInput("");
    const history = turns;
    setTurns((prev) => [...prev, { role: "user", content: q }]);
    start(async () => {
      const r = await askAssistant(locale, q, history);
      if (r.ok) {
        setTurns((prev) => [...prev, { role: "assistant", content: r.answer }]);
      } else {
        setError(r.error === "notConfigured" ? t("notConfigured") : t("failed"));
        // Roll the unanswered question back so a retry is one click.
        setTurns((prev) => prev.slice(0, -1));
        setInput(q);
      }
    });
  }

  const starters = [t("starter1"), t("starter2"), t("starter3"), t("starter4")];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      {!ready && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {t("notConfigured")}
        </p>
      )}

      <div className="min-h-[45vh] space-y-3 rounded-lg border border-border bg-card p-4">
        {turns.length === 0 && (
          <div className="space-y-3 py-8 text-center">
            <Sparkles className="mx-auto size-8 text-primary" />
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {starters.map((s) => (
                <Button key={s} type="button" variant="outline" size="sm" disabled={!ready} onClick={() => ask(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}
        {turns.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-accent",
              )}
            >
              {m.content}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <Badge variant="muted" className="animate-pulse">{t("thinking")}</Badge>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("placeholder")}
          disabled={!ready || pending}
        />
        <Button type="submit" disabled={!ready || pending || !input.trim()} className="gap-1">
          <SendHorizonal className="size-4" />
          {t("ask")}
        </Button>
        {turns.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("clear")}
            title={t("clear")}
            onClick={() => {
              setTurns([]);
              setError(null);
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </form>
      <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
    </div>
  );
}

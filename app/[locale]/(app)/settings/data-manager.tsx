"use client";

import { useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Download, Upload, FileSpreadsheet, TriangleAlert, Loader2,
  CheckCircle2, Database, Trash2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogClose,
} from "@/components/ui/dialog";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TABLES, WIPE_PHRASE, SEED_SPEC, type TableKey } from "@/lib/data-zone";
import { wipeAllData, seedDemoData, type DataState } from "./data-actions";

/* ------------------------------ import/export ------------------------------ */

export function DataManager({ canFinance }: { canFinance: boolean }) {
  const t = useTranslations("data");
  const tt = useTranslations("nav");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ table: string; text: string; ok: boolean } | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const visible = TABLES.filter((x) => !x.finance || canFinance);

  async function onFile(table: TableKey, file?: File) {
    if (!file) return;
    setBusy(table);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/import/${table}`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || json.error) {
        setResult({ table, ok: false, text: json.error ?? `HTTP ${res.status}` });
      } else {
        const errs = (json.errors ?? []).length
          ? ` — ${t("firstErrors")}: ${(json.errors as string[]).slice(0, 3).join("; ")}`
          : "";
        setResult({
          table,
          ok: true,
          text: t("importDone", { created: json.created ?? 0, skipped: json.skipped ?? 0 }) + errs,
        });
      }
    } catch (e) {
      setResult({ table, ok: false, text: e instanceof Error ? e.message : "error" });
    } finally {
      setBusy(null);
      if (fileRefs.current[table]) fileRefs.current[table]!.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <div className="rounded-lg border border-border">
        {visible.map((spec, i) => (
          <div
            key={spec.key}
            className={cn(
              "flex flex-wrap items-center gap-2 p-3",
              i > 0 && "border-t border-border",
            )}
          >
            <FileSpreadsheet className="size-4 text-muted-foreground" />
            <span className="font-medium">{tt(spec.key)}</span>

            <div className="ms-auto flex flex-wrap items-center gap-1.5">
              <a href={`/api/export/${spec.key}`} download>
                <Button type="button" variant="secondary" size="sm" className="gap-1">
                  <Download className="size-4" />
                  {t("export")}
                </Button>
              </a>
              {spec.importable && (
                <>
                  <a href={`/api/export/${spec.key}?template=1`} download>
                    <Button type="button" variant="ghost" size="sm">{t("template")}</Button>
                  </a>
                  <input
                    ref={(el) => { fileRefs.current[spec.key] = el; }}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={(e) => onFile(spec.key, e.target.files?.[0])}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    disabled={busy === spec.key}
                    onClick={() => fileRefs.current[spec.key]?.click()}
                  >
                    {busy === spec.key ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Upload className="size-4" />
                    )}
                    {t("import")}
                  </Button>
                </>
              )}
            </div>

            {result?.table === spec.key && (
              <p
                className={cn(
                  "w-full text-xs",
                  result.ok ? "text-[var(--success)]" : "text-destructive",
                )}
              >
                {result.text}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- danger zone ------------------------------- */

export function DangerZone() {
  const t = useTranslations("data");
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  const locale = useLocale();

  const [seedOpen, setSeedOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  // Defaults come from SEED_SPEC, the same registry the zod schema is built
  // from, so the modal can never offer a field the action doesn't accept.
  const [counts, setCounts] = useState<Record<string, string>>(
    Object.fromEntries(SEED_SPEC.map((s) => [s.key, String(s.default)])),
  );
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  const [res, setRes] = useState<DataState | null>(null);

  const summaryText = (s?: Record<string, number>) =>
    s ? Object.entries(s).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(" · ") : "";

  return (
    <div className="space-y-4">
      {/* Seed */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
        <div>
          <p className="inline-flex items-center gap-1.5 font-medium">
            <Database className="size-4 text-muted-foreground" />
            {t("seedTitle")}
          </p>
          <p className="text-xs text-muted-foreground">{t("seedHint")}</p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => { setRes(null); setSeedOpen(true); }}>
          {t("seedOpen")}
        </Button>
      </div>

      {/* Wipe */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <div>
          <p className="inline-flex items-center gap-1.5 font-medium text-destructive">
            <TriangleAlert className="size-4" />
            {t("wipeTitle")}
          </p>
          <p className="text-xs text-muted-foreground">{t("wipeHint")}</p>
        </div>
        <Button
          type="button"
          size="sm"
          className="gap-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onClick={() => { setRes(null); setConfirm(""); setWipeOpen(true); }}
        >
          <Trash2 className="size-4" />
          {t("wipeOpen")}
        </Button>
      </div>

      {res?.ok && (
        <p className="inline-flex items-center gap-2 rounded-md bg-success/15 px-3 py-2 text-sm text-[var(--success)]">
          <CheckCircle2 className="size-4" />
          {summaryText(res.summary) || tc("saved")}
        </p>
      )}

      {/* Seed dialog — every count editable before seeding */}
      <Dialog open={seedOpen} onOpenChange={setSeedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("seedTitle")}</DialogTitle>
          </DialogHeader>
          <p className="mb-2 text-sm text-muted-foreground">{t("seedDialogHint")}</p>
          <div className="grid grid-cols-2 gap-3">
            {SEED_SPEC.map((spec) => (
              <FormField
                key={spec.key}
                label={t(`seedFields.${spec.key}`)}
                htmlFor={`seed-${spec.key}`}
              >
                <Input
                  id={`seed-${spec.key}`}
                  type="number"
                  min="0"
                  max={spec.max}
                  dir="ltr"
                  value={counts[spec.key]}
                  onChange={(e) => setCounts({ ...counts, [spec.key]: e.target.value })}
                />
              </FormField>
            ))}
          </div>
          {res?.error && <p className="mt-2 text-sm text-destructive">{res.error}</p>}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">{tc("cancel")}</Button>
            </DialogClose>
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const parsed = Object.fromEntries(
                    SEED_SPEC.map((spec) => [spec.key, parseInt(counts[spec.key], 10) || 0]),
                  ) as Parameters<typeof seedDemoData>[1];
                  const r = await seedDemoData(locale, parsed);
                  setRes(r);
                  if (r.ok) setSeedOpen(false);
                })
              }
            >
              {pending ? tc("saving") : t("seedRun")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wipe dialog — typed confirmation */}
      <Dialog open={wipeOpen} onOpenChange={setWipeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("wipeTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {t("wipeWarning")}
            </p>
            <p className="text-sm text-muted-foreground">{t("wipeKeeps")}</p>
            <FormField label={t("wipeConfirmLabel", { phrase: WIPE_PHRASE })} htmlFor="wipe-confirm">
              <Input
                id="wipe-confirm"
                dir="ltr"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={WIPE_PHRASE}
                autoComplete="off"
              />
            </FormField>
            {res?.error && (
              <p className="text-sm text-destructive">
                {res.error === "confirmMismatch" ? t("wipeMismatch") : res.error}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">{tc("cancel")}</Button>
            </DialogClose>
            <Button
              type="button"
              disabled={pending || confirm !== WIPE_PHRASE}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                start(async () => {
                  const r = await wipeAllData(locale, confirm);
                  setRes(r);
                  if (r.ok) setWipeOpen(false);
                })
              }
            >
              {pending ? tc("saving") : t("wipeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

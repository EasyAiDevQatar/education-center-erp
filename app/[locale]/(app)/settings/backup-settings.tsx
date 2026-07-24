"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download, CloudUpload, CheckCircle2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/crud/form-field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BackupFile } from "@/lib/backups";
import { saveBackupDrive, testBackupDrive } from "./backup-actions";

function fmtSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function BackupSettings({
  backups,
  driveConfigured,
  driveEmail,
  driveFolder,
}: {
  backups: BackupFile[];
  driveConfigured: boolean;
  /** The service account's email — shown so the user knows what to share with. */
  driveEmail: string | null;
  driveFolder: string;
}) {
  const t = useTranslations("backups");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setMsg(null);
    setErr(null);
    start(async () => {
      const r = await saveBackupDrive(locale, {}, fd);
      if (r.ok) {
        setMsg(tc("saved"));
        router.refresh();
      } else setErr(r.error ?? "invalid");
    });
  }

  const runTest = () =>
    start(async () => {
      setMsg(null);
      setErr(null);
      const r = await testBackupDrive(locale);
      if (r.ok) setMsg(t("testOk"));
      else setErr(r.detail ? `${r.error}: ${r.detail}` : (r.error ?? "invalid"));
    });

  const tierVariant = (tier: string) =>
    tier === "monthly" ? "success" : tier === "weekly" ? "warning" : "default";

  return (
    <div className="space-y-6">
      {/* Server backups */}
      <div>
        <p className="mb-2 text-sm text-muted-foreground">{t("serverIntro")}</p>
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("file")}</TableHead>
                <TableHead>{t("tier")}</TableHead>
                <TableHead>{t("size")}</TableHead>
                <TableHead>{tc("date")}</TableHead>
                <TableHead>{tc("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    {t("noBackups")}
                  </TableCell>
                </TableRow>
              )}
              {backups.slice(0, 15).map((b) => (
                <TableRow key={b.name}>
                  <TableCell className="font-mono text-xs">
                    <span dir="ltr">
                      {b.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={tierVariant(b.tier)}>{te(`backupTier.${b.tier}`)}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <span dir="ltr">
                      {fmtSize(b.sizeBytes)}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <span dir="ltr">
                      {b.modifiedAt.slice(0, 16).replace("T", " ")}
                    </span>
                  </TableCell>
                  <TableCell>
                    <a href={`/api/backups/${b.name}`} download>
                      <Button variant="ghost" size="icon" aria-label={t("download")}>
                        <Download className="size-4" />
                      </Button>
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Google Drive */}
      <form onSubmit={onSave} className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center gap-2">
          <CloudUpload className="size-5 text-primary" />
          <span className="font-semibold">{t("driveTitle")}</span>
          {driveConfigured && (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="size-3" />
              {t("driveConfigured")}
            </Badge>
          )}
        </div>

        {/* The walkthrough — the part the user explicitly asked for. */}
        <ol className="list-inside list-decimal space-y-1 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
          <li>{t("guide1")}</li>
          <li>{t("guide2")}</li>
          <li>{t("guide3")}</li>
          <li>{t("guide4", { email: driveEmail ?? t("guideEmailPlaceholder") })}</li>
          <li>{t("guide5")}</li>
        </ol>

        <FormField label={t("folderId")} htmlFor="bk-folder" hint={t("folderIdHint")}>
          <Input id="bk-folder" name="backupDriveFolder" dir="ltr" defaultValue={driveFolder} />
        </FormField>
        <FormField label={t("saJson")} htmlFor="bk-sa" hint={t("saJsonHint")}>
          <textarea
            id="bk-sa"
            name="backupDriveSa"
            dir="ltr"
            rows={4}
            placeholder='{ "type": "service_account", … }'
            // Never echo the stored key back into the page — an empty box with
            // the "configured" badge means "already set; paste to replace".
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          />
        </FormField>

        {msg && <p className="text-sm text-[var(--success)]">{msg}</p>}
        {err && (
          <p className="break-all text-sm text-destructive" dir="auto">
            {/* Known codes get their message; a Drive detail string stays raw —
                the API's own words are the useful part of a failure. */}
            {tc.has(`errors.${err}`) ? tc(`errors.${err}`) : err}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? tc("saving") : tc("save")}
          </Button>
          <Button type="button" variant="outline" disabled={pending || !driveConfigured} onClick={runTest}>
            {t("testUpload")}
          </Button>
        </div>
      </form>
    </div>
  );
}

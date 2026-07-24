"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert, ArrowRight, Car, User } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSearch, useTableSearch } from "@/components/ui/table-search";
import { usePagination, TablePagination } from "@/components/ui/table-pagination";
import { cn } from "@/lib/utils";

export type ExpiringRow = {
  id: string;
  ownerKind: "employee" | "vehicle";
  ownerId: string;
  ownerName: string;
  ownerHint: string | null;
  type: string;
  number: string | null;
  expiresOn: string | null;
  days: number | null;
  level: string;
};

type Filter = "all" | "expired" | "soon" | "unknown";

function levelVariant(level: string) {
  if (level === "expired") return "destructive" as const;
  if (level === "soon") return "warning" as const;
  return "muted" as const;
}

export function ExpiringDocsClient({ rows }: { rows: ExpiringRow[] }) {
  const t = useTranslations("expiringDocs");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(
    () => ({
      all: rows.length,
      expired: rows.filter((r) => r.level === "expired").length,
      soon: rows.filter((r) => r.level === "soon").length,
      unknown: rows.filter((r) => r.level === "unknown").length,
    }),
    [rows],
  );

  const scoped = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.level === filter)),
    [rows, filter],
  );
  const search = useTableSearch(scoped, (r) => [r.ownerName, r.ownerHint, r.number, r.type]);
  const pg = usePagination(search.filtered, 20, `${filter}:${search.query}`);

  /** Employee documents are edited on the HR register; vehicles on their own. */
  const fixHref = (r: ExpiringRow) =>
    r.ownerKind === "employee" ? `/hr/${r.ownerId}?tab=documents` : `/transport/vehicles`;

  const FILTERS: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: tc("all"), count: counts.all },
    { key: "expired", label: t("expired"), count: counts.expired },
    { key: "soon", label: t("soon"), count: counts.soon },
    { key: "unknown", label: t("noExpiry"), count: counts.unknown },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              type="button"
              size="sm"
              variant={filter === f.key ? "default" : "ghost"}
              className="gap-1.5"
              onClick={() => setFilter(f.key)}
            >
              {f.key === "expired" && <TriangleAlert className="size-3.5" />}
              {f.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  filter === f.key ? "bg-primary-foreground/20" : "bg-muted",
                )}
              >
                {f.count}
              </span>
            </Button>
          ))}
        </div>
        <div className="ms-auto">
          <TableSearch
            value={search.query}
            onChange={search.setQuery}
            resultCount={search.filtered.length}
            placeholder={t("searchPlaceholder")}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          {t("allClear")}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("owner")}</TableHead>
                <TableHead>{t("docType")}</TableHead>
                <TableHead>{t("number")}</TableHead>
                <TableHead>{t("expiresOn")}</TableHead>
                <TableHead className="text-end">{t("days")}</TableHead>
                <TableHead>{tc("status")}</TableHead>
                <TableHead className="text-end">{tc("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pg.total === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {tc("noData")}
                  </TableCell>
                </TableRow>
              )}
              {pg.pageItems.map((r) => (
                <TableRow key={`${r.ownerKind}-${r.id}`}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {r.ownerKind === "vehicle" ? (
                        <Car className="size-3.5 text-muted-foreground" />
                      ) : (
                        <User className="size-3.5 text-muted-foreground" />
                      )}
                      {r.ownerKind === "vehicle" ? (
                        <span dir="ltr">{r.ownerName}</span>
                      ) : (
                        r.ownerName
                      )}
                    </span>
                    {r.ownerHint && (
                      <span className="ms-1 text-xs text-muted-foreground">{r.ownerHint}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.ownerKind === "vehicle"
                      ? te(`vehicleDocType.${r.type}`)
                      : te(`docType.${r.type}`)}
                  </TableCell>
                  <TableCell>
                    <span dir="ltr">{r.number ?? "—"}</span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <span dir="ltr">{r.expiresOn ?? "—"}</span>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {r.days == null ? "—" : r.days}
                  </TableCell>
                  <TableCell>
                    <Badge variant={levelVariant(r.level)}>{t(`level.${r.level}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <Link href={fixHref(r)}>
                      <Button type="button" variant="outline" size="sm" className="gap-1">
                        {t("fix")}
                        <ArrowRight className="size-3.5 rtl:rotate-180" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination {...pg} />
        </div>
      )}
    </>
  );
}

"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, Building2, Layers, ImageUp, Trash2, MapPin, DoorOpen } from "lucide-react";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { saveBuilding, deleteBuilding, saveFloor, deleteFloor, saveRoom, deleteRoom } from "./buildings-actions";

const ROOM_KINDS = ["CLASSROOM", "LAB", "OFFICE", "OTHER"] as const;

export type RoomRow = {
  id: string;
  floorId: string;
  name: string;
  code: string | null;
  kind: string;
  capacity: number | null;
  notes: string | null;
  active: boolean;
};
export type FloorRow = {
  id: string;
  buildingId: string;
  name: string;
  level: number;
  mapUrl: string | null;
  notes: string | null;
  rooms: RoomRow[];
};
export type BuildingRow = {
  id: string;
  name: string;
  nameEn: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  floors: FloorRow[];
};

/** Client-side downscale to a data URL — floor plans keep more detail than the
 *  logo, so a larger max side. Mirrors the centre-logo upload. */
async function toDataUrl(file: File, maxSide = 1600): Promise<string> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) {
    return await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(file);
    });
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function BuildingFields({ building }: { building?: BuildingRow }) {
  const t = useTranslations("buildings");
  const ts = useTranslations("settings");
  const tc = useTranslations("common");
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={ts("nameAr")} htmlFor="b-name">
          <Input id="b-name" name="name" defaultValue={building?.name} required />
        </FormField>
        <FormField label={ts("nameEn")} htmlFor="b-nameEn">
          <Input id="b-nameEn" name="nameEn" dir="ltr" defaultValue={building?.nameEn ?? ""} />
        </FormField>
      </div>
      <FormField label={t("address")} htmlFor="b-address">
        <Input id="b-address" name="address" defaultValue={building?.address ?? ""} />
      </FormField>
      <FormField label={tc("notes")} htmlFor="b-notes">
        <Input id="b-notes" name="notes" defaultValue={building?.notes ?? ""} />
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={building?.active ?? true} className="size-4 accent-primary" />
        {tc("active")}
      </label>
    </>
  );
}

function FloorFields({ floor, buildingId }: { floor?: FloorRow; buildingId: string }) {
  const t = useTranslations("buildings");
  const ts = useTranslations("settings");
  const tc = useTranslations("common");
  const [map, setMap] = useState(floor?.mapUrl ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input type="hidden" name="buildingId" value={buildingId} />
      <div className="grid grid-cols-2 gap-3">
        <FormField label={ts("nameAr")} htmlFor="f-name">
          <Input id="f-name" name="name" defaultValue={floor?.name} placeholder={t("floorNameHint")} required />
        </FormField>
        <FormField label={t("level")} htmlFor="f-level">
          <Input id="f-level" name="level" type="number" dir="ltr" defaultValue={floor?.level ?? 0} />
        </FormField>
      </div>

      <FormField label={t("floorMap")} htmlFor="f-map">
        <div className="space-y-2">
          <div className="flex h-40 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
            {map ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={map} alt="" className="max-h-full max-w-full object-contain" />
            ) : (
              <MapPin className="size-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex gap-1.5">
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => fileRef.current?.click()}>
              <ImageUp className="size-3.5" />
              {t("uploadMap")}
            </Button>
            {map && (
              <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setMap("")}>
                <Trash2 className="size-3.5" />
                {tc("delete")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t("floorMapHint")}</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setMap(await toDataUrl(f));
          }}
        />
        {/* The current image (existing, replaced, or cleared) posts as-is. */}
        <input type="hidden" name="mapUrl" value={map} />
      </FormField>

      <FormField label={tc("notes")} htmlFor="f-notes">
        <Input id="f-notes" name="notes" defaultValue={floor?.notes ?? ""} />
      </FormField>
    </>
  );
}

function RoomFields({ room, floorId }: { room?: RoomRow; floorId: string }) {
  const t = useTranslations("buildings");
  const ts = useTranslations("settings");
  const tc = useTranslations("common");
  return (
    <>
      <input type="hidden" name="floorId" value={floorId} />
      <div className="grid grid-cols-2 gap-3">
        <FormField label={ts("nameAr")} htmlFor="r-name">
          <Input id="r-name" name="name" defaultValue={room?.name} required />
        </FormField>
        <FormField label={t("roomCode")} htmlFor="r-code">
          <Input id="r-code" name="code" dir="ltr" defaultValue={room?.code ?? ""} />
        </FormField>
        <FormField label={t("roomKindLabel")} htmlFor="r-kind">
          <Select id="r-kind" name="kind" defaultValue={room?.kind ?? "CLASSROOM"}>
            {ROOM_KINDS.map((k) => (
              <option key={k} value={k}>{t(`roomKind.${k}`)}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("capacity")} htmlFor="r-cap">
          <Input id="r-cap" name="capacity" type="number" min="0" dir="ltr" defaultValue={room?.capacity ?? ""} />
        </FormField>
      </div>
      <FormField label={tc("notes")} htmlFor="r-notes">
        <Input id="r-notes" name="notes" defaultValue={room?.notes ?? ""} />
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={room?.active ?? true} className="size-4 accent-primary" />
        {tc("active")}
      </label>
    </>
  );
}

export function BuildingsManager({ buildings }: { buildings: BuildingRow[] }) {
  const t = useTranslations("buildings");
  const tc = useTranslations("common");
  const locale = useLocale();

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <EntityDialog
          title={t("addBuilding")}
          action={saveBuilding.bind(null, locale, null)}
          fields={<BuildingFields />}
          trigger={
            <Button size="sm" className="gap-2">
              <Plus className="size-4" />
              {t("addBuilding")}
            </Button>
          }
        />
      </div>

      {buildings.length === 0 ? (
        <p className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <div className="space-y-3">
          {buildings.map((b) => (
            <div key={b.id} className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
                <Building2 className="size-4 text-muted-foreground" />
                <span className="font-medium">{b.name}</span>
                {b.address && <span className="text-xs text-muted-foreground">{b.address}</span>}
                {!b.active && <Badge variant="muted">{tc("inactive")}</Badge>}
                <Badge variant="muted" className="ms-auto gap-1">
                  <Layers className="size-3" />
                  {t("floorCount", { n: b.floors.length })}
                </Badge>
                <EntityDialog
                  title={t("editBuilding")}
                  action={saveBuilding.bind(null, locale, b.id)}
                  fields={<BuildingFields building={b} />}
                  trigger={<Button size="icon" variant="ghost" aria-label={tc("edit")}><Pencil className="size-4" /></Button>}
                />
                <DeleteButton action={deleteBuilding.bind(null, locale, b.id)} />
              </div>

              <div className="space-y-2 p-3">
                {b.floors.length === 0 && <p className="text-sm text-muted-foreground">{t("noFloors")}</p>}
                {[...b.floors].sort((x, y) => x.level - y.level).map((f) => (
                  <div key={f.id} className="rounded-md border border-border/60">
                    <div className="flex items-center gap-3 p-2">
                      {f.mapUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.mapUrl} alt="" className="size-12 shrink-0 rounded object-cover" />
                      ) : (
                        <div className="flex size-12 shrink-0 items-center justify-center rounded bg-muted/40">
                          <MapPin className="size-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{f.name}</p>
                        {f.notes && <p className="truncate text-xs text-muted-foreground">{f.notes}</p>}
                      </div>
                      <Badge variant="muted" className="gap-1">
                        <DoorOpen className="size-3" />
                        {t("roomCount", { n: f.rooms.length })}
                      </Badge>
                      {f.mapUrl && <Badge variant="success">{t("hasMap")}</Badge>}
                      <EntityDialog
                        title={t("editFloor")}
                        action={saveFloor.bind(null, locale, f.id)}
                        fields={<FloorFields floor={f} buildingId={b.id} />}
                        trigger={<Button size="icon" variant="ghost" aria-label={tc("edit")}><Pencil className="size-4" /></Button>}
                      />
                      <DeleteButton action={deleteFloor.bind(null, locale, f.id)} />
                    </div>

                    {/* Rooms on this floor */}
                    <div className="space-y-1.5 border-t border-border/60 p-2 ps-4">
                      {[...f.rooms].sort((x, y) => x.name.localeCompare(y.name)).map((r) => (
                        <div key={r.id} className="flex items-center gap-2 text-sm">
                          <DoorOpen className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="font-medium">{r.name}</span>
                          {r.code && <span className="text-xs text-muted-foreground" dir="ltr">{r.code}</span>}
                          <Badge variant="muted" className="text-[10px]">{t(`roomKind.${r.kind}`)}</Badge>
                          {r.capacity != null && (
                            <span className="text-xs text-muted-foreground" dir="ltr">{t("seats", { n: r.capacity })}</span>
                          )}
                          {!r.active && <Badge variant="muted">{tc("inactive")}</Badge>}
                          <span className="ms-auto flex items-center">
                            <EntityDialog
                              title={t("editRoom")}
                              action={saveRoom.bind(null, locale, r.id)}
                              fields={<RoomFields room={r} floorId={f.id} />}
                              trigger={<Button size="icon" variant="ghost" className="size-7" aria-label={tc("edit")}><Pencil className="size-3.5" /></Button>}
                            />
                            <DeleteButton action={deleteRoom.bind(null, locale, r.id)} />
                          </span>
                        </div>
                      ))}
                      <EntityDialog
                        title={t("addRoom")}
                        action={saveRoom.bind(null, locale, null)}
                        fields={<RoomFields floorId={f.id} />}
                        trigger={
                          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs">
                            <Plus className="size-3.5" />
                            {t("addRoom")}
                          </Button>
                        }
                      />
                    </div>
                  </div>
                ))}
                <EntityDialog
                  title={t("addFloor")}
                  action={saveFloor.bind(null, locale, null)}
                  fields={<FloorFields buildingId={b.id} />}
                  trigger={
                    <Button size="sm" variant="outline" className="gap-1">
                      <Plus className="size-3.5" />
                      {t("addFloor")}
                    </Button>
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

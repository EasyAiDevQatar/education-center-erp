import "server-only";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";

/**
 * The day's pickup / drop-off manifest, per teacher who teaches at a home.
 *
 * The rule the coordinator cares about: a teacher taken to a lesson must have
 * an onward ride — to the next lesson, the centre, or home at the end of the
 * day. Nobody is left at a stranger's house. This reconstructs each teacher's
 * planned movement from the trip stops that carry them and flags any break in
 * that chain, so a gap is loud rather than discovered by a stranded teacher.
 */

export type ManifestStop = {
  kind: string; // PICKUP | DROPOFF
  label: string;
  plannedMin: number;
  tripId: string;
  atHome: boolean;
};

export type ManifestIssue =
  | { code: "noTrip" }
  | { code: "sessionNotServed"; detail: string }
  | { code: "notBroughtHome" }
  | { code: "startsWithDropoff" };

export type ManifestTeacher = {
  teacherId: string;
  name: string;
  homeSessions: number;
  stops: ManifestStop[];
  issues: ManifestIssue[];
};

export type Manifest = {
  day: string;
  teachers: ManifestTeacher[];
  summary: { total: number; ok: number; withIssues: number; noTrip: number };
};

const near = (
  a: { lat: number; lng: number },
  b: { lat: number | null; lng: number | null },
) => b.lat != null && b.lng != null && Math.abs(a.lat - b.lat) < 0.005 && Math.abs(a.lng - b.lng) < 0.005;

export async function buildManifest(locale: string, dayIso: string): Promise<Manifest> {
  const start = new Date(`${dayIso}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const homeSessions = await db.session.findMany({
    where: { date: { gte: start, lt: end }, location: "HOME", teacherId: { not: null } },
    include: { teacher: true, student: true },
  });

  // Group home sessions by teacher.
  const byTeacher = new Map<
    string,
    { teacher: (typeof homeSessions)[number]["teacher"]; sessions: typeof homeSessions }
  >();
  for (const s of homeSessions) {
    if (!s.teacher) continue;
    const k = s.teacher.id;
    if (!byTeacher.has(k)) byTeacher.set(k, { teacher: s.teacher, sessions: [] });
    byTeacher.get(k)!.sessions.push(s);
  }

  const teacherIds = [...byTeacher.keys()];
  const stops = teacherIds.length
    ? await db.tripStop.findMany({
        where: {
          passengerTeacherId: { in: teacherIds },
          trip: { date: { gte: start, lt: end } },
        },
        include: { trip: { select: { id: true, status: true } } },
        orderBy: { plannedMin: "asc" },
      })
    : [];

  const stopsByTeacher = new Map<string, typeof stops>();
  for (const st of stops) {
    const k = st.passengerTeacherId!;
    if (!stopsByTeacher.has(k)) stopsByTeacher.set(k, []);
    stopsByTeacher.get(k)!.push(st);
  }

  const teachers: ManifestTeacher[] = [];
  for (const [teacherId, { teacher, sessions }] of byTeacher) {
    const raw = (stopsByTeacher.get(teacherId) ?? []).sort((a, b) => a.plannedMin - b.plannedMin);
    const home = { lat: teacher!.homeLat, lng: teacher!.homeLng };
    const stopsOut: ManifestStop[] = raw.map((st) => ({
      kind: st.kind,
      label: st.label,
      plannedMin: st.plannedMin,
      tripId: st.trip.id,
      atHome: near({ lat: st.lat, lng: st.lng }, home),
    }));

    const issues: ManifestIssue[] = [];
    if (raw.length === 0) {
      issues.push({ code: "noTrip" });
    } else {
      // The chain must open by collecting them, not by dropping them somewhere.
      if (stopsOut[0].kind === "DROPOFF") issues.push({ code: "startsWithDropoff" });
      // Every home lesson must actually be served by a drop-off.
      for (const s of sessions) {
        const served = raw.some((st) => st.sessionId === s.id && st.kind === "DROPOFF");
        if (!served) {
          issues.push({
            code: "sessionNotServed",
            detail: `${s.student.homeCode ?? displayName(s.student, locale)}`,
          });
        }
      }
      // The day must end with them delivered home — a final drop-off elsewhere
      // means they were left with no onward ride.
      const last = stopsOut[stopsOut.length - 1];
      if (!(last.kind === "DROPOFF" && last.atHome)) issues.push({ code: "notBroughtHome" });
    }

    teachers.push({
      teacherId,
      name: displayName(teacher!, locale),
      homeSessions: sessions.length,
      stops: stopsOut,
      issues,
    });
  }

  teachers.sort((a, b) => b.issues.length - a.issues.length || a.name.localeCompare(b.name));

  const noTrip = teachers.filter((t) => t.issues.some((i) => i.code === "noTrip")).length;
  const withIssues = teachers.filter((t) => t.issues.length > 0).length;
  return {
    day: dayIso,
    teachers,
    summary: { total: teachers.length, ok: teachers.length - withIssues, withIssues, noTrip },
  };
}

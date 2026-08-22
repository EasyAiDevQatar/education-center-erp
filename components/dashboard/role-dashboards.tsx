import { getTranslations } from "next-intl/server";
import {
  Bus,
  CalendarClock,
  CalendarDays,
  CarFront,
  Clock,
  FileWarning,
  Gauge,
  GraduationCap,
  Receipt,
  Route,
  TrendingUp,
  TriangleAlert,
  UserCheck,
  UserPlus,
  UserRoundX,
  UserX,
  Users,
  Wallet,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { StatCard } from "@/components/stat-card";
import { formatMoney } from "@/lib/money";
import {
  receptionToday, cashierToday, academicToday, transportToday, hrOverview,
} from "@/lib/role-dashboard";

/**
 * A dashboard per job.
 *
 * Every panel is a server component that calls only its own reader, so a role
 * never fetches a figure it is not allowed to see. That is deliberate: hiding a
 * number in JSX still sends it to the browser, and "the receptionist can read
 * the centre's profit in devtools" is the same leak as printing it on the page.
 *
 * Each panel also links onward to the pages that role can actually open, so the
 * dashboard is a way in to the job rather than a wall of numbers.
 */

/** A row of quick links, so the dashboard is a starting point not a dead end. */
async function Shortcuts({ items }: { items: { href: string; label: string }[] }) {
  return (
    <div className="mt-6 flex flex-wrap gap-2">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm transition hover:bg-accent"
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ reception --- */

export async function ReceptionDashboard() {
  const d = await receptionToday();
  const t = await getTranslations("roleDash");
  const tn = await getTranslations("nav");
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("sessionsToday")} value={String(d.today)} icon={CalendarDays} tone="primary" />
        <StatCard label={t("checkedIn")} value={String(d.checkedIn)} icon={UserCheck} tone="success" />
        <StatCard label={t("stillExpected")} value={String(d.pending)} icon={Clock} />
        <StatCard label={t("absent")} value={String(d.noShow)} icon={UserX} tone={d.noShow ? "destructive" : undefined} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("completedToday")} value={String(d.completed)} icon={UserCheck} />
        <StatCard label={t("newLeads")} value={String(d.newLeads)} icon={UserPlus} />
        <StatCard label={t("familiesOwing")} value={String(d.familiesOwing)} icon={Receipt} />
      </div>
      <Shortcuts items={[
        { href: "/checkin", label: tn("checkin") },
        { href: "/calendar", label: tn("calendar") },
        { href: "/sessions", label: tn("sessions") },
        { href: "/payments", label: tn("payments") },
        { href: "/leads", label: tn("leads") },
      ]} />
    </>
  );
}

/* -------------------------------------------------------------- cashier --- */

export async function CashierDashboard({ currency }: { currency: string }) {
  const d = await cashierToday();
  const t = await getTranslations("roleDash");
  const tn = await getTranslations("nav");
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("collectedToday")} value={formatMoney(d.collectedToday)} suffix={currency} icon={Wallet} tone="success" />
        <StatCard label={t("collectedMonth")} value={formatMoney(d.collectedMonth)} suffix={currency} icon={TrendingUp} tone="primary" />
        <StatCard label={t("receiptsToday")} value={String(d.receiptsToday)} icon={Receipt} />
        <StatCard label={t("outstanding")} value={formatMoney(d.outstanding)} suffix={currency} icon={Wallet} tone={d.outstanding > 0 ? "destructive" : undefined} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("familiesOwing")} value={String(d.familiesOwing)} icon={Users} />
      </div>
      <Shortcuts items={[
        { href: "/payments", label: tn("payments") },
        { href: "/packages", label: tn("packages") },
        { href: "/students", label: tn("students") },
        { href: "/guardians", label: tn("guardians") },
      ]} />
    </>
  );
}

/* ------------------------------------------------------------- academic --- */

export async function AcademicDashboard() {
  const d = await academicToday();
  const t = await getTranslations("roleDash");
  const tn = await getTranslations("nav");
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("sessionsToday")} value={String(d.today)} icon={CalendarDays} tone="primary" />
        <StatCard label={t("sessionsWeek")} value={String(d.week)} icon={CalendarClock} />
        <StatCard label={t("attendanceRate")} value={d.attendanceRate === null ? "—" : String(d.attendanceRate)} suffix={d.attendanceRate === null ? undefined : "%"} icon={Gauge} tone="success" />
        <StatCard label={t("activeTeachers")} value={String(d.activeTeachers)} icon={GraduationCap} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("unassignedSessions")} value={String(d.unassigned)} icon={TriangleAlert} tone={d.unassigned ? "destructive" : undefined} />
        <StatCard label={t("absencesWeek")} value={String(d.absencesWeek)} icon={UserX} />
      </div>
      <Shortcuts items={[
        { href: "/planner", label: tn("planner") },
        { href: "/calendar", label: tn("calendar") },
        { href: "/sessions", label: tn("sessions") },
        { href: "/teachers", label: tn("teachers") },
        { href: "/checkin", label: tn("checkin") },
      ]} />
    </>
  );
}

/* ------------------------------------------------------------ transport --- */

export async function TransportDashboard() {
  const d = await transportToday();
  const t = await getTranslations("roleDash");
  const tn = await getTranslations("nav");
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("tripsToday")} value={String(d.trips)} icon={Route} tone="primary" />
        <StatCard label={t("undriven")} value={String(d.undriven)} icon={CarFront} tone={d.undriven ? "destructive" : undefined} />
        <StatCard label={t("blockedTrips")} value={String(d.blocked)} icon={TriangleAlert} tone={d.blocked ? "destructive" : undefined} />
        <StatCard label={t("kmToday")} value={String(d.km)} icon={Gauge} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("vehicles")} value={String(d.vehicles)} icon={Bus} />
        <StatCard label={t("drivers")} value={String(d.drivers)} icon={CarFront} />
      </div>
      <Shortcuts items={[
        { href: "/transport/master", label: tn("transportMaster") },
        { href: "/transport/planner", label: tn("transportPlanner") },
        { href: "/transport/manifest", label: tn("transportManifest") },
        { href: "/transport/drivers", label: tn("transportDrivers") },
        { href: "/transport/vehicles", label: tn("transportVehicles") },
      ]} />
    </>
  );
}

/* ------------------------------------------------------------------ HR --- */

export async function HrDashboard() {
  const d = await hrOverview();
  const t = await getTranslations("roleDash");
  const tn = await getTranslations("nav");
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("headcount")} value={String(d.headcount)} icon={Users} tone="primary" />
        <StatCard label={t("onLeave")} value={String(d.onLeave)} icon={CalendarClock} />
        <StatCard label={t("docsExpiring")} value={String(d.expiring)} icon={FileWarning} tone={d.expiring ? "destructive" : undefined} />
        <StatCard label={t("docsExpired")} value={String(d.expired)} icon={TriangleAlert} tone={d.expired ? "destructive" : undefined} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("pendingLeave")} value={String(d.pendingLeave)} icon={CalendarDays} tone={d.pendingLeave ? "primary" : undefined} />
      </div>
      <Shortcuts items={[
        { href: "/hr", label: tn("hrRegister") },
        { href: "/hr/documents", label: tn("hrDocuments") },
        { href: "/hr/leave", label: tn("hrLeave") },
        { href: "/payroll/runs", label: tn("payrollRuns") },
      ]} />
    </>
  );
}

/**
 * The dashboard for somebody the system cannot place.
 *
 * A teacher, parent or driver whose account is not linked to their record has
 * no portal to be sent to, and every role that is not named explicitly lands
 * here. It used to be the reception dashboard, which meant an unlinked driver
 * opened the centre's morning: how many families owe money, how many new
 * leads, and shortcuts into payments. None of that was reachable — the page
 * guards held — but it was all readable, and reading it was never the
 * intention.
 *
 * Least privilege as the default, and a sentence explaining why the screen is
 * empty. "Nothing here" with no explanation reads as a broken system; the
 * person needs to know it is an account that has not been finished.
 */
export async function UnlinkedDashboard({ role }: { role: string }) {
  const t = await getTranslations("dashboard");
  // Role names live in their own top-level namespace, not under enums.
  const tr = await getTranslations("roles");

  return (
    <div className="mx-auto max-w-md rounded-lg border border-border p-6 text-center">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
        <UserRoundX className="size-6 text-muted-foreground" />
      </div>
      <p className="font-semibold">{t("notLinkedTitle")}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("notLinkedBody", { role: tr.has(role) ? tr(role) : role })}
      </p>
    </div>
  );
}

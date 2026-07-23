import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toNumber, formatMoney } from "@/lib/money";
import { getStudentBalance } from "@/lib/balances";
import { packageStatusFor } from "@/lib/billing-rules";
import { applyPackageHours, syncSessionPaymentStatus } from "@/lib/billing";
import { dispatch, centerSettings } from "@/lib/integrations/notify";
import { OPEN_LEAD_STATUSES } from "@/lib/leads";
import { transportEnabled } from "@/lib/transport/settings";
import { buildDayPlan, generateDayTrips } from "@/lib/transport/trip-data";

/**
 * Daily maintenance + reminders.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron
 *   add `?dry=1` to compute without sending.
 *
 * Jobs: tomorrow's session reminders, outstanding-balance reminders (with a
 * cooldown), low/expiring package notices, package status sweeping, due lead
 * follow-ups, auto-completion of unmarked sessions, and — when the transport
 * module is on — tomorrow's trip proposals.
 * Every job is best-effort — one failure never blocks the others.
 */

/** Don't re-send a balance reminder to the same student within this window. */
const BALANCE_COOLDOWN_DAYS = 7;
/** Warn when a package drops to this many hours or fewer. */
const PACKAGE_LOW_HOURS = 2;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const report: Record<string, unknown> = { dry, at: new Date().toISOString() };

  const { center, currency } = await centerSettings();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  /* 1. Tomorrow's sessions ------------------------------------------------- */
  try {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 1);
    const from = new Date(`${ymd(start)}T00:00:00.000Z`);
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 1);

    const sessions = await db.session.findMany({
      where: { date: { gte: from, lt: to }, status: { in: ["SCHEDULED", "DRAFT"] } },
      include: { student: { include: { guardian: true } }, teacher: true },
    });
    report.sessionReminders = sessions.length;
    if (!dry) {
      for (const s of sessions) {
        await dispatch(
          "SESSION_REMINDER",
          [
            { audience: "TEACHER", phone: s.teacher?.phone ?? null },
            { audience: "STUDENT", phone: s.student.phone },
            { audience: "PARENT", phone: s.student.guardian?.phone ?? null },
          ],
          {
            student: s.student.name,
            teacher: s.teacher?.name ?? "",
            date: ymd(s.date),
            time: s.date.toISOString().slice(11, 16),
            center,
            currency,
          },
          { type: "Session", id: s.id },
        );
      }
    }
  } catch (e) {
    report.sessionRemindersError = String(e);
  }

  /* 2. Outstanding balances ------------------------------------------------ */
  try {
    const threshold = toNumber(
      (await db.setting.findUnique({ where: { key: "balanceReminderThreshold" } }))?.value ?? "1",
    );
    const cooldownSince = new Date();
    cooldownSince.setUTCDate(cooldownSince.getUTCDate() - BALANCE_COOLDOWN_DAYS);

    const students = await db.student.findMany({
      where: { active: true },
      include: { guardian: true },
    });
    let sent = 0;
    let skippedCooldown = 0;
    for (const st of students) {
      const { balance } = await getStudentBalance(st.id);
      if (balance <= threshold) continue;

      const recent = await db.notificationLog.findFirst({
        where: {
          event: "BALANCE_REMINDER",
          entityId: st.id,
          status: "SENT",
          createdAt: { gte: cooldownSince },
        },
      });
      if (recent) { skippedCooldown++; continue; }

      sent++;
      if (!dry) {
        await dispatch(
          "BALANCE_REMINDER",
          [
            { audience: "STUDENT", phone: st.phone },
            { audience: "PARENT", phone: st.guardian?.phone ?? null },
          ],
          { student: st.name, amount: formatMoney(balance), currency, center },
          { type: "Student", id: st.id },
        );
      }
    }
    report.balanceReminders = sent;
    report.balanceSkippedByCooldown = skippedCooldown;
  } catch (e) {
    report.balanceRemindersError = String(e);
  }

  /* 3. Package status sweep + low-balance notices --------------------------- */
  try {
    const packages = await db.package.findMany({
      where: { status: { not: "COMPLETED" } },
      include: { student: { include: { guardian: true } } },
    });
    let statusUpdates = 0;
    let lowNotices = 0;
    for (const p of packages) {
      const total = toNumber(p.totalHours);
      const used = toNumber(p.hoursUsed);
      const next = packageStatusFor(total, used, p.expiresAt);
      if (next !== p.status) {
        statusUpdates++;
        if (!dry) await db.package.update({ where: { id: p.id }, data: { status: next } });
      }
      const remaining = total - used;
      if (next === "ACTIVE" && remaining > 0 && remaining <= PACKAGE_LOW_HOURS) {
        lowNotices++;
        if (!dry) {
          await dispatch(
            "PACKAGE_LOW",
            [
              { audience: "STUDENT", phone: p.student.phone },
              { audience: "PARENT", phone: p.student.guardian?.phone ?? null },
            ],
            { student: p.student.name, hours: String(remaining), center, currency },
            { type: "Package", id: p.id },
          );
        }
      }
    }
    report.packageStatusUpdates = statusUpdates;
    report.packageLowNotices = lowNotices;
  } catch (e) {
    report.packageSweepError = String(e);
  }

  /* 4. Lead follow-ups that have come due ----------------------------------- */
  // Reported, not messaged: the follow-up is a task for centre staff, and the
  // lead has no account to notify. The board highlights them; this makes the
  // count visible to whoever watches the cron output.
  try {
    const today = new Date();
    const endOfToday = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999),
    );
    const due = await db.lead.findMany({
      where: {
        status: { in: OPEN_LEAD_STATUSES },
        followUpAt: { not: null, lte: endOfToday },
      },
      select: { id: true, name: true, followUpAt: true },
      orderBy: { followUpAt: "asc" },
    });
    report.leadFollowUpsDue = due.length;
    report.leadFollowUps = due.slice(0, 20).map((l) => ({
      id: l.id,
      name: l.name,
      followUpAt: l.followUpAt?.toISOString().slice(0, 10) ?? null,
    }));
  } catch (e) {
    report.leadFollowUpError = String(e);
  }

  /* 5. Auto-complete sessions nobody marked --------------------------------- */
  // A scheduled lesson whose end time passed and that nobody touched is almost
  // always one that simply happened. Completing it makes it billable, so each
  // one is flagged `autoCompleted` and shows in the check-in review list until
  // a human accepts or undoes it — fast by default, still auditable.
  try {
    const graceHours = parseInt(
      (await db.setting.findUnique({ where: { key: "autoCompleteGraceHours" } }))?.value ?? "6",
      10,
    );
    const cutoff = new Date(Date.now() - graceHours * 60 * 60 * 1000);

    const stale = await db.session.findMany({
      // DRAFT is excluded deliberately: an unconfirmed plan is not attendance.
      where: { status: "SCHEDULED", date: { lt: cutoff } },
      select: { id: true, date: true, hours: true },
    });

    let completed = 0;
    for (const s of stale) {
      // `date` is the start; only sweep once the lesson has actually ended.
      const endsAt = new Date(s.date.getTime() + toNumber(s.hours) * 60 * 60 * 1000);
      if (endsAt > cutoff) continue;
      if (!dry) {
        await db.$transaction(async (tx) => {
          await tx.session.update({
            where: { id: s.id },
            data: { status: "COMPLETED", autoCompleted: true },
          });
          await applyPackageHours(tx, s.id);
          await syncSessionPaymentStatus(tx, s.id);
        });
      }
      completed++;
    }
    report.autoCompleted = completed;
    report.autoCompleteGraceHours = graceHours;
  } catch (e) {
    report.autoCompleteError = String(e);
  }

  /* 6. Tomorrow's transport proposals -------------------------------------- */
  // Only when the module is on. The output is PROPOSED trips, never dispatched
  // work: the coordinator still approves the board in the morning.
  try {
    if (await transportEnabled()) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 1);
      const day = ymd(d);
      report.transportDay = day;
      if (dry) {
        const plan = await buildDayPlan("ar", day);
        report.transportPlanned = plan.assignments.length;
        report.transportUnassigned = plan.unassigned.length;
      } else {
        report.transport = await generateDayTrips("ar", day, null);
      }
    } else {
      report.transport = "disabled";
    }
  } catch (e) {
    report.transportError = String(e);
  }

  return NextResponse.json({ ok: true, ...report });
}

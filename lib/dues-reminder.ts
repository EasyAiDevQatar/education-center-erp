import "server-only";
import { db } from "@/lib/db";
import { toNumber, formatMoney } from "@/lib/money";
import { getStudentBalance } from "@/lib/balances";
import { dispatch, centerSettings } from "@/lib/integrations/notify";

/**
 * Remind every family that owes money.
 *
 * Lifted out of the nightly cron so a person can press it too. The office
 * often wants to chase on a Thursday afternoon rather than wait for 07:00, and
 * the alternative — opening each student and sending by hand — is how families
 * get chased twice and others not at all.
 *
 * The cooldown is the reason this belongs in one place. Sending the same
 * reminder every night is how a centre teaches parents to mute it, so a family
 * reminded recently is skipped; pressing the button does not override that,
 * because a person clicking twice is exactly the case it protects against.
 */

export const BALANCE_COOLDOWN_DAYS = 3;

export type ReminderRun = {
  sent: number;
  skippedByCooldown: number;
  /** Owe money but have no reachable number — the office has to ring them. */
  unreachable: number;
};

export async function remindOutstandingBalances(
  opts: { dry?: boolean } = {},
): Promise<ReminderRun> {
  const { center, currency } = await centerSettings();
  const threshold = toNumber(
    (await db.setting.findUnique({ where: { key: "balanceReminderThreshold" } }))?.value ?? "1",
  );
  const cooldownSince = new Date();
  cooldownSince.setUTCDate(cooldownSince.getUTCDate() - BALANCE_COOLDOWN_DAYS);

  const students = await db.student.findMany({
    where: { active: true },
    include: { guardian: true },
  });

  const run: ReminderRun = { sent: 0, skippedByCooldown: 0, unreachable: 0 };

  for (const st of students) {
    const { balance } = await getStudentBalance(st.id);
    if (balance <= threshold) continue;

    if (!st.phone && !st.guardian?.phone) {
      run.unreachable++;
      continue;
    }

    const recent = await db.notificationLog.findFirst({
      where: {
        event: "BALANCE_REMINDER",
        entityId: st.id,
        status: "SENT",
        createdAt: { gte: cooldownSince },
      },
    });
    if (recent) {
      run.skippedByCooldown++;
      continue;
    }

    run.sent++;
    if (!opts.dry) {
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
  return run;
}

// Deciding which sessions a payment settles.
//
// Pure module — no imports, no DB — because this is money being applied to
// specific debts, and getting it wrong quietly leaves a session marked unpaid
// (or paid) when it isn't.
//
// The rule is oldest-first. A centre chasing a balance wants the longest
// outstanding lesson cleared first; leaving old debt behind while settling
// today's is how a balance becomes unexplainable.

export type PayableSession = {
  id: string;
  /** YYYY-MM-DD — the tie-break for "oldest" is the id, so runs are stable. */
  date: string;
  teacherId: string | null;
  teacherName: string;
  total: number;
  allocated: number;
  outstanding: number;
};

export type SuggestedLine = {
  sessionId: string;
  amount: number;
  /** The payment ran out partway through this session. */
  partial: boolean;
};

export type Suggestion = {
  lines: SuggestedLine[];
  /** Money actually placed against sessions. */
  allocated: number;
  /** Payment money with nowhere to go — an overpayment, i.e. credit. */
  unallocated: number;
  /** Debt still standing once this payment is applied. */
  stillOwing: number;
  coversAll: boolean;
  /** Distinct teachers among the sessions being settled. */
  teacherCount: number;
};

/** Money compares to the fils, not to floating-point dust. */
const EPS = 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Oldest first, then by id so two runs never disagree. */
export function oldestFirst(sessions: PayableSession[]): PayableSession[] {
  return [...sessions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
}

/**
 * Suggest how a payment should be spread across outstanding sessions.
 *
 * Fills each session completely before moving to the next, so the common cases
 * fall out on their own: a payment covering everything settles every teacher,
 * and a payment against a single teacher's debt lands entirely on that teacher.
 * A short payment stops partway, and the session it stopped on is flagged
 * `partial` so the UI can say so rather than implying the lesson is settled.
 */
export function suggestAllocation(
  sessions: PayableSession[],
  amount: number,
): Suggestion {
  const payable = oldestFirst(sessions).filter((s) => s.outstanding > EPS);
  const totalOwing = round2(payable.reduce((a, s) => a + s.outstanding, 0));

  let remaining = round2(Math.max(0, amount));
  const lines: SuggestedLine[] = [];

  for (const s of payable) {
    if (remaining <= EPS) break;
    const take = round2(Math.min(remaining, s.outstanding));
    if (take <= EPS) continue;
    lines.push({
      sessionId: s.id,
      amount: take,
      partial: take + EPS < s.outstanding,
    });
    remaining = round2(remaining - take);
  }

  const allocated = round2(lines.reduce((a, l) => a + l.amount, 0));
  const settled = new Set(lines.map((l) => l.sessionId));

  return {
    lines,
    allocated,
    unallocated: round2(Math.max(0, amount - allocated)),
    stillOwing: round2(Math.max(0, totalOwing - allocated)),
    coversAll: allocated + EPS >= totalOwing && totalOwing > 0,
    teacherCount: new Set(
      payable.filter((s) => settled.has(s.id)).map((s) => s.teacherId ?? "—"),
    ).size,
  };
}

export type TeacherSlice = {
  teacherId: string | null;
  teacherName: string;
  outstanding: number;
  allocated: number;
  sessions: number;
};

/**
 * The same allocation seen per teacher.
 *
 * Payouts are per teacher, so "who did this money settle for" is the question
 * actually asked at the desk — the per-session list alone does not answer it.
 */
export function byTeacher(
  sessions: PayableSession[],
  lines: SuggestedLine[],
): TeacherSlice[] {
  const amountOf = new Map(lines.map((l) => [l.sessionId, l.amount]));
  const acc = new Map<string, TeacherSlice>();

  for (const s of oldestFirst(sessions)) {
    if (s.outstanding <= EPS) continue;
    const key = s.teacherId ?? "—";
    const cur =
      acc.get(key) ??
      { teacherId: s.teacherId, teacherName: s.teacherName, outstanding: 0, allocated: 0, sessions: 0 };
    cur.outstanding = round2(cur.outstanding + s.outstanding);
    cur.allocated = round2(cur.allocated + (amountOf.get(s.id) ?? 0));
    cur.sessions += 1;
    acc.set(key, cur);
  }

  return [...acc.values()].sort((a, b) => b.allocated - a.allocated || a.teacherName.localeCompare(b.teacherName));
}

/**
 * Validate a hand-edited allocation before it is written.
 *
 * Over-allocating a session would push it past PAID and corrupt the balance;
 * over-allocating the payment would invent money that was never received.
 */
export function validateAllocation(
  sessions: PayableSession[],
  lines: SuggestedLine[],
  amount: number,
): { ok: boolean; error?: "overSession" | "overPayment"; allocated: number } {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  for (const l of lines) {
    const s = byId.get(l.sessionId);
    if (!s) return { ok: false, error: "overSession", allocated: 0 };
    if (l.amount > s.outstanding + EPS) {
      return { ok: false, error: "overSession", allocated: 0 };
    }
  }
  const allocated = round2(lines.reduce((a, l) => a + l.amount, 0));
  if (allocated > round2(amount) + EPS) {
    return { ok: false, error: "overPayment", allocated };
  }
  return { ok: true, allocated };
}

/**
 * The teacher a payment header should record, inferred from the allocation.
 *
 * Picking sessions is also picking whose lessons the money settles: when every
 * allocated line belongs to one teacher, that teacher is the obvious header
 * value. A mixed split has no single honest answer, so null — the per-session
 * allocations already carry the split for payouts.
 */
export function inferTeacher(
  sessions: PayableSession[],
  lines: { sessionId: string; amount: number }[],
): string | null {
  const byId = new Map(sessions.map((x) => [x.id, x]));
  const ids = new Set<string>();
  for (const l of lines) {
    if (l.amount <= EPS) continue;
    const row = byId.get(l.sessionId);
    if (!row) continue;
    if (!row.teacherId) return null; // a teacherless session breaks the claim
    ids.add(row.teacherId);
  }
  return ids.size === 1 ? [...ids][0] : null;
}

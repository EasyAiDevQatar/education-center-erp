import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(), archived: vi.fn(), transaction: vi.fn(), snapshot: vi.fn(), sync: vi.fn(),
  post: vi.fn(), notify: vi.fn(),
  tx: {
    session: { upsert: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    student: { findFirst: vi.fn() }, teacher: { findFirst: vi.fn() },
    gradeLevel: { findFirst: vi.fn() }, payment: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/session", () => ({ getSession: mocks.viewer }));
vi.mock("@/lib/rbac", () => ({ STAFF_ROLES: ["ADMIN", "ACCOUNTANT", "RECEPTIONIST"] }));
vi.mock("@/lib/attendance", () => ({ applyMark: vi.fn(), applyAttendanceMarkInTransaction: mocks.snapshot }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/academic-year", () => ({ guardArchived: mocks.archived }));
vi.mock("@/lib/billing", () => ({
  attendanceBillablePolicy: vi.fn().mockResolvedValue({ basis: "PLANNED" }),
  snapshotBillableSession: mocks.snapshot, syncSessionPaymentStatus: mocks.sync,
}));
vi.mock("@/lib/balances", () => ({ nextReceiptNo: vi.fn().mockResolvedValue("1002") }));
vi.mock("@/lib/accounting/journal-data", () => ({ accountingEnabled: vi.fn().mockResolvedValue(true), postSource: mocks.post }));
vi.mock("@/lib/accounting/posting", () => ({ linesForPayment: vi.fn().mockReturnValue([]) }));
vi.mock("@/lib/integrations/notify", () => ({ notifyPayment: mocks.notify, notifySession: mocks.notify }));

import { createConfirmedPlannerSession } from "@/app/[locale]/(app)/planner/actions";

const input = {
  requestId: "b6802331-e9f8-4b79-9d97-900b940c39cb", date: "2026-10-01", time: "14:00",
  teacherId: "teacher", studentId: "student", gradeLevelId: "grade", location: "CENTER" as const,
  hours: 1, pricePerHour: 200, fastPay: true, method: "POS" as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue({ role: "ADMIN", userId: "staff" });
  mocks.archived.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async (fn) => fn(mocks.tx));
  mocks.tx.session.upsert.mockResolvedValue({
    createdById: "staff", studentId: "student", teacherId: "teacher", status: "DRAFT", allocations: [],
  });
  mocks.tx.session.findUniqueOrThrow.mockResolvedValue({ total: 225 });
  mocks.tx.student.findFirst.mockResolvedValue({ id: "student" });
  mocks.tx.teacher.findFirst.mockResolvedValue({ id: "teacher" });
  mocks.tx.gradeLevel.findFirst.mockResolvedValue({ id: "grade" });
  mocks.tx.payment.create.mockResolvedValue({ id: "receipt" });
  mocks.post.mockResolvedValue(undefined);
  mocks.snapshot.mockResolvedValue(true);
  mocks.notify.mockResolvedValue(undefined);
});

describe("planner confirmation and payment", () => {
  it("allocates the server-calculated billable total and posts within the same transaction", async () => {
    const result = await createConfirmedPlannerSession("en", input);
    expect(result).toMatchObject({ ok: true, amount: 225, paymentId: "receipt" });
    expect(mocks.tx.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      amount: 225, method: "POS", teacherId: "teacher",
      allocations: { create: { sessionId: `planner-${input.requestId}`, amount: 225 } },
    }) });
    expect(mocks.post.mock.calls[0][0]).toBe(mocks.tx);
    expect(mocks.snapshot.mock.calls[0][0]).toBe(mocks.tx);
    expect(mocks.sync).toHaveBeenCalledWith(mocks.tx, `planner-${input.requestId}`);
  });
  it("confirms without creating a payment when the payment form is requested", async () => {
    expect(await createConfirmedPlannerSession("en", { ...input, fastPay: false })).toMatchObject({ ok: true });
    expect(mocks.tx.payment.create).not.toHaveBeenCalled();
  });
  it("returns the original receipt on retry without charging twice", async () => {
    mocks.tx.session.upsert.mockResolvedValue({
      createdById: "staff", studentId: "student", teacherId: "teacher", status: "COMPLETED", total: 225,
      allocations: [{ payment: { id: "original", status: "COMPLETED" } }],
    });
    expect(await createConfirmedPlannerSession("en", input)).toMatchObject({ ok: true, paymentId: "original" });
    expect(mocks.tx.payment.create).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("rejects unauthorized and archived writes before starting a transaction", async () => {
    mocks.viewer.mockResolvedValue({ role: "PARENT" });
    expect(await createConfirmedPlannerSession("en", input)).toEqual({ error: "forbidden" });
    mocks.viewer.mockResolvedValue({ role: "ADMIN", userId: "staff" });
    mocks.archived.mockResolvedValue("archivedYear");
    expect(await createConfirmedPlannerSession("en", input)).toEqual({ error: "archivedYear" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects cancelled bookings and inactive students", async () => {
    mocks.tx.session.upsert.mockResolvedValue({ createdById: "staff", studentId: "student", teacherId: "teacher", status: "CANCELLED" });
    expect(await createConfirmedPlannerSession("en", input)).toEqual({ error: "invalid" });
    expect(mocks.tx.payment.create).not.toHaveBeenCalled();
  });
  it("does not report a failed payment when notification delivery fails after commit", async () => {
    mocks.notify.mockRejectedValue(new Error("delivery unavailable"));
    expect(await createConfirmedPlannerSession("en", input)).toMatchObject({ ok: true, paymentId: "receipt" });
  });
  it("lets posting failures abort the transaction and does not notify", async () => {
    mocks.post.mockRejectedValue(new Error("posting failed"));
    expect(await createConfirmedPlannerSession("en", input)).toEqual({ error: "invalid" });
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

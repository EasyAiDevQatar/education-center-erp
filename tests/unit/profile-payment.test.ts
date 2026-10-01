import { describe, expect, it } from "vitest";
import { profilePayableSessions } from "../../lib/profile-payment";
import type { PayableSession } from "../../lib/allocation";

const session = (id: string, outstanding = 75): PayableSession => ({
  id, date: "2026-10-01", teacherId: "teacher", teacherName: "Teacher",
  total: 100, allocated: 100 - outstanding, outstanding,
});

describe("profile session payments", () => {
  it("limits a teacher profile to its sessions and preserves partial balances", () => {
    expect(profilePayableSessions([session("own"), session("other-teacher")], [{ id: "own", studentId: "child" }], "child"))
      .toEqual([session("own")]);
  });
  it("keeps siblings on separate receipts", () => {
    expect(profilePayableSessions([session("a"), session("b")], [{ id: "a", studentId: "first" }, { id: "b", studentId: "second" }], "first"))
      .toEqual([session("a")]);
  });
  it("does not reintroduce cancelled, package-covered, or paid sessions absent from the live balance", () => {
    expect(profilePayableSessions([session("paid", 0)], ["cancelled", "package", "paid"].map((id) => ({ id, studentId: "child" })), "child"))
      .toEqual([]);
  });
});

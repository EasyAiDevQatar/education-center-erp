import type { Prisma } from "@prisma/client";

export type SessionFilters = {
  from: string;
  to: string;
  teacherId: string;
  status: string;
};

export function readSessionFilters(
  sp: Record<string, string | string[] | undefined>,
): SessionFilters {
  const get = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  return {
    from: get("from"),
    to: get("to"),
    teacherId: get("teacherId"),
    status: get("status"),
  };
}

export function sessionWhere(f: SessionFilters): Prisma.SessionWhereInput {
  const where: Prisma.SessionWhereInput = {};
  if (f.from || f.to) {
    where.date = {};
    if (f.from) (where.date as Prisma.DateTimeFilter).gte = new Date(f.from);
    if (f.to) {
      const end = new Date(f.to);
      end.setHours(23, 59, 59, 999);
      (where.date as Prisma.DateTimeFilter).lte = end;
    }
  }
  if (f.teacherId) where.teacherId = f.teacherId;
  if (f.status) where.paymentStatus = f.status;
  return where;
}

import "server-only";
import { db } from "./db";
import { getSession } from "./session";

/** Record an immutable audit entry for a financial/entity change. */
export async function writeAudit(
  entity: string,
  entityId: string,
  action: "CREATE" | "UPDATE" | "DELETE",
  data?: { before?: unknown; after?: unknown },
) {
  const session = await getSession();
  await db.auditLog.create({
    data: {
      userId: session?.userId,
      entity,
      entityId,
      action,
      before: data?.before ? JSON.stringify(data.before) : null,
      after: data?.after ? JSON.stringify(data.after) : null,
    },
  });
}

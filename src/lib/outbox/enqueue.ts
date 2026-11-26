/**
 * Outbox enqueue (PLAN §6.6). Call inside the request's transaction: the row
 * and the wake-up notification commit (or roll back) with the change that
 * caused them. The request never calls the external service itself.
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { outbox, type OutboxKind } from "@/db/schema";

/** LISTEN/NOTIFY channel the worker listens on. */
export const OUTBOX_CHANNEL = "outbox";

export async function enqueueOutbox(
  tx: DbOrTx,
  item: { kind: OutboxKind; payload: unknown; entity?: string | null; entityId?: string | null; createdBy?: string | null },
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(outbox)
    .values({
      kind: item.kind,
      payload: item.payload,
      entity: item.entity ?? null,
      entityId: item.entityId ?? null,
      createdBy: item.createdBy ?? null,
    })
    .returning({ id: outbox.id });
  // Delivered on commit only; the worker's minute sweep is the fallback.
  await tx.execute(sql`select pg_notify(${OUTBOX_CHANNEL}, ${row.id})`);
  return row;
}

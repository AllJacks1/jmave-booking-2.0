/**
 * Outbox delivery (worker only, PLAN §6.6).
 *
 * Each due row is handled in its own transaction, locked with
 * `FOR UPDATE SKIP LOCKED`, so two workers never send the same row. The lock
 * is held during the send; if the worker dies mid-send the row stays pending
 * and is retried (the transport gets the row id as an idempotency key).
 */
import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outbox, type OutboxKind, type OutboxRow } from "@/db/schema";
import { afterAttempt, errorText } from "./backoff";

/** Sends one row; returns what to store in `outbox.response`. Throws on failure. */
export type OutboxHandler = (row: OutboxRow) => Promise<unknown>;
export type OutboxHandlers = Partial<Record<OutboxKind, OutboxHandler>>;

export type DispatchSummary = { sent: number; retrying: number; failed: number };

/**
 * Deliver every row due now (at most `limit`). Due-ness is judged by the
 * database clock (rows are stamped with its `now()`); tests pass `now` to
 * move time forward.
 */
export async function processOutbox(db: Db, handlers: OutboxHandlers, opts: { now?: () => Date; limit?: number } = {}): Promise<DispatchSummary> {
  const now = opts.now ?? (() => new Date());
  const due = () => (opts.now ? lte(outbox.nextAttemptAt, opts.now()) : lte(outbox.nextAttemptAt, sql`now()`));
  const limit = opts.limit ?? 50;
  const summary: DispatchSummary = { sent: 0, retrying: 0, failed: 0 };
  for (let i = 0; i < limit; i++) {
    const outcome = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(outbox)
        .where(and(eq(outbox.status, "pending"), due()))
        .orderBy(asc(outbox.nextAttemptAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return null;
      const attempts = row.attempts + 1;
      const handler = handlers[row.kind];
      let response: unknown = null;
      let error: string | null = null;
      try {
        if (!handler) throw new Error(`No sender for outbox kind "${row.kind}".`);
        response = (await handler(row)) ?? null;
      } catch (err) {
        error = errorText(err) || "Unknown error";
      }
      const at = now();
      const next = afterAttempt(attempts, error === null, at);
      await tx
        .update(outbox)
        .set({
          attempts,
          status: next.status,
          lastError: error ?? row.lastError,
          ...(next.status === "sent" ? { sentAt: at, response, lastError: null } : {}),
          ...(next.status === "pending" ? { nextAttemptAt: next.nextAttemptAt } : {}),
        })
        .where(eq(outbox.id, row.id));
      return next.status;
    });
    if (outcome === null) break;
    if (outcome === "sent") summary.sent++;
    else if (outcome === "failed") summary.failed++;
    else summary.retrying++;
  }
  return summary;
}

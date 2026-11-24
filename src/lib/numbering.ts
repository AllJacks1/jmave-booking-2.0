/**
 * Human numbers (PLAN §6.1). Allocated inside the caller's transaction with
 * `SELECT … FOR UPDATE` on `number_sequences`, so a rolled-back issue never
 * burns a number and parallel issues queue on the row lock (gap-free).
 */
import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { numberSequences } from "@/db/schema";
import type { Service } from "@/lib/pricing/types";
import { manilaYear } from "@/lib/time";

/** `QTN-2026` (Self-Drive) or `QTN-WD2026` (With Driver); the year is Manila's. */
export function quotationSequenceKey(service: Service, at: Date): string {
  const year = manilaYear(at);
  return service === "with_driver" ? `QTN-WD${year}` : `QTN-${year}`;
}

/** `QTN-2026` + 929 → `QTN-2026-929`. Zero-padded to 3, grows past 999. */
export function formatSequenceNumber(key: string, value: number): string {
  return `${key}-${String(value).padStart(3, "0")}`;
}

/**
 * Next value for `key`. Must run inside a transaction: the row stays locked
 * until it commits. Creates the sequence at 0 if it does not exist yet
 * (a new year starts at 1).
 */
export async function nextNumber(tx: DbOrTx, key: string): Promise<number> {
  await tx.insert(numberSequences).values({ key, lastValue: 0 }).onConflictDoNothing({ target: numberSequences.key });
  const [row] = await tx
    .select({ lastValue: numberSequences.lastValue })
    .from(numberSequences)
    .where(eq(numberSequences.key, key))
    .for("update");
  const next = row.lastValue + 1;
  await tx
    .update(numberSequences)
    .set({ lastValue: next, updatedAt: sql`now()` })
    .where(eq(numberSequences.key, key));
  return next;
}

/** Allocate the next quotation number for a service at `at` (issue time). */
export async function nextQuotationNumber(tx: DbOrTx, service: Service, at: Date): Promise<string> {
  const key = quotationSequenceKey(service, at);
  return formatSequenceNumber(key, await nextNumber(tx, key));
}

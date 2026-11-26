/**
 * Nightly sweeps (worker, 00:05 Asia/Manila).
 *
 * - Issued quotations past `valid_until` become `expired` (pages already
 *   showed them as expired on read; this makes the stored status match).
 * - Loyalty cards past `expires_at` become `expired` (points are kept, Q12).
 */
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { quotations } from "@/db/schema";
import { withAudit } from "@/lib/audit";
import { expireLoyaltyAccounts } from "@/lib/loyalty/ledger";

export async function expireQuotations(db: Db, now = new Date()): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(quotations)
      .set({ status: "expired" })
      .where(and(eq(quotations.status, "issued"), lt(quotations.validUntil, now)))
      .returning({ id: quotations.id, number: quotations.number });
    if (rows.length) {
      await withAudit(null, "quotation.expire_sweep", "quotation", null, null, { count: rows.length, numbers: rows.map((r) => r.number).filter(Boolean).slice(0, 200) }, tx);
    }
    return rows.length;
  });
}

export async function expireLoyalty(db: Db, now = new Date()): Promise<number> {
  return db.transaction(async (tx) => {
    const n = await expireLoyaltyAccounts(tx, now);
    if (n) await withAudit(null, "loyalty.expire_sweep", "loyalty_account", null, null, { count: n }, tx);
    return n;
  });
}

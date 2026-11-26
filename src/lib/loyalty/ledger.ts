/**
 * Loyalty ledger operations (Phase 3, pricing.md §4, PLAN §8 Q5/Q12).
 *
 * Called inside the transactions that change a booking, so the points move
 * together with the status:
 *
 * - `earnForReturn`     booking → returned: create/renew the card, +50 × days.
 * - `reverseEarn`       a return is undone: −(net earned for the booking).
 * - `redeemForConfirm`  booking → confirmed: −(points the quotation redeems).
 * - `refundRedemption`  booking → cancelled: +(net redeemed for the booking).
 *
 * Each is idempotent per booking: it looks at the booking's net for its pair
 * of kinds (earn/reversal, redeem/refund) and only moves what is missing.
 * The caller holds the booking row lock; these also lock the client and the
 * account row, so balances cannot race.
 */
import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { clients, loyaltyAccounts, pointsLedger, quotations, type BookingRow, type LoyaltyAccountRow, type PointsKind } from "@/db/schema";
import { ActionError } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { nextNumber } from "@/lib/numbering";
import { pointsForRentalDays, type RewardsRedemption } from "@/lib/pricing";
import { redemptionOf, type QuoteResult } from "@/lib/quotes/engine";
import { addYearsToKey, manilaDateKey, type DateKey } from "@/lib/time";

export const LOYALTY_SEQUENCE_KEY = "JMV";

/** `JMV` + 1 → `JMV-0001` (4 digits, grows past 9999). */
export function formatCardNo(value: number): string {
  return `${LOYALTY_SEQUENCE_KEY}-${String(value).padStart(4, "0")}`;
}

/** Card number → its sequence value (`JMV-0024` → 24), else null. */
export function cardNoValue(cardNo: string): number | null {
  const m = /^JMV-(\d{1,9})$/.exec(cardNo.trim().toUpperCase());
  return m ? Number(m[1]) : null;
}

/** Expired when the status says so or the expiry date has passed (Manila). */
export function isExpired(a: Pick<LoyaltyAccountRow, "status" | "expiresAt">, today: DateKey): boolean {
  return a.status === "expired" || a.expiresAt < today;
}

type Actor = { id: string } | null;

export async function balanceOf(tx: DbOrTx, accountId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${pointsLedger.points}), 0)::int` })
    .from(pointsLedger)
    .where(eq(pointsLedger.accountId, accountId));
  return Number(row?.total ?? 0);
}

/** Net points of a booking for a pair of kinds (e.g. earn + reversal). */
async function bookingNet(tx: DbOrTx, bookingId: string, kinds: PointsKind[]): Promise<{ net: number; accountId: string | null }> {
  const [row] = await tx
    .select({
      net: sql<number>`coalesce(sum(${pointsLedger.points}), 0)::int`,
      accountId: sql<string | null>`(array_agg(${pointsLedger.accountId}))[1]`,
    })
    .from(pointsLedger)
    .where(and(eq(pointsLedger.bookingId, bookingId), inArray(pointsLedger.kind, kinds)));
  return { net: Number(row?.net ?? 0), accountId: row?.accountId ?? null };
}

async function lockAccount(tx: DbOrTx, where: { clientId: string } | { id: string }): Promise<LoyaltyAccountRow | null> {
  const cond = "clientId" in where ? eq(loyaltyAccounts.clientId, where.clientId) : eq(loyaltyAccounts.id, where.id);
  const [row] = await tx.select().from(loyaltyAccounts).where(cond).for("update");
  return row ?? null;
}

/** The client's card, locked. Locks the client row first so two returns cannot both create a card. */
export async function lockClientAccount(tx: DbOrTx, clientId: string): Promise<LoyaltyAccountRow | null> {
  await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).for("update");
  return lockAccount(tx, { clientId });
}

async function insertEntry(
  tx: DbOrTx,
  actor: Actor,
  values: { accountId: string; kind: PointsKind; points: number; bookingId?: string | null; quotationId?: string | null; note?: string | null; occurredAt?: Date },
) {
  const [row] = await tx
    .insert(pointsLedger)
    .values({ ...values, createdBy: actor?.id ?? null })
    .returning({ id: pointsLedger.id });
  await withAudit(actor, `loyalty.${values.kind}`, "loyalty_account", values.accountId, null, { ...values, entryId: row.id }, tx);
  return row.id;
}

export type EarnResult = { points: number; cardNo: string | null; created: boolean; renewed: boolean; warning: string | null };

/**
 * Booking returned: create the card if missing (member since = return date,
 * expires +1 year), renew an expired card for 1 year (Q12), add the earn.
 */
export async function earnForReturn(tx: DbOrTx, actor: Actor, booking: Pick<BookingRow, "id" | "clientId" | "number">, rentalDays: number, returnedAt: Date): Promise<EarnResult> {
  if (!booking.clientId) {
    return { points: 0, cardNo: null, created: false, renewed: false, warning: "No points earned: the booking has no client." };
  }
  const points = pointsForRentalDays(rentalDays);
  const already = await bookingNet(tx, booking.id, ["earn", "reversal"]);
  const today = manilaDateKey(returnedAt);
  let account = await lockClientAccount(tx, booking.clientId);
  let created = false;
  let renewed = false;
  if (!account) {
    const cardNo = formatCardNo(await nextNumber(tx, LOYALTY_SEQUENCE_KEY));
    [account] = await tx
      .insert(loyaltyAccounts)
      .values({ clientId: booking.clientId, cardNo, memberSince: today, expiresAt: addYearsToKey(today, 1), status: "active" })
      .returning();
    created = true;
    await withAudit(actor, "loyalty.card_created", "loyalty_account", account.id, null, { cardNo, clientId: booking.clientId, bookingId: booking.id }, tx);
  } else if (isExpired(account, today)) {
    const before = { status: account.status, expiresAt: account.expiresAt };
    [account] = await tx
      .update(loyaltyAccounts)
      .set({ status: "active", expiresAt: addYearsToKey(today, 1) })
      .where(eq(loyaltyAccounts.id, account.id))
      .returning();
    renewed = true;
    await withAudit(actor, "loyalty.card_renewed", "loyalty_account", account.id, before, { status: "active", expiresAt: account.expiresAt, bookingId: booking.id }, tx);
  }
  if (already.net > 0 || points <= 0) {
    return { points: 0, cardNo: account.cardNo, created, renewed, warning: null };
  }
  await insertEntry(tx, actor, {
    accountId: account.id,
    kind: "earn",
    points,
    bookingId: booking.id,
    note: `${booking.number}: ${rentalDays} rental day${rentalDays === 1 ? "" : "s"}`,
    // Dated by the return, not by when it was recorded.
    occurredAt: returnedAt,
  });
  return { points, cardNo: account.cardNo, created, renewed, warning: null };
}

/** A return was undone: take back what the booking earned. */
export async function reverseEarn(tx: DbOrTx, actor: Actor, booking: Pick<BookingRow, "id" | "number">, reason: string): Promise<number> {
  const { net, accountId } = await bookingNet(tx, booking.id, ["earn", "reversal"]);
  if (net <= 0 || !accountId) return 0;
  await lockAccount(tx, { id: accountId });
  await insertEntry(tx, actor, { accountId, kind: "reversal", points: -net, bookingId: booking.id, note: `${booking.number}: return undone — ${reason}` });
  return net;
}

/** Why a client cannot redeem `points` now, or null when they can. */
export function redeemProblem(account: LoyaltyAccountRow | null, balance: number, points: number, today: DateKey): string | null {
  if (!account) return "The client has no loyalty card yet.";
  if (isExpired(account, today)) return `Loyalty card ${account.cardNo} expired on ${account.expiresAt}. Points can be redeemed again after the next returned booking renews it.`;
  if (points > balance) return `Not enough points: ${points.toLocaleString("en-PH")} needed, ${balance.toLocaleString("en-PH")} available on ${account.cardNo}.`;
  return null;
}

/** Issue-time check for a formal quotation (balance is checked again on confirm). */
export async function checkRedeemable(tx: DbOrTx, clientId: string | null, redemption: RewardsRedemption | null, now = new Date()): Promise<string | null> {
  if (!redemption) return null;
  if (!clientId) return "Choose a client to redeem points.";
  const [account] = await tx.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.clientId, clientId));
  const balance = account ? await balanceOf(tx, account.id) : 0;
  return redeemProblem(account ?? null, balance, redemption.points, manilaDateKey(now));
}

/** The redemption on a booking's quotation, if any. */
async function bookingRedemption(tx: DbOrTx, booking: Pick<BookingRow, "quotationId">) {
  if (!booking.quotationId) return null;
  const [q] = await tx.select({ id: quotations.id, result: quotations.result }).from(quotations).where(eq(quotations.id, booking.quotationId));
  if (!q) return null;
  const redemption = redemptionOf(q.result as QuoteResult | null);
  return redemption ? { quotationId: q.id, redemption } : null;
}

/** Booking confirmed: deduct the quotation's redemption. 409 when it cannot be covered. */
export async function redeemForConfirm(tx: DbOrTx, actor: Actor, booking: Pick<BookingRow, "id" | "clientId" | "quotationId" | "number">, now = new Date()): Promise<number> {
  const r = await bookingRedemption(tx, booking);
  if (!r) return 0;
  const { net } = await bookingNet(tx, booking.id, ["redeem", "refund"]);
  if (net < 0) return 0;
  if (!booking.clientId) throw new ActionError(409, "The booking has no client to redeem points from.");
  const account = await lockClientAccount(tx, booking.clientId);
  const balance = account ? await balanceOf(tx, account.id) : 0;
  const problem = redeemProblem(account, balance, r.redemption.points, manilaDateKey(now));
  if (problem) throw new ActionError(409, `${problem} Revise the quotation without the redemption.`);
  const what = r.redemption.mode === "free_hours" ? `${r.redemption.hours} free hour${r.redemption.hours === 1 ? "" : "s"}` : `₱${(r.redemption.amount / 100).toLocaleString("en-PH")} discount`;
  await insertEntry(tx, actor, {
    accountId: account!.id,
    kind: "redeem",
    points: -r.redemption.points,
    bookingId: booking.id,
    quotationId: r.quotationId,
    note: `${booking.number}: ${what}`,
  });
  return r.redemption.points;
}

/** Booking cancelled: give back what it redeemed. */
export async function refundRedemption(tx: DbOrTx, actor: Actor, booking: Pick<BookingRow, "id" | "number">, reason: string): Promise<number> {
  const { net, accountId } = await bookingNet(tx, booking.id, ["redeem", "refund"]);
  if (net >= 0 || !accountId) return 0;
  await lockAccount(tx, { id: accountId });
  await insertEntry(tx, actor, { accountId, kind: "refund", points: -net, bookingId: booking.id, note: `${booking.number}: cancelled — ${reason}` });
  return -net;
}

/** Nightly: cards past their expiry date become `expired` (points are kept, Q12). */
export async function expireLoyaltyAccounts(tx: DbOrTx, now = new Date()): Promise<number> {
  const today = manilaDateKey(now);
  const rows = await tx
    .update(loyaltyAccounts)
    .set({ status: "expired" })
    .where(and(eq(loyaltyAccounts.status, "active"), sql`${loyaltyAccounts.expiresAt} < ${today}`))
    .returning({ id: loyaltyAccounts.id });
  return rows.length;
}

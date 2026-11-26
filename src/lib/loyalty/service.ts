/**
 * Rewards pages (Phase 3 brief §7): card list, card detail with history,
 * manual adjustment (Admin+, reason), tier (Super Admin), linking an
 * imported card to a client (Admin+).
 */
import "server-only";
import { and, asc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { bookings, clients, loyaltyAccounts, pointsLedger, user, type LoyaltyAccountRow } from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { manilaDateKey } from "@/lib/time";
import { balanceOf, isExpired } from "./ledger";
import { adjustSchema, linkClientSchema, tierSchema, type RewardsListQuery } from "./schema";

export const REWARDS_PAGE_SIZE = 50;

const balanceSql = sql<number>`coalesce((select sum(${pointsLedger.points}) from ${pointsLedger} where ${pointsLedger.accountId} = ${loyaltyAccounts.id}), 0)::int`;

export type AccountListRow = {
  id: string;
  cardNo: string;
  clientId: string | null;
  clientName: string | null;
  importedName: string | null;
  memberSince: string;
  expiresAt: string;
  tier: number | null;
  status: "active" | "expired";
  expired: boolean;
  balance: number;
};

export async function listAccounts(query: RewardsListQuery, now = new Date()) {
  const today = manilaDateKey(now);
  const conds: SQL[] = [];
  if (query.q) {
    const like = `%${query.q.replace(/[%_\\]/g, "\\$&")}%`;
    conds.push(or(ilike(loyaltyAccounts.cardNo, like), ilike(clients.fullName, like), ilike(loyaltyAccounts.importedName, like))!);
  }
  if (query.filter === "unlinked") conds.push(isNull(loyaltyAccounts.clientId));
  if (query.filter === "expired") conds.push(or(eq(loyaltyAccounts.status, "expired"), sql`${loyaltyAccounts.expiresAt} < ${today}`)!);
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ count }]] = await Promise.all([
    db
      .select({ a: loyaltyAccounts, clientName: clients.fullName, balance: balanceSql })
      .from(loyaltyAccounts)
      .leftJoin(clients, eq(clients.id, loyaltyAccounts.clientId))
      .where(where)
      .orderBy(asc(loyaltyAccounts.cardNo))
      .limit(REWARDS_PAGE_SIZE)
      .offset((query.page - 1) * REWARDS_PAGE_SIZE),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(loyaltyAccounts)
      .leftJoin(clients, eq(clients.id, loyaltyAccounts.clientId))
      .where(where),
  ]);
  const items: AccountListRow[] = rows.map(({ a, clientName, balance }) => ({
    id: a.id,
    cardNo: a.cardNo,
    clientId: a.clientId,
    clientName,
    importedName: a.importedName,
    memberSince: a.memberSince,
    expiresAt: a.expiresAt,
    tier: a.tier,
    status: a.status,
    expired: isExpired(a, today),
    balance: Number(balance),
  }));
  return { items, total: Number(count) };
}

export type LedgerEntry = {
  id: string;
  kind: "earn" | "reversal" | "redeem" | "refund" | "adjust" | "import";
  points: number;
  note: string | null;
  occurredAt: Date;
  bookingId: string | null;
  bookingNumber: string | null;
  quotationId: string | null;
  createdByName: string | null;
  /** Balance after this entry (oldest first). */
  running: number;
};

export type AccountDetail = {
  account: LoyaltyAccountRow;
  client: { id: string; fullName: string; phone: string | null; email: string | null; address: string | null } | null;
  balance: number;
  expired: boolean;
  /** Newest first. */
  history: LedgerEntry[];
  totals: { earned: number; redeemed: number; rentals: number };
};

async function detailFor(account: LoyaltyAccountRow, now = new Date()): Promise<AccountDetail> {
  const [client, rows] = await Promise.all([
    account.clientId
      ? db
          .select({ id: clients.id, fullName: clients.fullName, phone: clients.phone, email: clients.email, address: clients.address })
          .from(clients)
          .where(eq(clients.id, account.clientId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db
      .select({ e: pointsLedger, bookingNumber: bookings.number, createdByName: user.displayName })
      .from(pointsLedger)
      .leftJoin(bookings, eq(bookings.id, pointsLedger.bookingId))
      .leftJoin(user, eq(user.id, pointsLedger.createdBy))
      .where(eq(pointsLedger.accountId, account.id))
      .orderBy(asc(pointsLedger.occurredAt), asc(pointsLedger.createdAt)),
  ]);
  let running = 0;
  const history: LedgerEntry[] = rows.map(({ e, bookingNumber, createdByName }) => {
    running += e.points;
    return {
      id: e.id,
      kind: e.kind,
      points: e.points,
      note: e.note,
      occurredAt: e.occurredAt,
      bookingId: e.bookingId,
      bookingNumber,
      quotationId: e.quotationId,
      createdByName,
      running,
    };
  });
  const earned = history.filter((h) => h.kind === "earn" || h.kind === "reversal" || h.kind === "import").reduce((s, h) => s + h.points, 0);
  const redeemed = 0 - history.filter((h) => h.kind === "redeem" || h.kind === "refund").reduce((s, h) => s + h.points, 0);
  const perBooking = new Map<string, number>();
  for (const h of history) {
    if ((h.kind === "earn" || h.kind === "reversal") && h.bookingId) perBooking.set(h.bookingId, (perBooking.get(h.bookingId) ?? 0) + h.points);
  }
  const rentals = history.filter((h) => h.kind === "import").length + [...perBooking.values()].filter((n) => n > 0).length;
  return {
    account,
    client,
    balance: running,
    expired: isExpired(account, manilaDateKey(now)),
    history: history.reverse(),
    totals: { earned, redeemed, rentals },
  };
}

export async function getAccount(id: string): Promise<AccountDetail | null> {
  const [a] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.id, id));
  return a ? detailFor(a) : null;
}

export async function accountForClient(clientId: string): Promise<AccountDetail | null> {
  const [a] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.clientId, clientId));
  return a ? detailFor(a) : null;
}

/** Points moved by one booking (shown on the booking page). */
export async function bookingPoints(bookingId: string) {
  return db
    .select({ kind: pointsLedger.kind, points: pointsLedger.points, occurredAt: pointsLedger.occurredAt, accountId: pointsLedger.accountId, cardNo: loyaltyAccounts.cardNo })
    .from(pointsLedger)
    .innerJoin(loyaltyAccounts, eq(loyaltyAccounts.id, pointsLedger.accountId))
    .where(eq(pointsLedger.bookingId, bookingId))
    .orderBy(asc(pointsLedger.occurredAt));
}

/** The redemption a quotation carries (for the quotation page's internal panel). */
export async function quotationPoints(quotationId: string) {
  return db
    .select({ kind: pointsLedger.kind, points: pointsLedger.points })
    .from(pointsLedger)
    .where(eq(pointsLedger.quotationId, quotationId));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function lockAccountById(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: string) {
  const [a] = await tx.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.id, id)).for("update");
  if (!a) throw new ActionError(404, "Loyalty card not found.");
  return a;
}

/** Manual adjustment (Admin+, reason required). Cannot take the balance below 0. */
export const adjustPoints = defineAction({
  permission: "rewards.adjust",
  input: adjustSchema,
  handler: async (actor, { accountId, points, reason }) => {
    return db.transaction(async (tx) => {
      const a = await lockAccountById(tx, accountId);
      const before = await balanceOf(tx, a.id);
      if (before + points < 0) {
        throw new ActionError(409, `The balance is ${before.toLocaleString("en-PH")} points; it cannot go below 0.`, { points: ["Too many points taken"] });
      }
      const [e] = await tx
        .insert(pointsLedger)
        .values({ accountId: a.id, kind: "adjust", points, note: reason, createdBy: actor.id })
        .returning({ id: pointsLedger.id });
      await withAudit(actor, "loyalty.adjust", "loyalty_account", a.id, { balance: before }, { balance: before + points, points, reason, entryId: e.id }, tx);
      return { balance: before + points };
    });
  },
});

/** Tier (Super Admin, PLAN Q5). */
export const setTier = defineAction({
  permission: "rewards.edit_tier",
  input: tierSchema,
  handler: async (actor, { accountId, tier }) => {
    return db.transaction(async (tx) => {
      const a = await lockAccountById(tx, accountId);
      await tx.update(loyaltyAccounts).set({ tier }).where(eq(loyaltyAccounts.id, a.id));
      await withAudit(actor, "loyalty.tier", "loyalty_account", a.id, { tier: a.tier }, { tier }, tx);
      return { tier };
    });
  },
});

/** Link an imported card that matched no client (Admin+). */
export const linkClient = defineAction({
  permission: "rewards.adjust",
  input: linkClientSchema,
  handler: async (actor, { accountId, clientId }) => {
    return db.transaction(async (tx) => {
      const a = await lockAccountById(tx, accountId);
      if (a.clientId) throw new ActionError(409, "This card already belongs to a client.");
      const [c] = await tx.select({ id: clients.id, fullName: clients.fullName }).from(clients).where(eq(clients.id, clientId)).for("update");
      if (!c) throw new ActionError(404, "Client not found.", { clientId: ["Client not found"] });
      const [other] = await tx.select({ cardNo: loyaltyAccounts.cardNo }).from(loyaltyAccounts).where(eq(loyaltyAccounts.clientId, clientId));
      if (other) throw new ActionError(409, `${c.fullName} already has card ${other.cardNo}.`, { clientId: [`Already has ${other.cardNo}`] });
      await tx.update(loyaltyAccounts).set({ clientId }).where(eq(loyaltyAccounts.id, a.id));
      await withAudit(actor, "loyalty.link_client", "loyalty_account", a.id, { clientId: null }, { clientId }, tx);
      return { clientId };
    });
  },
});

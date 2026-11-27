import "server-only";
import { and, asc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { clients, type ClientRow } from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { blacklistSchema, clientSchema, updateClientSchema } from "./schema";

export const CLIENTS_PAGE_SIZE = 50;

/**
 * Repeat client: has a first rental on record (imported BOOKED/COMPLETED
 * rows, later bookings from Phase 2a). Drives the new-client discount.
 */
export function isRepeatClient(c: Pick<ClientRow, "firstRentalAt">): boolean {
  return c.firstRentalAt !== null;
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Search by name, FB name, email, or phone (any part of the digits). */
export async function searchClients(opts: { q: string; page: number; blacklisted: "all" | "only" }) {
  const q = opts.q.trim();
  const conds: SQL[] = [];
  if (opts.blacklisted === "only") conds.push(eq(clients.isBlacklisted, true));
  let rank: SQL | null = null;
  if (q) {
    const like = `%${escapeLike(q)}%`;
    const terms: SQL[] = [ilike(clients.fullName, like), ilike(clients.fbName, like), ilike(clients.email, like)];
    let digits = q.replace(/\D/g, "");
    if (digits.length >= 4) {
      // 0917… and +63917… are the same number.
      if (digits.startsWith("0")) digits = digits.slice(1);
      else if (digits.startsWith("63") && digits.length > 10) digits = digits.slice(2);
      terms.push(ilike(clients.phone, `%${digits}%`), ilike(clients.altContactPhone, `%${digits}%`));
    }
    conds.push(or(...terms)!);
    rank = sql`greatest(similarity(${clients.fullName}, ${q}), similarity(coalesce(${clients.fbName}, ''), ${q}))`;
  }
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: clients.id,
        fullName: clients.fullName,
        fbName: clients.fbName,
        phone: clients.phone,
        email: clients.email,
        clientType: clients.clientType,
        isBlacklisted: clients.isBlacklisted,
        firstRentalAt: clients.firstRentalAt,
      })
      .from(clients)
      .where(where)
      .orderBy(...(rank ? [sql`${rank} desc`, asc(clients.fullName)] : [asc(clients.fullName)]))
      .limit(CLIENTS_PAGE_SIZE)
      .offset((opts.page - 1) * CLIENTS_PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(clients).where(where),
  ]);
  return { rows, total };
}

export async function getClient(id: string): Promise<ClientRow | null> {
  const [row] = await db.select().from(clients).where(eq(clients.id, id));
  return row ?? null;
}

/** Another client already using this phone or email → 409 with the field. */
async function assertUnique(tx: DbOrTx, input: { phone: string | null; email: string | null }, exceptId?: string) {
  const checks: [string, SQL][] = [];
  if (input.phone) checks.push(["phone", eq(clients.phone, input.phone)]);
  if (input.email) checks.push(["email", sql`lower(${clients.email}) = ${input.email.toLowerCase()}`]);
  for (const [field, cond] of checks) {
    const [dup] = await tx
      .select({ id: clients.id, fullName: clients.fullName })
      .from(clients)
      .where(exceptId ? and(cond, ne(clients.id, exceptId)) : cond)
      .limit(1);
    if (dup) {
      throw new ActionError(409, `${dup.fullName} already has this ${field}.`, {
        [exceptId ? `client.${field}` : field]: [`Already used by ${dup.fullName}`],
      });
    }
  }
}

function createWithSource(source: "manual" | "quote_form") {
  return defineAction({
    permission: "clients.edit",
    input: clientSchema,
    handler: async (actor, input) => {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('clients'))`);
        await assertUnique(tx, input);
        const [row] = await tx.insert(clients).values({ ...input, source, createdBy: actor.id }).returning();
        await withAudit(actor, "client.create", "client", row.id, null, { ...input, source }, tx);
        return { id: row.id };
      });
    },
  });
}

export const createClient = createWithSource("manual");

/** Added inline on a quotation form: its first issued quotation sends a Rework lead (rework.md §2). */
export const createClientFromQuote = createWithSource("quote_form");

export const updateClient = defineAction({
  permission: "clients.edit",
  input: updateClientSchema,
  handler: async (actor, { id, client }) => {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('clients'))`);
      const [before] = await tx.select().from(clients).where(eq(clients.id, id)).for("update");
      if (!before) throw new ActionError(404, "Client not found.");
      await assertUnique(tx, client, id);
      const [after] = await tx.update(clients).set(client).where(eq(clients.id, id)).returning();
      await withAudit(actor, "client.update", "client", id, before, after, tx);
      return { id };
    });
  },
});

/** Admin and up. Reason required when blacklisting. */
export const setBlacklist = defineAction({
  permission: "clients.blacklist",
  input: blacklistSchema,
  handler: async (actor, { id, blacklisted, reason }) => {
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(clients).where(eq(clients.id, id)).for("update");
      if (!before) throw new ActionError(404, "Client not found.");
      const patch = { isBlacklisted: blacklisted, blacklistReason: blacklisted ? reason : null };
      await tx.update(clients).set(patch).where(eq(clients.id, id));
      await withAudit(
        actor,
        blacklisted ? "client.blacklist" : "client.unblacklist",
        "client",
        id,
        { isBlacklisted: before.isBlacklisted, blacklistReason: before.blacklistReason },
        patch,
        tx,
      );
      return { id };
    });
  },
});

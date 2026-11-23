import "server-only";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { holidays, rateCards, type RateCardRow } from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { diffRateCards, rateCardDataSchema, type RateCardData } from "@/lib/pricing/rate-card";
import { createDraftSchema, holidayIdSchema, holidaySchema, rateCardIdSchema, updateDraftSchema } from "./schema";

export type RateCard = Omit<RateCardRow, "data"> & { data: RateCardData; valid: boolean };

function toCard(row: RateCardRow): RateCard {
  const parsed = rateCardDataSchema.safeParse(row.data);
  return { ...row, data: (parsed.success ? parsed.data : row.data) as RateCardData, valid: parsed.success };
}

export async function listRateCards() {
  return db
    .select({
      id: rateCards.id,
      version: rateCards.version,
      name: rateCards.name,
      status: rateCards.status,
      source: rateCards.source,
      effectiveFrom: rateCards.effectiveFrom,
      createdAt: rateCards.createdAt,
      updatedAt: rateCards.updatedAt,
    })
    .from(rateCards)
    .orderBy(desc(rateCards.version));
}

export async function getRateCard(id: string): Promise<RateCard | null> {
  const [row] = await db.select().from(rateCards).where(eq(rateCards.id, id));
  return row ? toCard(row) : null;
}

export async function getRateCardByVersion(version: number): Promise<RateCard | null> {
  const [row] = await db.select().from(rateCards).where(eq(rateCards.version, version));
  return row ? toCard(row) : null;
}

export async function getActiveRateCard(): Promise<RateCard | null> {
  const [row] = await db.select().from(rateCards).where(eq(rateCards.status, "active"));
  return row ? toCard(row) : null;
}

/** New draft copied from any card. */
export const createDraft = defineAction({
  permission: "rates.edit",
  input: createDraftSchema,
  handler: async (actor, { fromId, name }) => {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('rate_cards'))`);
      const [from] = await tx.select().from(rateCards).where(eq(rateCards.id, fromId));
      if (!from) throw new ActionError(404, "Rate card not found.");
      const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${rateCards.version}), 0)::int` }).from(rateCards);
      const [row] = await tx
        .insert(rateCards)
        .values({ version: max + 1, name, status: "draft", data: from.data, source: `copy:v${from.version}`, createdBy: actor.id })
        .returning();
      await withAudit(actor, "rate_card.create_draft", "rate_card", row.id, null, { version: row.version, from: from.version }, tx);
      return { id: row.id, version: row.version };
    });
  },
});

/** Edit a draft. Active and archived cards never change. */
export const updateDraft = defineAction({
  permission: "rates.edit",
  input: updateDraftSchema,
  handler: async (actor, { id, name, notes, data }) => {
    return db.transaction(async (tx) => {
      const [cur] = await tx.select().from(rateCards).where(eq(rateCards.id, id)).for("update");
      if (!cur) throw new ActionError(404, "Rate card not found.");
      if (cur.status !== "draft") throw new ActionError(409, "Only drafts can be edited. Create a draft from this card.");
      await tx.update(rateCards).set({ name, notes, data }).where(eq(rateCards.id, id));
      const changes = diffRateCards(cur.data, data);
      await withAudit(
        actor,
        "rate_card.update",
        "rate_card",
        id,
        { name: cur.name, notes: cur.notes, values: Object.fromEntries(changes.map((c) => [c.path, c.before])) },
        { name, notes, values: Object.fromEntries(changes.map((c) => [c.path, c.after])) },
        tx,
      );
      return { id, changed: changes.length };
    });
  },
});

/** Make a draft (or archived) card active; the current active card is archived. */
export const activateRateCard = defineAction({
  permission: "rates.edit",
  input: rateCardIdSchema,
  handler: async (actor, { id }) => {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('rate_cards'))`);
      const [target] = await tx.select().from(rateCards).where(eq(rateCards.id, id)).for("update");
      if (!target) throw new ActionError(404, "Rate card not found.");
      if (target.status === "active") throw new ActionError(409, "This card is already active.");
      if (!rateCardDataSchema.safeParse(target.data).success) {
        throw new ActionError(400, "This card has invalid values; fix them before activating.");
      }
      const [prev] = await tx.select().from(rateCards).where(eq(rateCards.status, "active")).for("update");
      if (prev) await tx.update(rateCards).set({ status: "archived" }).where(eq(rateCards.id, prev.id));
      const now = new Date();
      await tx.update(rateCards).set({ status: "active", effectiveFrom: now }).where(eq(rateCards.id, id));
      await withAudit(
        actor,
        "rate_card.activate",
        "rate_card",
        id,
        { active: prev ? { id: prev.id, version: prev.version } : null, status: target.status },
        { active: { id, version: target.version }, effectiveFrom: now.toISOString() },
        tx,
      );
      return { id, archivedId: prev?.id ?? null };
    });
  },
});

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

export async function listHolidays(year: number) {
  return db
    .select()
    .from(holidays)
    .where(and(gte(holidays.date, `${year}-01-01`), lt(holidays.date, `${year + 1}-01-01`)))
    .orderBy(asc(holidays.date));
}

/** Holiday dates (`YYYY-MM-DD`) for the pricing context. */
export async function holidayDates(): Promise<string[]> {
  const rows = await db.select({ date: holidays.date }).from(holidays).orderBy(asc(holidays.date));
  return rows.map((r) => r.date);
}

export async function holidayYears(): Promise<number[]> {
  const rows = await db.execute<{ y: number }>(sql`select distinct extract(year from date)::int as y from holidays order by y`);
  return [...rows].map((r) => r.y);
}

export const addHoliday = defineAction({
  permission: "rates.edit",
  input: holidaySchema,
  handler: async (actor, input) => {
    return db.transaction(async (tx) => {
      const [row] = await tx.insert(holidays).values(input).onConflictDoNothing({ target: holidays.date }).returning();
      if (!row) throw new ActionError(409, "That date is already a holiday.", { date: ["Already a holiday"] });
      await withAudit(actor, "holiday.add", "holiday", row.id, null, input, tx);
      return { id: row.id };
    });
  },
});

export const removeHoliday = defineAction({
  permission: "rates.edit",
  input: holidayIdSchema,
  handler: async (actor, { id }) => {
    return db.transaction(async (tx) => {
      const [row] = await tx.delete(holidays).where(eq(holidays.id, id)).returning();
      if (!row) throw new ActionError(404, "Holiday not found.");
      await withAudit(actor, "holiday.remove", "holiday", id, { date: row.date, name: row.name }, null, tx);
      return { id };
    });
  },
});

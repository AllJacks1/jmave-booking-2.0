import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { clients, quotations, rateCards, user, vehicles, type QuotationRow } from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { nextQuotationNumber } from "@/lib/numbering";
import { CATEGORY_LABELS, PricingInputError, rateCardDataSchema, type BodyType, type Category, type RateCardData } from "@/lib/pricing";
import { searchClients } from "@/lib/clients/service";
import { holidayDates } from "@/lib/rates/service";
import { getSettings } from "@/lib/settings/service";
import { addDaysToKey, manilaToUtc, startOfManilaDay } from "@/lib/time";
import {
  bodyLabel,
  effectiveStatus,
  vehicleLabel,
  type Business,
  type EffectiveStatus,
  type QuoteDoc,
  type QuoteSnapshot,
} from "./document";
import { priceQuote, type PricedQuote, type QuoteResult } from "./engine";
import {
  issueSchema,
  markLostSchema,
  quoteFormSchema,
  quoteIdSchema,
  saveDraftSchema,
  saveQuickSchema,
  type ClientHit,
  type QuoteForm,
  type QuoteListQuery,
} from "./schema";

export const QUOTES_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Pricing context
// ---------------------------------------------------------------------------

type ClientCtx = { id: string; fullName: string; fbName: string | null; isBlacklisted: boolean; blacklistReason: string | null; firstRentalAt: Date | null; clientType: "individual" | "corporate" };
type VehicleCtx = { id: string; displayName: string; bodyType: BodyType | null; fuelType: "gasoline" | "premium" | "diesel" | null };

async function activeCard(executor: DbOrTx): Promise<{ id: string; data: RateCardData }> {
  const [row] = await executor.select({ id: rateCards.id, data: rateCards.data }).from(rateCards).where(eq(rateCards.status, "active"));
  if (!row) throw new ActionError(409, "There is no active rate card. Ask a Super Admin to import or activate one.");
  const parsed = rateCardDataSchema.safeParse(row.data);
  if (!parsed.success) throw new ActionError(500, "The active rate card has invalid values.");
  return { id: row.id, data: parsed.data };
}

async function loadClient(executor: DbOrTx, id: string | null): Promise<ClientCtx | null> {
  if (!id) return null;
  const [c] = await executor
    .select({
      id: clients.id,
      fullName: clients.fullName,
      fbName: clients.fbName,
      isBlacklisted: clients.isBlacklisted,
      blacklistReason: clients.blacklistReason,
      firstRentalAt: clients.firstRentalAt,
      clientType: clients.clientType,
    })
    .from(clients)
    .where(eq(clients.id, id));
  if (!c) throw new ActionError(404, "Client not found.", { clientId: ["Client not found"] });
  return c;
}

async function loadVehicle(executor: DbOrTx, id: string | null): Promise<VehicleCtx | null> {
  if (!id) return null;
  const [v] = await executor
    .select({ id: vehicles.id, displayName: vehicles.displayName, bodyType: vehicles.bodyType, fuelType: vehicles.fuelType })
    .from(vehicles)
    .where(eq(vehicles.id, id));
  if (!v) throw new ActionError(404, "Vehicle not found.", { vehicleId: ["Vehicle not found"] });
  return v;
}

type Loaded = { card: { id: string; data: RateCardData }; client: ClientCtx | null; vehicle: VehicleCtx | null; holidays: string[] };

async function loadContext(executor: DbOrTx, form: QuoteForm): Promise<Loaded> {
  const [card, client, vehicle, holidays] = await Promise.all([
    activeCard(executor),
    loadClient(executor, form.clientId),
    loadVehicle(executor, form.vehicleId),
    holidayDates(),
  ]);
  return { card, client, vehicle, holidays };
}

function price(form: QuoteForm, l: Loaded): PricedQuote {
  return priceQuote(form, { card: l.card.data, holidays: l.holidays, client: l.client, vehicle: l.vehicle });
}

/** Price or return the engine's message (bad input is not a server error). */
function tryPrice(form: QuoteForm, l: Loaded): { priced: PricedQuote | null; error: string | null } {
  try {
    return { priced: price(form, l), error: null };
  } catch (e) {
    if (e instanceof PricingInputError) return { priced: null, error: e.message };
    if (e instanceof Error && /^Invalid (date|time)/.test(e.message)) return { priced: null, error: e.message };
    throw e;
  }
}

function snapshotOf(form: QuoteForm, l: Loaded, consultantName: string | null): QuoteSnapshot {
  return {
    clientName: l.client?.fullName ?? (form.clientName || null),
    clientFbName: l.client?.fbName ?? null,
    vehicleName: l.vehicle?.displayName ?? null,
    consultantName,
  };
}

/** Columns derived from a priced (or unpriced) form. */
function derivedColumns(form: QuoteForm, l: Loaded, priced: PricedQuote | null) {
  return {
    service: form.service,
    clientId: form.clientId,
    clientName: l.client?.fullName ?? (form.clientName || null),
    vehicleId: form.vehicleId,
    bodyType: priced?.bodyType ?? l.vehicle?.bodyType ?? form.bodyType,
    category: priced ? priced.category : form.category,
    startAt: priced?.startAt ?? null,
    endAt: priced?.endAt ?? null,
    inputs: form,
    result: priced?.result ?? null,
    rateCardId: priced ? l.card.id : null,
    totalCentavos: priced?.total ?? null,
  };
}

// ---------------------------------------------------------------------------
// Live price (quick + formal forms)
// ---------------------------------------------------------------------------

export type PricePreview = {
  error: string | null;
  result: QuoteResult | null;
  startAt: string | null;
  endAt: string | null;
  schedule: PricedQuote["schedule"];
  clientIsRepeat: boolean | null;
  vehicleLabel: string | null;
  client: { id: string; fullName: string; isBlacklisted: boolean; blacklistReason: string | null; isRepeat: boolean; clientType: string } | null;
};

export const previewPrice = defineAction({
  permission: "quotes.manage",
  input: quoteFormSchema,
  handler: async (_actor, form): Promise<PricePreview> => {
    const l = await loadContext(db, form);
    const { priced, error } = tryPrice(form, l);
    const { bodyType, category } = priced ?? { bodyType: l.vehicle?.bodyType ?? form.bodyType, category: form.category };
    return {
      error,
      result: priced?.result ?? null,
      startAt: priced?.startAt.toISOString() ?? null,
      endAt: priced?.endAt.toISOString() ?? null,
      schedule: priced?.schedule ?? null,
      clientIsRepeat: priced?.clientIsRepeat ?? null,
      vehicleLabel: vehicleLabel(l.vehicle?.displayName ?? null, bodyType, category),
      client: l.client
        ? {
            id: l.client.id,
            fullName: l.client.fullName,
            isBlacklisted: l.client.isBlacklisted,
            blacklistReason: l.client.blacklistReason,
            isRepeat: l.client.firstRentalAt !== null,
            clientType: l.client.clientType,
          }
        : null,
    };
  },
});

// ---------------------------------------------------------------------------
// Quick quotation: saved as an issued estimate without a number
// ---------------------------------------------------------------------------

async function validityHours(executor: DbOrTx) {
  return (await getSettings(executor)).quote_validity_hours;
}

export const saveQuick = defineAction({
  permission: "quotes.manage",
  input: saveQuickSchema,
  handler: async (actor, { id, form }) => {
    return db.transaction(async (tx) => {
      const l = await loadContext(tx, form);
      const { priced, error } = tryPrice(form, l);
      if (!priced) throw new ActionError(400, error ?? "This quotation does not price.");
      const now = new Date();
      const validUntil = new Date(now.getTime() + (await validityHours(tx)) * 3_600_000);
      const values = {
        ...derivedColumns(form, l, priced),
        kind: "quick" as const,
        status: "issued" as const,
        issuedAt: now,
        validUntil,
        snapshot: snapshotOf(form, l, actor.displayName),
      };
      if (id) {
        const [cur] = await tx.select().from(quotations).where(eq(quotations.id, id)).for("update");
        if (!cur) throw new ActionError(404, "Quotation not found.");
        if (cur.kind !== "quick") throw new ActionError(409, "Only quick quotations can be saved here.");
        await tx.update(quotations).set(values).where(eq(quotations.id, id));
        return { id, validUntil: validUntil.toISOString() };
      }
      const [row] = await tx
        .insert(quotations)
        .values({ ...values, consultantId: actor.id, createdBy: actor.id })
        .returning({ id: quotations.id });
      await withAudit(actor, "quotation.quick_save", "quotation", row.id, null, { total: priced.total, service: form.service }, tx);
      return { id: row.id, validUntil: validUntil.toISOString() };
    });
  },
});

// ---------------------------------------------------------------------------
// Formal quotation: draft (autosave), issue, revise, lost, accepted
// ---------------------------------------------------------------------------

export const saveDraft = defineAction({
  permission: "quotes.manage",
  input: saveDraftSchema,
  handler: async (actor, { id, form }) => {
    return db.transaction(async (tx) => {
      const l = await loadContext(tx, form);
      const { priced, error } = tryPrice(form, l);
      const values = { ...derivedColumns(form, l, priced), snapshot: snapshotOf(form, l, null) };
      if (id) {
        const [cur] = await tx.select({ status: quotations.status, kind: quotations.kind }).from(quotations).where(eq(quotations.id, id)).for("update");
        if (!cur) throw new ActionError(404, "Quotation not found.");
        if (cur.kind !== "formal" || cur.status !== "draft") throw new ActionError(409, "Issued quotations are read-only. Revise it instead.");
        await tx.update(quotations).set(values).where(eq(quotations.id, id));
        return { id, error, savedAt: new Date().toISOString() };
      }
      const [row] = await tx
        .insert(quotations)
        .values({ ...values, kind: "formal", status: "draft", consultantId: actor.id, createdBy: actor.id })
        .returning({ id: quotations.id });
      return { id: row.id, error, savedAt: new Date().toISOString() };
    });
  },
});

function shareToken() {
  return randomBytes(32).toString("base64url");
}

export const issueQuotation = defineAction({
  permission: "quotes.manage",
  input: issueSchema,
  handler: async (actor, { id, form, overrideReason }) => {
    return db.transaction(async (tx) => {
      const [cur] = await tx.select().from(quotations).where(eq(quotations.id, id)).for("update");
      if (!cur) throw new ActionError(404, "Quotation not found.");
      if (cur.kind !== "formal" || cur.status !== "draft") throw new ActionError(409, "This quotation is already issued.");
      if (!form.clientId) throw new ActionError(400, "Choose or add a client before issuing.", { clientId: ["Choose a client"] });

      const l = await loadContext(tx, form);
      let override: { reason: string; by: string } | null = null;
      if (l.client?.isBlacklisted) {
        if (!can(actor, "quotes.override_blacklist")) {
          throw new ActionError(403, "This client is blacklisted. Only an Admin can issue a quotation for them.");
        }
        if (!overrideReason) {
          throw new ActionError(400, "Give a reason to issue for a blacklisted client.", { overrideReason: ["Give a reason"] });
        }
        override = { reason: overrideReason, by: actor.id };
      }
      const { priced, error } = tryPrice(form, l);
      if (!priced) throw new ActionError(400, error ?? "This quotation does not price.");

      const now = new Date();
      const validUntil = new Date(now.getTime() + (await validityHours(tx)) * 3_600_000);
      const number = await nextQuotationNumber(tx, form.service, now);
      const [consultant] = await tx
        .select({ displayName: user.displayName })
        .from(user)
        .where(eq(user.id, cur.consultantId ?? actor.id));
      const values = {
        ...derivedColumns(form, l, priced),
        number,
        status: "issued" as const,
        issuedAt: now,
        validUntil,
        shareToken: shareToken(),
        snapshot: snapshotOf(form, l, consultant?.displayName ?? actor.displayName),
        blacklistOverrideReason: override?.reason ?? null,
        blacklistOverrideBy: override?.by ?? null,
      };
      await tx.update(quotations).set(values).where(eq(quotations.id, id));
      await withAudit(
        actor,
        "quotation.issue",
        "quotation",
        id,
        { status: "draft" },
        { number, total: priced.total, rateCardId: l.card.id, validUntil: validUntil.toISOString(), blacklistOverride: override?.reason ?? null },
        tx,
      );

      if (cur.revisedFromId) {
        const [old] = await tx.select().from(quotations).where(eq(quotations.id, cur.revisedFromId)).for("update");
        if (old && old.status !== "cancelled") {
          const note = `Revised by ${number}`;
          await tx.update(quotations).set({ status: "cancelled", statusNote: note }).where(eq(quotations.id, old.id));
          await withAudit(actor, "quotation.cancel", "quotation", old.id, { status: old.status }, { status: "cancelled", statusNote: note }, tx);
        }
      }
      return { id, number };
    });
  },
});

export const reviseQuotation = defineAction({
  permission: "quotes.manage",
  input: quoteIdSchema,
  handler: async (actor, { id }) => {
    return db.transaction(async (tx) => {
      const [src] = await tx.select().from(quotations).where(eq(quotations.id, id)).for("update");
      if (!src) throw new ActionError(404, "Quotation not found.");
      if (src.kind !== "formal" || src.status === "draft" || src.status === "cancelled") {
        throw new ActionError(409, "Only issued quotations can be revised.");
      }
      const [existing] = await tx
        .select({ id: quotations.id })
        .from(quotations)
        .where(and(eq(quotations.revisedFromId, id), eq(quotations.status, "draft")));
      if (existing) return { id: existing.id };
      const [row] = await tx
        .insert(quotations)
        .values({
          kind: "formal",
          status: "draft",
          service: src.service,
          clientId: src.clientId,
          clientName: src.clientName,
          vehicleId: src.vehicleId,
          bodyType: src.bodyType,
          category: src.category,
          startAt: src.startAt,
          endAt: src.endAt,
          inputs: src.inputs,
          snapshot: src.snapshot,
          notes: src.notes,
          revisedFromId: src.id,
          consultantId: actor.id,
          createdBy: actor.id,
        })
        .returning({ id: quotations.id });
      await withAudit(actor, "quotation.revise", "quotation", row.id, null, { revisedFrom: src.number }, tx);
      return { id: row.id };
    });
  },
});

async function lockIssued(tx: DbOrTx, id: string) {
  const [cur] = await tx.select().from(quotations).where(eq(quotations.id, id)).for("update");
  if (!cur) throw new ActionError(404, "Quotation not found.");
  if (cur.kind !== "formal" || cur.status !== "issued") throw new ActionError(409, "Only issued quotations can change status.");
  return cur;
}

export const markLost = defineAction({
  permission: "quotes.manage",
  input: markLostSchema,
  handler: async (actor, { id, reason }) => {
    return db.transaction(async (tx) => {
      await lockIssued(tx, id);
      await tx.update(quotations).set({ status: "lost", statusNote: reason }).where(eq(quotations.id, id));
      await withAudit(actor, "quotation.lost", "quotation", id, { status: "issued" }, { status: "lost", statusNote: reason }, tx);
      return { id };
    });
  },
});

export const markAccepted = defineAction({
  permission: "quotes.manage",
  input: quoteIdSchema,
  handler: async (actor, { id }) => {
    return db.transaction(async (tx) => {
      const cur = await lockIssued(tx, id);
      if (effectiveStatus(cur) === "expired") throw new ActionError(409, "This quotation has expired. Revise it to issue an updated one.");
      await tx.update(quotations).set({ status: "accepted" }).where(eq(quotations.id, id));
      await withAudit(actor, "quotation.accepted", "quotation", id, { status: "issued" }, { status: "accepted" }, tx);
      return { id };
    });
  },
});

export const updateNotes = defineAction({
  permission: "quotes.manage",
  input: quoteIdSchema.extend({ notes: quoteFormSchema.shape.notes }),
  handler: async (actor, { id, notes }) => {
    const [row] = await db.update(quotations).set({ notes: notes || null }).where(eq(quotations.id, id)).returning({ id: quotations.id });
    if (!row) throw new ActionError(404, "Quotation not found.");
    return { id };
  },
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type QuotationView = QuotationRow & {
  effective: EffectiveStatus;
  consultantName: string | null;
  form: QuoteForm;
  revisedFromNumber: string | null;
  revisedById: string | null;
  client: { id: string; fullName: string; isBlacklisted: boolean; blacklistReason: string | null; firstRentalAt: Date | null; clientType: "individual" | "corporate" } | null;
  rateCardVersion: number | null;
  overrideByName: string | null;
};

export async function getQuotation(id: string): Promise<QuotationView | null> {
  const [row] = await db.select().from(quotations).where(eq(quotations.id, id));
  if (!row) return null;
  return toView(row);
}

async function toView(row: QuotationRow): Promise<QuotationView> {
  const [consultant, client, revisedFrom, revisedBy, card, overrideBy] = await Promise.all([
    row.consultantId ? db.select({ displayName: user.displayName }).from(user).where(eq(user.id, row.consultantId)) : Promise.resolve([]),
    row.clientId
      ? db
          .select({ id: clients.id, fullName: clients.fullName, isBlacklisted: clients.isBlacklisted, blacklistReason: clients.blacklistReason, firstRentalAt: clients.firstRentalAt, clientType: clients.clientType })
          .from(clients)
          .where(eq(clients.id, row.clientId))
      : Promise.resolve([]),
    row.revisedFromId ? db.select({ number: quotations.number }).from(quotations).where(eq(quotations.id, row.revisedFromId)) : Promise.resolve([]),
    db.select({ id: quotations.id }).from(quotations).where(eq(quotations.revisedFromId, row.id)).orderBy(desc(quotations.createdAt)).limit(1),
    row.rateCardId ? db.select({ version: rateCards.version }).from(rateCards).where(eq(rateCards.id, row.rateCardId)) : Promise.resolve([]),
    row.blacklistOverrideBy ? db.select({ displayName: user.displayName }).from(user).where(eq(user.id, row.blacklistOverrideBy)) : Promise.resolve([]),
  ]);
  return {
    ...row,
    effective: effectiveStatus(row),
    consultantName: consultant[0]?.displayName ?? null,
    form: quoteFormSchema.parse(row.inputs),
    revisedFromNumber: revisedFrom[0]?.number ?? null,
    revisedById: revisedBy[0]?.id ?? null,
    client: client[0] ?? null,
    rateCardVersion: card[0]?.version ?? null,
    overrideByName: overrideBy[0]?.displayName ?? null,
  };
}

/** Client-facing document from a stored row (issued/quick only; needs a result). */
export function toDoc(row: QuotationRow, business: Business): QuoteDoc | null {
  if (!row.result || !row.startAt || !row.endAt || !row.bodyType) return null;
  const snap = (row.snapshot ?? {}) as Partial<QuoteSnapshot>;
  const category = (row.category as Category | null) ?? null;
  return {
    number: row.number,
    kind: row.kind,
    service: row.service,
    status: effectiveStatus(row),
    issuedAt: row.issuedAt,
    validUntil: row.validUntil,
    startAt: row.startAt,
    endAt: row.endAt,
    business,
    consultantName: snap.consultantName ?? null,
    clientName: snap.clientName ?? row.clientName,
    clientFbName: snap.clientFbName ?? null,
    vehicleLabel: vehicleLabel(snap.vehicleName ?? null, row.bodyType, category),
    bodyLabel: bodyLabel(row.bodyType, null),
    categoryLabel: category ? CATEGORY_LABELS[category] : null,
    form: quoteFormSchema.parse(row.inputs),
    result: row.result as QuoteResult,
  };
}

export async function getDocById(id: string): Promise<{ row: QuotationRow; doc: QuoteDoc } | null> {
  const [row] = await db.select().from(quotations).where(eq(quotations.id, id));
  if (!row) return null;
  const doc = toDoc(row, (await getSettings()).business);
  return doc ? { row, doc } : null;
}

/** Public share link: formal, issued at least once, matching token. */
export async function getByShareToken(token: string): Promise<{ row: QuotationRow; doc: QuoteDoc } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await db.select().from(quotations).where(eq(quotations.shareToken, token));
  if (!row || row.kind !== "formal" || !row.issuedAt) return null;
  const doc = toDoc(row, (await getSettings()).business);
  return doc ? { row, doc } : null;
}

/** Share link lifetime (PLAN §6.5): until 30 days after valid_until. */
export const SHARE_GRACE_DAYS = 30;
export function shareLinkOpen(row: Pick<QuotationRow, "status" | "validUntil">, now = new Date()): boolean {
  if (row.status === "cancelled") return false;
  if (!row.validUntil) return false;
  return now.getTime() <= row.validUntil.getTime() + SHARE_GRACE_DAYS * 86_400_000;
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function statusCondition(status: QuoteListQuery["status"], now: Date): SQL | undefined {
  switch (status) {
    case "all":
      return undefined;
    case "issued":
      return and(eq(quotations.status, "issued"), gte(quotations.validUntil, now));
    case "expired":
      return or(eq(quotations.status, "expired"), and(eq(quotations.status, "issued"), lt(quotations.validUntil, now)));
    default:
      return eq(quotations.status, status);
  }
}

const listColumns = {
  id: quotations.id,
  number: quotations.number,
  kind: quotations.kind,
  service: quotations.service,
  status: quotations.status,
  clientName: quotations.clientName,
  bodyType: quotations.bodyType,
  category: quotations.category,
  startAt: quotations.startAt,
  totalCentavos: quotations.totalCentavos,
  validUntil: quotations.validUntil,
  issuedAt: quotations.issuedAt,
  createdAt: quotations.createdAt,
  consultantName: user.displayName,
};

export type QuoteListRow = Awaited<ReturnType<typeof listQuotations>>["rows"][number];

export async function listQuotations(query: QuoteListQuery, now = new Date()) {
  const conds: SQL[] = [];
  const st = statusCondition(query.status, now);
  if (st) conds.push(st);
  if (query.service !== "all") conds.push(eq(quotations.service, query.service));
  if (query.kind !== "all") conds.push(eq(quotations.kind, query.kind));
  if (query.consultant !== "all") conds.push(eq(quotations.consultantId, query.consultant));
  if (query.from) conds.push(gte(quotations.createdAt, manilaToUtc(query.from)));
  if (query.to) conds.push(lt(quotations.createdAt, manilaToUtc(addDaysToKey(query.to, 1))));
  if (query.q) {
    const like = `%${escapeLike(query.q)}%`;
    conds.push(or(ilike(quotations.number, like), ilike(quotations.clientName, like))!);
  }
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select(listColumns)
      .from(quotations)
      .leftJoin(user, eq(user.id, quotations.consultantId))
      .where(where)
      .orderBy(desc(quotations.createdAt))
      .limit(QUOTES_PAGE_SIZE)
      .offset((query.page - 1) * QUOTES_PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(quotations).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r, effective: effectiveStatus(r, now) })), total };
}

export async function listConsultants() {
  return db
    .select({ id: user.id, displayName: user.displayName })
    .from(user)
    .where(inArray(user.role, ["super_admin", "admin", "sales"]))
    .orderBy(asc(user.displayName));
}

export async function dashboardData(actor: CurrentUser, now = new Date()) {
  const dayStart = startOfManilaDay(now);
  const soon = new Date(now.getTime() + 6 * 3_600_000);
  const q = () => db.select(listColumns).from(quotations).leftJoin(user, eq(user.id, quotations.consultantId));
  const [mine, expiring, recent] = await Promise.all([
    q()
      .where(and(eq(quotations.consultantId, actor.id), gte(quotations.createdAt, dayStart)))
      .orderBy(desc(quotations.createdAt)),
    q()
      .where(and(eq(quotations.status, "issued"), eq(quotations.kind, "formal"), gte(quotations.validUntil, now), lt(quotations.validUntil, soon)))
      .orderBy(asc(quotations.validUntil)),
    q().orderBy(desc(quotations.createdAt)).limit(10),
  ]);
  const withStatus = <T extends { status: EffectiveStatus; validUntil: Date | null }>(rows: T[]) =>
    rows.map((r) => ({ ...r, effective: effectiveStatus(r, now) }));
  return { mine: withStatus(mine), expiring: withStatus(expiring), recent: withStatus(recent) };
}

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

export async function listVehiclesForQuotes() {
  return db
    .select({ id: vehicles.id, displayName: vehicles.displayName, plate: vehicles.plate, bodyType: vehicles.bodyType, fuelType: vehicles.fuelType })
    .from(vehicles)
    .where(eq(vehicles.active, true))
    .orderBy(asc(vehicles.sortOrder), asc(vehicles.displayName));
}

export async function defaultFuelPrices() {
  return (await getSettings()).fuel_prices_centavos;
}

/** Client picker on the quotation form (top matches). */
export const searchClientsForQuote = defineAction({
  permission: "clients.view",
  input: quoteIdSchema.pick({}).extend({ q: quoteFormSchema.shape.clientName }),
  handler: async (_actor, { q }): Promise<ClientHit[]> => {
    if (!q) return [];
    const { rows } = await searchClients({ q, page: 1, blacklisted: "all" });
    return rows.slice(0, 10).map((c) => ({
      id: c.id,
      fullName: c.fullName,
      fbName: c.fbName,
      phone: c.phone,
      isBlacklisted: c.isBlacklisted,
      isRepeat: c.firstRentalAt !== null,
      clientType: c.clientType,
    }));
  },
});

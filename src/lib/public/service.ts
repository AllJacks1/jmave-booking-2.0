/**
 * Public booking page (Phase 4): availability with prices, and booking
 * requests. No login. Called by the route handlers in `src/app/api/public`.
 *
 * - Only cars with no active hold overlapping the request (turnaround buffer
 *   included) are shown or accepted. Pending reservations never hold a car.
 * - Prices come from the engine with the active rate card (`priceQuote`).
 * - A request creates an inquiry, links or creates the client, a draft
 *   formal quotation and a Rework outbox row, in one transaction. Nothing
 *   holds a car.
 */
import "server-only";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { clients, inquiries, quotations, rateCards, vehicles } from "@/db/schema";
import { fieldErrorsFromZod } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { heldUntil, turnaroundBufferMinutes } from "@/lib/holds";
import { nextNumber } from "@/lib/numbering";
import { normalisePhPhone } from "@/lib/phone";
import { BODY_TYPE_LABELS, CATEGORY_LABELS, PricingInputError, rateCardDataSchema, withDriverWindow, type RateCardData } from "@/lib/pricing";
import { priceQuote, type PricedQuote } from "@/lib/quotes/engine";
import type { QuoteForm } from "@/lib/quotes/schema";
import { holidayDates } from "@/lib/rates/service";
import { enqueueReworkLead, staffUrl } from "@/lib/rework/leads";
import { WEBSITE_DEAL_SOURCE } from "@/lib/rework/options";
import type { LeadFacts } from "@/lib/rework/payload";
import { getSettings } from "@/lib/settings/service";
import { manilaToUtc, manilaYear } from "@/lib/time";
import { clientIp, rateKey, takeRateLimit, verifyTurnstile } from "./guard";
import { publicBreakdown, publicCategory, publicQuoteForm, publicTotal, publicVehicleName, type PublicVehicleRow } from "./quote-form";
import {
  MAX_AHEAD_DAYS,
  MIN_LEAD_MINUTES,
  quoteRequestSchema,
  submitSchema,
  type Details,
  type PublicPriceDetail,
  type PublicVehicle,
  type QuoteResponse,
  type Search,
  type Submit,
  type SubmitResponse,
} from "./schema";

type Fail = { ok: false; error: string; fieldErrors?: Record<string, string[]> };
const fail = (error: string, fieldErrors?: Record<string, string[]>): Fail => ({ ok: false, error, ...(fieldErrors ? { fieldErrors } : {}) });

export type HttpResult<T> = { status: number; body: T };

// ---------------------------------------------------------------------------
// Window and context
// ---------------------------------------------------------------------------

/** Start and end of the request (With Driver: end of the last day's window). */
export function requestWindow(s: Search): { startAt: Date; endAt: Date } {
  if (s.service === "self_drive") {
    return { startAt: manilaToUtc(s.startDate, s.startTime), endAt: manilaToUtc(s.endDate!, s.endTime!) };
  }
  const w = withDriverWindow(s.startDate, s.startTime, s.wdEndTime!, s.wdDays);
  return { startAt: w.startAt, endAt: w.endAt };
}

/** Field errors for a window the public may not ask for, or null. */
export function windowProblem(s: Search, now: Date): Record<string, string[]> | null {
  const { startAt, endAt } = requestWindow(s);
  if (startAt.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000) {
    return { startTime: [`Start at least ${MIN_LEAD_MINUTES / 60} hours from now. For sooner, call or message us.`] };
  }
  if (startAt.getTime() > now.getTime() + MAX_AHEAD_DAYS * 86_400_000) return { startDate: ["Choose a date within the next 12 months"] };
  if (s.service === "self_drive" && !(endAt > startAt)) return { endTime: ["Return must be after pick-up"] };
  if (s.service === "self_drive" && endAt.getTime() - startAt.getTime() > 60 * 86_400_000) {
    return { endDate: ["For rentals longer than 60 days, please contact us"] };
  }
  return null;
}

type Ctx = { card: { id: string; data: RateCardData }; holidays: string[]; fuelPrices: QuoteForm["fuelPrices"]; buffer: number };

async function pricingContext(executor: DbOrTx): Promise<Ctx | null> {
  const [[row], holidays, settings, buffer] = await Promise.all([
    executor.select({ id: rateCards.id, data: rateCards.data }).from(rateCards).where(eq(rateCards.status, "active")),
    holidayDates(),
    getSettings(executor),
    turnaroundBufferMinutes(executor),
  ]);
  if (!row) return null;
  const parsed = rateCardDataSchema.safeParse(row.data);
  if (!parsed.success) return null;
  return { card: { id: row.id, data: parsed.data }, holidays, fuelPrices: settings.fuel_prices_centavos, buffer };
}

const vehicleColumns = {
  id: vehicles.id,
  displayName: vehicles.displayName,
  plate: vehicles.plate,
  make: vehicles.make,
  model: vehicles.model,
  color: vehicles.color,
  transmission: vehicles.transmission,
  seats: vehicles.seats,
  bodyType: vehicles.bodyType,
  fuelType: vehicles.fuelType,
  category: vehicles.category,
};

/**
 * Active, publicly listed cars with no active hold overlapping
 * [start, end + buffer) — the same window a confirmed booking would hold.
 */
export async function availableVehicles(
  executor: DbOrTx,
  window: { startAt: Date; endAt: Date },
  bufferMinutes: number,
  onlyId?: string,
): Promise<PublicVehicleRow[]> {
  const end = heldUntil(window.endAt, bufferMinutes);
  const range = sql`tstzrange(${window.startAt.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')`;
  const rows = await executor
    .select(vehicleColumns)
    .from(vehicles)
    .where(
      and(
        eq(vehicles.active, true),
        eq(vehicles.listedPublicly, true),
        isNotNull(vehicles.bodyType),
        onlyId ? eq(vehicles.id, onlyId) : undefined,
        sql`not exists (select 1 from vehicle_holds h where h.vehicle_id = ${vehicles.id} and h.active and h.period && ${range})`,
      ),
    )
    .orderBy(asc(vehicles.bodyType), asc(vehicles.sortOrder), asc(vehicles.displayName));
  return rows.filter((v) => publicCategory(v).ok);
}

function priceFor(search: Search, v: PublicVehicleRow, ctx: Ctx): PricedQuote {
  const form = publicQuoteForm(search, v, ctx.fuelPrices, "public_price");
  return priceQuote(form, { card: ctx.card.data, holidays: ctx.holidays, client: null, vehicle: { bodyType: v.bodyType, fuelType: v.fuelType } });
}

function toPublicVehicle(v: PublicVehicleRow, priced: PricedQuote): PublicVehicle {
  const { category } = publicCategory(v);
  return {
    id: v.id,
    name: publicVehicleName(v),
    bodyType: BODY_TYPE_LABELS[v.bodyType!],
    category: category ? CATEGORY_LABELS[category] : null,
    transmission: v.transmission?.trim() || null,
    seats: v.seats,
    total: publicTotal(priced.result),
  };
}

function priceProblem(e: unknown): string | null {
  if (e instanceof PricingInputError) return e.message;
  if (e instanceof Error && /^Invalid (date|time)/.test(e.message)) return e.message;
  return null;
}

// ---------------------------------------------------------------------------
// Availability + prices
// ---------------------------------------------------------------------------

export async function publicQuote(raw: unknown, now = new Date()): Promise<HttpResult<QuoteResponse>> {
  const parsed = quoteRequestSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: fail("Please check the highlighted fields.", prefix(fieldErrorsFromZod(parsed.error), "search.")) };
  const { search, vehicleId } = parsed.data;
  const problem = windowProblem(search, now);
  if (problem) return { status: 400, body: fail(Object.values(problem)[0][0], problem) };
  const ctx = await pricingContext(db);
  if (!ctx) return { status: 503, body: fail("Online prices are not available right now. Please call or message us.") };

  const window = requestWindow(search);
  const cars = await availableVehicles(db, window, ctx.buffer, vehicleId);
  const out: PublicVehicle[] = [];
  let detail: PublicPriceDetail | null = null;
  for (const v of cars) {
    let priced: PricedQuote;
    try {
      priced = priceFor(search, v, ctx);
    } catch (e) {
      const msg = priceProblem(e);
      if (msg === null) throw e;
      // The request itself does not price (e.g. a With Driver day over 24 h): same for every car.
      return { status: 400, body: fail(msg, { _form: [msg] }) };
    }
    const pv = toPublicVehicle(v, priced);
    out.push(pv);
    if (vehicleId) {
      detail = { ...pv, ...publicBreakdown(priced.result), warnings: [], startAt: priced.startAt.toISOString(), endAt: priced.endAt.toISOString() };
    }
  }
  if (vehicleId && !detail) {
    return { status: 409, body: fail("Sorry, that car is no longer available for these dates. Please choose another.") };
  }
  return { status: 200, body: { ok: true, vehicles: out, detail, startAt: window.startAt.toISOString(), endAt: window.endAt.toISOString() } };
}

function prefix(errors: Record<string, string[]>, p: string): Record<string, string[]> {
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [k.startsWith(p) ? k.slice(p.length) : k, v]));
}

// ---------------------------------------------------------------------------
// Booking request
// ---------------------------------------------------------------------------

export type RequestContext = { headers: Headers; now?: Date };

/** `REQ-2026-0001` (4 digits, grows past 9999; per Manila year). */
export async function nextInquiryReference(tx: DbOrTx, at: Date): Promise<string> {
  const key = `REQ-${manilaYear(at)}`;
  const n = await nextNumber(tx, key);
  return `${key}-${String(n).padStart(4, "0")}`;
}

export async function submitInquiry(raw: unknown, rc: RequestContext): Promise<HttpResult<SubmitResponse>> {
  const now = rc.now ?? new Date();
  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: fail("Please check the highlighted fields.", fieldErrorsFromZod(parsed.error)) };
  const input = parsed.data;
  // Honeypot: people never see the field.
  if (input.website.trim() !== "") return { status: 400, body: fail("We could not send your request. Please call or message us.") };
  const problem = windowProblem(input.search, now);
  if (problem) {
    return { status: 400, body: fail(Object.values(problem)[0][0], Object.fromEntries(Object.entries(problem).map(([k, v]) => [`search.${k}`, v]))) };
  }

  const ip = clientIp(rc.headers);
  const userAgent = rc.headers.get("user-agent")?.slice(0, 500) ?? null;
  if (!(await takeRateLimit(db, rateKey("inquiry", ip), now))) {
    return { status: 429, body: fail("Too many requests from this connection. Please try again in an hour, or call or message us.") };
  }
  const captcha = await verifyTurnstile(input.turnstileToken, ip);
  if (!captcha.ok) {
    if (captcha.reason === "not_configured") {
      console.error(JSON.stringify({ svc: "web", level: "error", msg: "public booking refused: TURNSTILE_SECRET_KEY is not set" }));
      return { status: 503, body: fail("Online booking is not available right now. Please call or message us.") };
    }
    return { status: 400, body: fail("Please complete the security check and try again.", { turnstileToken: ["Please complete the security check"] }) };
  }

  const ctx = await pricingContext(db);
  if (!ctx) return { status: 503, body: fail("Online booking is not available right now. Please call or message us.") };

  return db.transaction(async (tx) => {
    // Serialise requests for one car; re-check it is still free.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`public-request:${input.vehicleId}`}))`);
    const window = requestWindow(input.search);
    const [vehicle] = await availableVehicles(tx, window, ctx.buffer, input.vehicleId);
    if (!vehicle) {
      return { status: 409, body: fail("Sorry, that car is no longer available for these dates. Please choose another.", { vehicleId: ["No longer available"] }) };
    }
    let shown: PricedQuote;
    try {
      shown = priceFor(input.search, vehicle, ctx);
    } catch (e) {
      const msg = priceProblem(e);
      if (msg === null) throw e;
      return { status: 400, body: fail(msg, { _form: [msg] }) };
    }

    const notes: string[] = [];
    const client = await linkOrCreateClient(tx, input.details, notes);
    const reference = await nextInquiryReference(tx, now);

    // Draft formal quotation, priced with the client's real history (new-client discount applies).
    const form = publicQuoteForm(input.search, vehicle, ctx.fuelPrices, "draft", { clientId: client.id, details: input.details, reference });
    let draft: PricedQuote | null = null;
    try {
      draft = priceQuote(form, {
        card: ctx.card.data,
        holidays: ctx.holidays,
        client: { firstRentalAt: client.firstRentalAt, clientType: client.clientType },
        vehicle: { bodyType: vehicle.bodyType, fuelType: vehicle.fuelType },
      });
    } catch (e) {
      if (priceProblem(e) === null) throw e;
    }
    const [quote] = await tx
      .insert(quotations)
      .values({
        kind: "formal",
        status: "draft",
        service: form.service,
        clientId: client.id,
        clientName: client.fullName,
        vehicleId: vehicle.id,
        bodyType: draft?.bodyType ?? vehicle.bodyType,
        category: draft?.category ?? form.category,
        startAt: draft?.startAt ?? window.startAt,
        endAt: draft?.endAt ?? window.endAt,
        inputs: form,
        result: draft?.result ?? null,
        rateCardId: draft ? ctx.card.id : null,
        totalCentavos: draft?.total ?? null,
        snapshot: { clientName: client.fullName, clientFbName: client.fbName, vehicleName: vehicle.displayName, consultantName: null },
        notes: form.notes || null,
      })
      .returning({ id: quotations.id });

    const [inq] = await tx
      .insert(inquiries)
      .values({
        reference,
        service: input.search.service,
        vehicleId: vehicle.id,
        startAt: window.startAt,
        endAt: window.endAt,
        payload: { search: input.search, details: input.details, consent: true, consentAt: now.toISOString() },
        utm: input.attribution,
        meta: { ip, userAgent },
        notes: notes.length ? notes.join("\n") : null,
        clientId: client.id,
        quotationId: quote.id,
        shownTotalCentavos: publicTotal(shown.result),
      })
      .returning({ id: inquiries.id });

    await enqueueReworkLead(tx, inquiryFacts(input, window, vehicle, { ip, userAgent, link: staffUrl(`/inquiries/${inq.id}`) }), {
      source: "inquiry",
      reference,
      entity: "inquiry",
      entityId: inq.id,
      clientId: client.id,
      createdBy: null,
    });
    await withAudit(null, "inquiry.created", "inquiry", inq.id, null, { reference, quotationId: quote.id, clientId: client.id, newClient: client.created }, tx);
    return { status: 201, body: { ok: true as const, reference } };
  });
}

type LinkedClient = {
  id: string;
  fullName: string;
  fbName: string | null;
  firstRentalAt: Date | null;
  clientType: "individual" | "corporate";
  created: boolean;
};

/**
 * Exact phone match links the existing client (details are not changed);
 * otherwise a new client flagged `source = website`. A new client whose email
 * another client already uses is saved without the email (and a note), so
 * the staff uniqueness rule stays intact.
 */
async function linkOrCreateClient(tx: DbOrTx, d: Details, notes: string[]): Promise<LinkedClient> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('clients'))`);
  const phone = normalisePhPhone(d.phone)!;
  const matches = await tx
    .select({ id: clients.id, fullName: clients.fullName, fbName: clients.fbName, firstRentalAt: clients.firstRentalAt, clientType: clients.clientType, isBlacklisted: clients.isBlacklisted })
    .from(clients)
    .where(eq(clients.phone, phone))
    .orderBy(asc(clients.createdAt));
  if (matches.length) {
    const m = matches[0];
    if (matches.length > 1) notes.push(`${matches.length} clients share this phone number; linked to the oldest.`);
    if (m.isBlacklisted) notes.push("The matched client is blacklisted.");
    if (m.fullName.trim().toLowerCase() !== d.fullName.trim().toLowerCase()) notes.push(`Name on the request ("${d.fullName}") differs from the client record.`);
    return { ...m, created: false };
  }
  let email: string | null = d.email || null;
  if (email) {
    const [dup] = await tx.select({ fullName: clients.fullName }).from(clients).where(sql`lower(${clients.email}) = ${email}`).limit(1);
    if (dup) {
      notes.push(`Email ${email} is already used by client ${dup.fullName}; saved without the email.`);
      email = null;
    }
  }
  const values = {
    fullName: d.fullName,
    phone,
    email,
    birthday: d.birthday || null,
    address: d.address || null,
    altContactName: d.altContactName || null,
    altContactPhone: d.altContactPhone ? normalisePhPhone(d.altContactPhone) : null,
    driversLicenseNo: d.driversLicenseNo || null,
    companyName: d.companyName || null,
    clientType: d.companyName ? ("corporate" as const) : ("individual" as const),
    source: "website",
  };
  const [row] = await tx.insert(clients).values(values).returning();
  await withAudit(null, "client.create", "client", row.id, null, { ...values, via: "public booking page" }, tx);
  return { id: row.id, fullName: row.fullName, fbName: row.fbName, firstRentalAt: row.firstRentalAt, clientType: row.clientType, created: true };
}

/** Rework facts for a public request (the intake as submitted). */
export function inquiryFacts(
  input: Pick<Submit, "search" | "details" | "attribution">,
  window: { startAt: Date; endAt: Date },
  vehicle: Pick<PublicVehicleRow, "bodyType" | "category">,
  extra: { ip: string | null; userAgent: string | null; link: string | null },
): LeadFacts {
  const { search: s, details: d } = input;
  const wd = s.service === "with_driver";
  return {
    client: {
      fullName: d.fullName,
      email: d.email || null,
      phone: normalisePhPhone(d.phone),
      birthday: d.birthday || null,
      altContactName: d.altContactName || null,
      altContactPhone: d.altContactPhone ? normalisePhPhone(d.altContactPhone) : null,
      driversLicenseNo: d.driversLicenseNo || null,
      companyName: d.companyName || null,
    },
    service: s.service,
    startAt: window.startAt,
    endAt: window.endAt,
    bodyType: vehicle.bodyType,
    category: publicCategory(vehicle).category,
    destination: s.destination || null,
    itinerary: wd ? d.itinerary : null,
    deliveryAddress: wd ? null : d.deliveryAddress,
    pickupAddress: d.pickupAddress,
    dropoffAddress: wd ? d.dropoffAddress : null,
    driversLicenseType: d.driversLicenseType || null,
    idsPresented: d.idsPresented,
    passengers: wd ? d.passengers : null,
    luggage: wd ? d.luggage : null,
    drivingTerm: wd ? s.drivingTerm : null,
    specialRequests: d.specialRequests,
    paymentMethod: s.paymentMethod,
    dealSource: WEBSITE_DEAL_SOURCE,
    link: extra.link,
    attribution: input.attribution,
    geoIp: extra.ip,
    userAgent: extra.userAgent,
  };
}

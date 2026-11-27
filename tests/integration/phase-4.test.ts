import { hasTestDb } from "./env";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, db } from "@/db/client";
import { auditLog, bookings, clients, inquiries, outbox, publicRateEvents, quotations, rateCards, vehicleBlocks, vehicleHolds, vehicles } from "@/db/schema";
import { addPayment, confirmBooking, convertToBooking } from "@/lib/bookings/service";
import { createClientFromQuote } from "@/lib/clients/service";
import { setHold } from "@/lib/holds";
import { rejectInquiry } from "@/lib/inquiries/service";
import { processOutbox } from "@/lib/outbox/dispatch";
import { EXPECTED_RATE_CARD_V1 } from "@/lib/pricing";
import { publicQuoteForm, publicTotal } from "@/lib/public/quote-form";
import { searchSchema, type SubmitInput } from "@/lib/public/schema";
import { publicQuote, submitInquiry } from "@/lib/public/service";
import { priceQuote } from "@/lib/quotes/engine";
import { quoteFormSchema, type QuoteFormInput } from "@/lib/quotes/schema";
import { issueQuotation, saveDraft } from "@/lib/quotes/service";
import { reworkHandler } from "@/lib/rework/outbox-handler";
import { sendClientToRework, sendTestLead } from "@/lib/rework/leads";
import { ensureDefaultSettings, getSettings, updateReworkSettings } from "@/lib/settings/service";
import { reworkTransport } from "@/worker/rework";
import { makeUser, truncateAll } from "./helpers";

type Actor = Awaited<ReturnType<typeof makeUser>>;
type R<T> = { ok: true; data: T } | { ok: false; error: string; status: number };
function ok<T>(r: R<T>): T {
  if (!r.ok) throw new Error(`${r.status} ${r.error}`);
  return r.data;
}

/** Invented data only. "Now" is fixed; trips are in late December 2026. */
const NOW = new Date("2026-12-01T00:00:00.000Z");
let sales: Actor;
let admin: Actor;
let sa: Actor;
let ops: Actor;
let sedan: { id: string };
let sedan2: { id: string };
let van: { id: string };

async function seed() {
  await ensureDefaultSettings();
  await db.insert(rateCards).values({ version: 1, name: "v1", status: "active", data: EXPECTED_RATE_CARD_V1, source: "test" });
  [sedan, sedan2, van] = await db
    .insert(vehicles)
    .values([
      { displayName: "Vios Red AT TST 4001", plate: "TST 4001", make: "Toyota", model: "Vios", bodyType: "sedan", category: "primo", fuelType: "gasoline", seats: 5, transmission: "AT", sortOrder: 1 },
      { displayName: "City Blue AT TST 4002", plate: "TST 4002", bodyType: "sedan", category: "premium", fuelType: "gasoline", sortOrder: 2 },
      { displayName: "Hiace TST 4003", plate: "TST 4003", bodyType: "van", fuelType: "diesel", sortOrder: 3 },
    ])
    .returning({ id: vehicles.id });
  await db.insert(vehicles).values([
    { displayName: "Uncategorised sedan TST 4004", plate: "TST 4004", bodyType: "sedan", fuelType: "gasoline" },
    { displayName: "Hidden van TST 4005", plate: "TST 4005", bodyType: "van", listedPublicly: false },
    { displayName: "Inactive van TST 4006", plate: "TST 4006", bodyType: "van", active: false },
  ]);
  sales = await makeUser("sales");
  admin = await makeUser("admin");
  sa = await makeUser("super_admin");
  ops = await makeUser("operations");
}

const SD = { service: "self_drive", startDate: "2026-12-20", startTime: "10:00", endDate: "2026-12-22", endTime: "10:00" } as const;
const WD = { service: "with_driver", startDate: "2026-12-20", startTime: "08:00", wdEndTime: "18:00", wdDays: 2, destination: "Tagum City", serviceArea: "davao_region", oneWayKm: 60 } as const;

function submission(over: Partial<SubmitInput> = {}): SubmitInput {
  return {
    search: SD,
    vehicleId: sedan.id,
    details: {
      fullName: "Nina Invented",
      phone: "0917 555 0101",
      email: "nina.invented@example.test",
      birthday: "1995-05-05",
      deliveryAddress: "Door 9, Invented Ave, Davao City",
      idsPresented: ["Passport"],
      specialRequests: "Please call before delivery",
    },
    consent: true,
    turnstileToken: "",
    website: "",
    attribution: { utm_source: "facebook", utm_campaign: "dec", fbclid: "IwAR-invented" },
    ...over,
  };
}

const headers = (ip = "203.0.113.10") => new Headers({ "x-forwarded-for": `${ip}, 10.0.0.1`, "user-agent": "Vitest Invented UA" });

async function submit(over: Partial<SubmitInput> = {}, ip?: string) {
  return submitInquiry(submission(over), { headers: headers(ip), now: NOW });
}

describe.skipIf(!hasTestDb)("Phase 4: public booking page, inquiries, Rework", () => {
  beforeEach(async () => {
    await truncateAll();
    await seed();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  afterAll(closeDb);

  describe("availability", () => {
    const ids = async (search: object) => {
      const r = await publicQuote({ search }, NOW);
      expect(r.status).toBe(200);
      if (!r.body.ok) throw new Error(r.body.error);
      return r.body.vehicles.map((v) => v.id);
    };

    it("lists active, listed, priceable cars only", async () => {
      expect(await ids(SD)).toEqual([sedan.id, sedan2.id, van.id]);
    });

    it("never shows a car with an active hold for the chosen time (buffer included)", async () => {
      // Confirmed booking on the sedan ending Dec 20 09:30 → held until 10:30 (60 min buffer).
      const draft = ok(
        await saveDraft(sales, {
          form: {
            ...quoteFormSchema.parse(publicQuoteForm(searchSchema.parse({ ...SD, startDate: "2026-12-18", startTime: "09:30", endDate: "2026-12-20", endTime: "09:30" }), { id: sedan.id, bodyType: "sedan", category: "primo" }, (await getSettings()).fuel_prices_centavos, "draft")),
            clientId: (await db.insert(clients).values({ fullName: "Held Invented", phone: "+639175550000" }).returning())[0].id,
          },
        }),
      );
      const [q] = await db.select().from(quotations).where(eq(quotations.id, draft.id));
      const issued = ok(await issueQuotation(sales, { id: draft.id, form: quoteFormSchema.parse(q.inputs), overrideReason: "" }));
      const b = ok(await convertToBooking(sales, { quotationId: issued.id }));
      ok(await addPayment(sales, { bookingId: b.id, type: "reservation_fee", amountCentavos: 50_000, method: "cash", collectedByUserId: sales.id, paidDate: "2026-12-01", paidTime: "08:00" }));
      // Pending reservation does not hold: still listed.
      expect(await ids(SD)).toContain(sedan.id);
      ok(await confirmBooking(sales, { id: b.id }));
      expect(await ids(SD)).not.toContain(sedan.id); // 10:00 < 10:30
      expect(await ids({ ...SD, startTime: "10:30" })).toContain(sedan.id); // exactly at the held end
      // A block (no buffer) on the van.
      const [blk] = await db.insert(vehicleBlocks).values({ vehicleId: van.id, kind: "maintenance", startAt: new Date("2026-12-21T00:00:00Z"), endAt: new Date("2026-12-21T06:00:00Z"), reason: "PMS" }).returning();
      await setHold(db, { blockId: blk.id }, { vehicleId: van.id, startAt: blk.startAt, endAt: blk.endAt, bufferMinutes: 0 });
      expect(await ids(SD)).toEqual([sedan2.id]);
      // A submission for the held car is refused (409) and creates nothing.
      const r = await submit();
      expect(r.status).toBe(409);
      expect(await db.select().from(inquiries)).toHaveLength(0);
    });

    it("refuses windows the public may not ask for", async () => {
      const soon = await publicQuote({ search: { ...SD, startDate: "2026-12-01", startTime: "09:00" } }, NOW);
      expect(soon.status).toBe(400);
      const backwards = await publicQuote({ search: { ...SD, endDate: "2026-12-19" } }, NOW);
      expect(backwards.status).toBe(400);
      expect(backwards.body.ok ? null : backwards.body.fieldErrors).toHaveProperty("endTime");
    });
  });

  describe("prices equal the engine output", () => {
    it.each([
      ["Self-Drive cash", { ...SD }],
      ["Self-Drive card", { ...SD, paymentMethod: "card" }],
      ["With Driver", { ...WD }],
    ])("%s", async (_name, search) => {
      const r = await publicQuote({ search, vehicleId: sedan.id }, NOW);
      if (!r.body.ok) throw new Error(r.body.error);
      const s = await getSettings();
      const priced = priceQuote(publicQuoteForm(searchSchema.parse(search), { id: sedan.id, bodyType: "sedan", category: "primo" }, s.fuel_prices_centavos, "public_price"), {
        card: EXPECTED_RATE_CARD_V1,
        holidays: [],
        client: null,
        vehicle: { bodyType: "sedan", fuelType: "gasoline" },
      });
      expect(r.body.detail!.total).toBe(publicTotal(priced.result));
      expect(r.body.vehicles[0].total).toBe(publicTotal(priced.result));
      expect(r.body.detail!.lines.map((l) => l.amount)).toEqual(priced.result.lines.map((l) => l.amount));
    });
  });

  describe("submission", () => {
    it("creates the inquiry, a website client, a priced draft quotation and a Rework outbox row; holds nothing", async () => {
      const r = await submit();
      expect(r.status).toBe(201);
      if (!r.body.ok) throw new Error(r.body.error);
      expect(r.body.reference).toBe("REQ-2026-0001");

      const [inq] = await db.select().from(inquiries);
      expect(inq).toMatchObject({ reference: "REQ-2026-0001", status: "new", service: "self_drive", vehicleId: sedan.id });
      expect(inq.utm).toEqual({ utm_source: "facebook", utm_campaign: "dec", fbclid: "IwAR-invented" });
      expect(inq.meta).toEqual({ ip: "203.0.113.10", userAgent: "Vitest Invented UA" });

      const [c] = await db.select().from(clients).where(eq(clients.id, inq.clientId!));
      expect(c).toMatchObject({ fullName: "Nina Invented", phone: "+639175550101", email: "nina.invented@example.test", source: "website", birthday: "1995-05-05" });
      expect(c.reworkSentAt).toBeInstanceOf(Date);

      const [q] = await db.select().from(quotations).where(eq(quotations.id, inq.quotationId!));
      expect(q).toMatchObject({ kind: "formal", status: "draft", clientId: c.id, vehicleId: sedan.id, consultantId: null, number: null });
      expect(q.result).not.toBeNull();
      // New client: the draft has the 5% discount; the page showed the price without it.
      expect(q.totalCentavos).toBeLessThan(inq.shownTotalCentavos!);
      expect(q.notes).toContain("Delivery address (fee to be confirmed): Door 9, Invented Ave, Davao City");

      const rows = await db.select().from(outbox);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "rework_lead", status: "pending", entity: "inquiry", entityId: inq.id });
      const lead = (rows[0].payload as { lead: Record<string, unknown> }).lead;
      expect(lead).toMatchObject({
        name: "Nina Invented",
        phone: "+639175550101",
        email: "nina.invented@example.test",
        labels: ["Self-Drive"],
        custom_services: "Self-Drive",
        custom_car_type: "Sedan",
        custom_start_time: Date.parse("2026-12-20T02:00:00Z") / 1000,
        custom_expected_return_date_time: Date.parse("2026-12-22T02:00:00Z") / 1000,
        custom_delivery_address: "Door 9, Invented Ave, Davao City",
        custom_government_id: "Passport",
        custom_mode_of_payment: "Cash",
        custom_deal_sources: "Website Booking Page",
        utm_source: "facebook",
        fbclid: "IwAR-invented",
        geo_ip: "203.0.113.10",
        user_agent: "Vitest Invented UA",
      });
      expect(String(lead.custom_form_submission_link)).toMatch(new RegExp(`/inquiries/${inq.id}$`));

      expect(await db.select().from(vehicleHolds)).toHaveLength(0);
      expect(await db.select().from(auditLog).where(eq(auditLog.action, "inquiry.created"))).toHaveLength(1);
    });

    it("links an existing client only on an exact phone match", async () => {
      const [existing] = await db.insert(clients).values({ fullName: "Nina I. Record", phone: "+639175550101", firstRentalAt: new Date("2025-01-01") }).returning();
      ok((await submit()).body as R<unknown>);
      const [inq] = await db.select().from(inquiries);
      expect(inq.clientId).toBe(existing.id);
      expect(inq.notes).toContain("differs from the client record");
      expect(await db.select().from(clients)).toHaveLength(1);
      // Repeat client: the draft has no new-client discount.
      const [q] = await db.select().from(quotations);
      expect(q.totalCentavos).toBe(inq.shownTotalCentavos);
    });

    it("a new client whose email is taken is saved without it, with a note", async () => {
      await db.insert(clients).values({ fullName: "Other Invented", email: "nina.invented@example.test" });
      await submit();
      const [inq] = await db.select().from(inquiries);
      const [c] = await db.select().from(clients).where(eq(clients.id, inq.clientId!));
      expect(c.email).toBeNull();
      expect(inq.notes).toContain("already used by client Other Invented");
    });

    it("With Driver request", async () => {
      const r = await submit({ search: WD, vehicleId: van.id, details: { fullName: "Wes Invented", phone: "09175550202", pickupAddress: "Invented Home", dropoffAddress: "Invented Resort", passengers: 8, luggage: "4 bags", itinerary: "Loop" } });
      expect(r.status).toBe(201);
      const [row] = await db.select().from(outbox);
      expect((row.payload as { lead: Record<string, unknown> }).lead).toMatchObject({
        custom_services: "With Driver",
        custom_car_type: "Van",
        custom_pick_up_address: "Invented Home",
        custom_drop_off_address: "Invented Resort",
        custom_number_of_passengers: 8,
        custom_do_you_need_the_driver_to_waitstandby: "No",
        custom_destination: "Tagum City",
      });
    });

    it("honeypot, invalid input and missing consent create nothing", async () => {
      expect((await submit({ website: "http://spam.example" })).status).toBe(400);
      expect((await submit({ consent: false as unknown as true })).status).toBe(400);
      expect((await submit({ details: { fullName: "x", phone: "123" } })).status).toBe(400);
      expect(await db.select().from(inquiries)).toHaveLength(0);
      expect(await db.select().from(outbox)).toHaveLength(0);
    });

    it("rate limit: 5 submissions per IP per hour", async () => {
      for (let i = 0; i < 5; i++) {
        const r = await submit({ details: { fullName: `Rate Invented ${i}`, phone: `0917555030${i}` } }, "198.51.100.1");
        expect(r.status).toBe(201);
      }
      const sixth = await submit({ details: { fullName: "Rate Invented 6", phone: "09175550399" } }, "198.51.100.1");
      expect(sixth.status).toBe(429);
      // Another IP is not affected; raw IPs are never stored.
      expect((await submit({}, "198.51.100.2")).status).toBe(201);
      const keys = (await db.select().from(publicRateEvents)).map((e) => e.key);
      expect(keys.every((k) => k.startsWith("inquiry:") && !k.includes("198.51"))).toBe(true);
    });

    it("Turnstile is verified on the server", async () => {
      vi.stubEnv("TURNSTILE_SECRET_KEY", "invented-secret");
      const calls: string[] = [];
      vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        calls.push(String(init.body));
        return new Response(JSON.stringify({ success: String(init.body).includes("response=good") }));
      });
      expect((await submit({ turnstileToken: "" })).status).toBe(400);
      expect((await submit({ turnstileToken: "bad" })).status).toBe(400);
      expect((await submit({ turnstileToken: "good" })).status).toBe(201);
      expect(calls.at(-1)).toContain("remoteip=203.0.113.10");
      expect(await db.select().from(inquiries)).toHaveLength(1);
    });

    it("production without a Turnstile secret refuses (503)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("TURNSTILE_SECRET_KEY", "");
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await submit()).status).toBe(503);
    });
  });

  describe("staff inbox", () => {
    async function submitted() {
      await submit();
      const [inq] = await db.select().from(inquiries);
      const [q] = await db.select().from(quotations).where(eq(quotations.id, inq.quotationId!));
      return { inq, q };
    }

    it("issue → quoted (consultant set), convert → converted with the request's details", async () => {
      const { inq, q } = await submitted();
      const issued = ok(await issueQuotation(sales, { id: q.id, form: quoteFormSchema.parse(q.inputs), overrideReason: "" }));
      expect(issued.number).toMatch(/^QTN-2026-\d{3}$/);
      const [afterIssue] = await db.select().from(inquiries).where(eq(inquiries.id, inq.id));
      expect(afterIssue).toMatchObject({ status: "quoted", reviewedBy: sales.id });
      expect((await db.select().from(quotations).where(eq(quotations.id, q.id)))[0].consultantId).toBe(sales.id);
      // A website client is not sent again on issue.
      expect(await db.select().from(outbox)).toHaveLength(1);

      const b = ok(await convertToBooking(sales, { quotationId: q.id }));
      const [booking] = await db.select().from(bookings).where(eq(bookings.id, b.id));
      expect(booking).toMatchObject({ deliveryAddress: "Door 9, Invented Ave, Davao City", idsPresented: ["Passport"], sourceChannel: "website" });
      expect((await db.select().from(inquiries).where(eq(inquiries.id, inq.id)))[0].status).toBe("converted");
    });

    it("reject with a reason cancels the draft; Operations cannot", async () => {
      const { inq, q } = await submitted();
      expect(await rejectInquiry(ops, { id: inq.id, reason: "x" })).toMatchObject({ ok: false, status: 403 });
      expect(await rejectInquiry(sales, { id: inq.id, reason: "" })).toMatchObject({ ok: false, status: 400 });
      ok(await rejectInquiry(sales, { id: inq.id, reason: "Duplicate request" }));
      const [after] = await db.select().from(inquiries).where(eq(inquiries.id, inq.id));
      expect(after).toMatchObject({ status: "rejected", rejectReason: "Duplicate request" });
      expect((await db.select().from(quotations).where(eq(quotations.id, q.id)))[0]).toMatchObject({ status: "cancelled", statusNote: "Request REQ-2026-0001 rejected: Duplicate request" });
      expect(await rejectInquiry(sales, { id: inq.id, reason: "again" })).toMatchObject({ ok: false, status: 409 });
    });
  });

  describe("Rework triggers (rework.md §2)", () => {
    async function staffIssue(clientId: string) {
      const s = await getSettings();
      const f: QuoteFormInput = {
        ...publicQuoteForm(searchSchema.parse(SD), { id: sedan2.id, bodyType: "sedan", category: "premium" }, s.fuel_prices_centavos, "draft"),
        clientId,
      };
      const { id } = ok(await saveDraft(sales, { form: f }));
      return ok(await issueQuotation(sales, { id, form: f, overrideReason: "" }));
    }

    it("issuing for a client added in the quotation form sends once; setting off sends none", async () => {
      const { id: clientId } = ok(await createClientFromQuote(sales, { fullName: "Quinn Invented", phone: "09175550404" }));
      const q1 = await staffIssue(clientId);
      let rows = await db.select().from(outbox).where(eq(outbox.kind, "rework_lead"));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ entity: "quotation", entityId: q1.id });
      expect((rows[0].payload as { lead: { labels: string[] } }).lead.labels).toEqual(["Self-Drive", q1.number]);
      await staffIssue(clientId);
      rows = await db.select().from(outbox);
      expect(rows).toHaveLength(1);

      ok(await updateReworkSettings(sa, { rework_send_staff_intakes: false, rework_option_map: (await getSettings()).rework_option_map, rework_date_unit: "seconds" }));
      const { id: other } = ok(await createClientFromQuote(sales, { fullName: "Rita Invented", phone: "09175550505" }));
      await staffIssue(other);
      expect(await db.select().from(outbox)).toHaveLength(1);
      // Clients added on the Clients page are not staff intakes.
      const [manual] = await db.insert(clients).values({ fullName: "Manual Invented", source: "manual" }).returning();
      ok(await updateReworkSettings(sa, { rework_send_staff_intakes: true, rework_option_map: (await getSettings()).rework_option_map, rework_date_unit: "seconds" }));
      await staffIssue(manual.id);
      expect(await db.select().from(outbox)).toHaveLength(1);
    });

    it("manual Send to Rework: Sales+, once unless again", async () => {
      const [c] = await db.insert(clients).values({ fullName: "Sam Invented", phone: "+639175550606" }).returning();
      expect(await sendClientToRework(ops, { id: c.id })).toMatchObject({ ok: false, status: 403 });
      ok(await sendClientToRework(sales, { id: c.id }));
      expect(await sendClientToRework(sales, { id: c.id })).toMatchObject({ ok: false, status: 409 });
      ok(await sendClientToRework(sales, { id: c.id, again: true }));
      expect(await db.select().from(outbox).where(and(eq(outbox.entity, "client"), eq(outbox.entityId, c.id)))).toHaveLength(2);
    });

    it("test lead and settings: Super Admin only; date unit applies", async () => {
      expect(await sendTestLead(admin, {})).toMatchObject({ ok: false, status: 403 });
      expect(await updateReworkSettings(admin, { rework_send_staff_intakes: true, rework_option_map: {}, rework_date_unit: "milliseconds" })).toMatchObject({ ok: false, status: 403 });
      ok(await updateReworkSettings(sa, { rework_send_staff_intakes: true, rework_option_map: (await getSettings()).rework_option_map, rework_date_unit: "milliseconds" }));
      ok(await sendTestLead(sa, {}));
      const [row] = await db.select().from(outbox);
      const lead = (row.payload as { lead: Record<string, unknown> }).lead;
      expect(lead.labels).toEqual(["Self-Drive", "Test"]);
      expect(String(lead.custom_start_time)).toHaveLength(13); // milliseconds
    });
  });

  describe("worker delivery", () => {
    const TOKEN = "tok_Invented_Integration_9f8e7d";
    const ENV = { REWORK_WEBHOOK_URL: "https://webhooks.rework.test/leads/source/leadgen", REWORK_WEBHOOK_TOKEN: TOKEN };

    it("sends the stored lead, stores status + body; the token is never stored or logged", async () => {
      await submit();
      const logged: string[] = [];
      for (const m of ["log", "error", "warn", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
      const posted: { url: string; body: unknown }[] = [];
      const fetchImpl = (async (url: URL, init: RequestInit) => {
        posted.push({ url: url.toString(), body: JSON.parse(String(init.body)) });
        return new Response('{"status":"ok","id":"lead-1"}', { status: 200 });
      }) as unknown as typeof fetch;
      expect(await processOutbox(db, { rework_lead: reworkHandler(reworkTransport(ENV, fetchImpl)) })).toEqual({ sent: 1, retrying: 0, failed: 0 });
      expect(new URL(posted[0].url).searchParams.get("token")).toBe(TOKEN);
      expect(posted[0].body).toMatchObject({ name: "Nina Invented", custom_deal_sources: "Website Booking Page" });
      const [row] = await db.select().from(outbox);
      expect(row).toMatchObject({ status: "sent", attempts: 1, response: { status: 200, body: '{"status":"ok","id":"lead-1"}' } });

      // A failing send keeps a redacted error.
      await submit({ details: { fullName: "Fail Invented", phone: "09175550707" } }, "203.0.113.11");
      const failing = (async (url: URL) => new Response(`invalid token at ${url.toString()} (${TOKEN})`, { status: 403 })) as unknown as typeof fetch;
      expect(await processOutbox(db, { rework_lead: reworkHandler(reworkTransport(ENV, failing)) })).toEqual({ sent: 0, retrying: 1, failed: 0 });
      const all = await db.select().from(outbox);
      const failed = all.find((r) => r.status === "pending")!;
      expect(failed.lastError).toMatch(/^Rework 403: invalid token at https:\/\/webhooks\.rework\.test\/leads\/source\/leadgen\?token=\[redacted\] \(\*\*\*\)$/);
      expect(JSON.stringify(all)).not.toContain(TOKEN);
      expect(JSON.stringify(await db.select().from(auditLog))).not.toContain(TOKEN);
      expect(logged.join("\n")).not.toContain(TOKEN);
    });
  });
});

import { hasTestDb } from "./env";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { auditLog, bookingCharges, bookings, clients, loyaltyAccounts, movementEvents, numberSequences, outbox, pointsLedger, quotations, rateCards, vehicleHolds, vehicles } from "@/db/schema";
import { addPayment, cancelBooking, confirmBooking, convertToBooking, markNoShow } from "@/lib/bookings/service";
import { recordRelease, recordReturn, undoReturn } from "@/lib/check-in/service";
import { emailHandler } from "@/lib/email/outbox-handler";
import type { EmailMessage, EmailTransport } from "@/lib/email/types";
import { commitImport, previewUpload } from "@/lib/import/service";
import { expireLoyalty, expireQuotations } from "@/lib/jobs/nightly";
import { balanceOf, earnForReturn } from "@/lib/loyalty/ledger";
import { accountForClient, adjustPoints, linkClient, listAccounts, setTier } from "@/lib/loyalty/service";
import { OUTBOX_MAX_ATTEMPTS } from "@/lib/outbox/backoff";
import { processOutbox } from "@/lib/outbox/dispatch";
import { enqueueOutbox } from "@/lib/outbox/enqueue";
import { EXPECTED_RATE_CARD_V1 } from "@/lib/pricing";
import { sendQuotationEmail } from "@/lib/quotes/email";
import { SD2_FORM } from "@/lib/quotes/fixtures";
import type { QuoteFormInput } from "@/lib/quotes/schema";
import { issueQuotation, previewPrice, saveDraft, saveQuick } from "@/lib/quotes/service";
import { ensureDefaultSettings } from "@/lib/settings/service";
import { manilaToUtc } from "@/lib/time";
import { bookingWorkbook } from "../fixtures/workbooks";
import { makeUser, truncateAll } from "./helpers";
import { startWorker } from "@/worker/app";
import { TEST_DB_URL } from "./env";

type Actor = Awaited<ReturnType<typeof makeUser>>;
type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.status} ${r.error}`);
  return r.data;
}
function fail<T>(r: Result<T>) {
  if (r.ok) throw new Error("expected failure");
  return r;
}

let sales: Actor;
let admin: Actor;
let sa: Actor;
let ops: Actor;
let car: { id: string };
let car2: { id: string };
let client: { id: string };

// Invented data. A 3-day Sedan rental in the past (check-ins cannot be in the future).
const START = { date: "2026-11-10", time: "09:00" };
const END = { date: "2026-11-13", time: "09:00" };

async function seed() {
  await ensureDefaultSettings();
  await db.insert(rateCards).values({ version: 1, name: "v1", status: "active", data: EXPECTED_RATE_CARD_V1, source: "test" });
  await db.insert(numberSequences).values([{ key: "QTN-2026", lastValue: 928 }]);
  [car, car2] = await db
    .insert(vehicles)
    .values([
      { displayName: "Vios Silver AT TST 5151", plate: "TST 5151", bodyType: "sedan", fuelType: "gasoline", tankCapacityL: 42 },
      { displayName: "City Grey AT TST 5252", plate: "TST 5252", bodyType: "sedan", fuelType: "gasoline", tankCapacityL: 40 },
    ])
    .returning();
  [client] = await db.insert(clients).values({ fullName: "Lara Loyal", fbName: "Lara L", email: "lara@example.test" }).returning();
  sales = await makeUser("sales");
  admin = await makeUser("admin");
  sa = await makeUser("super_admin");
  ops = await makeUser("operations");
}

function form(over: Partial<QuoteFormInput> = {}): QuoteFormInput {
  return {
    ...SD2_FORM,
    bodyType: "sedan",
    category: "primo",
    deliveryFee: 0,
    clientId: client.id,
    vehicleId: car.id,
    startDate: START.date,
    startTime: START.time,
    endDate: END.date,
    endTime: END.time,
    ...over,
  };
}

async function issue(over: Partial<QuoteFormInput> = {}, actor: Actor = sales) {
  const f = form(over);
  const { id } = ok(await saveDraft(actor, { form: f }));
  return { id, result: await issueQuotation(actor, { id, form: f, overrideReason: "" }) };
}

async function booked(over: Partial<QuoteFormInput> = {}) {
  const { result } = await issue(over);
  const q = ok(result);
  const b = ok(await convertToBooking(sales, { quotationId: q.id }));
  ok(await addPayment(sales, { bookingId: b.id, type: "reservation_fee", amountCentavos: 50_000, method: "gcash", collectedByUserId: sales.id, paidDate: "2026-11-05", paidTime: "10:00" }));
  return { quotationId: q.id, bookingId: b.id, number: b.number };
}

async function returned(over: Partial<QuoteFormInput> = {}) {
  const b = await booked(over);
  ok(await confirmBooking(sales, { id: b.bookingId }));
  const f = form(over);
  ok(await recordRelease(ops, { bookingId: b.bookingId, actualDate: f.startDate, actualTime: "09:00", odometerKm: 1000, fuelLevelEighths: 8 }));
  const r = ok(await recordReturn(ops, { bookingId: b.bookingId, actualDate: f.endDate, actualTime: "09:00", odometerKm: 1200, fuelLevelEighths: 8 }));
  return { ...b, ret: r };
}

async function account() {
  const [a] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.clientId, client.id));
  return a;
}

/** Give the client a card with `points` (an Admin adjustment on a returned 3-day booking's card). */
async function cardWith(points: number) {
  await returned({ vehicleId: car2.id, startDate: "2026-10-01", endDate: "2026-10-04" });
  const a = await account();
  const diff = points - (await balanceOf(db, a.id));
  if (diff) ok(await adjustPoints(admin, { accountId: a.id, points: diff, reason: "test setup" }));
  return a;
}

async function bookingPointsSum(bookingId: string) {
  const rows = await db.select().from(pointsLedger).where(eq(pointsLedger.bookingId, bookingId));
  return rows.reduce((s, r) => s + r.points, 0);
}

describe.skipIf(!hasTestDb)("Phase 3 rewards, outbox, worker jobs", () => {
  beforeEach(async () => {
    await truncateAll();
    await seed();
  });
  afterAll(closeDb);

  describe("earning", () => {
    it("a 3-day returned booking adds 150 points (₱3) and creates card JMV-0001 for one year", async () => {
      const b = await returned();
      expect(b.ret.pointsEarned).toBe(150);
      expect(b.ret.cardNo).toBe("JMV-0001");
      const a = await account();
      expect(a).toMatchObject({ cardNo: "JMV-0001", memberSince: END.date, expiresAt: "2027-11-13", status: "active" });
      expect(await balanceOf(db, a.id)).toBe(150);
      const detail = (await accountForClient(client.id))!;
      expect(detail.balance).toBe(150);
      expect(detail.history[0]).toMatchObject({ kind: "earn", points: 150, bookingNumber: b.number });
      const audit = await db.select().from(auditLog).where(and(eq(auditLog.entityId, a.id), eq(auditLog.action, "loyalty.earn")));
      expect(audit).toHaveLength(1);
    });

    it("continues JMV numbering from the sequence (after an import set it to 24)", async () => {
      await db.insert(numberSequences).values({ key: "JMV", lastValue: 24 });
      const b = await returned();
      expect(b.ret.cardNo).toBe("JMV-0025");
    });

    it("is idempotent per booking", async () => {
      const b = await returned();
      const [row] = await db.select().from(bookings).where(eq(bookings.id, b.bookingId));
      const again = await db.transaction((tx) => earnForReturn(tx, admin, row, 3, manilaToUtc(END.date, "09:00")));
      expect(again.points).toBe(0);
      expect(await bookingPointsSum(b.bookingId)).toBe(150);
    });

    it("renews an expired card for one year on the next return (PLAN Q12), keeping its points", async () => {
      await returned({ vehicleId: car2.id, startDate: "2026-10-01", endDate: "2026-10-04" });
      const a = await account();
      await db.update(loyaltyAccounts).set({ expiresAt: "2026-10-31", status: "expired" }).where(eq(loyaltyAccounts.id, a.id));
      await returned();
      expect(await account()).toMatchObject({ status: "active", expiresAt: "2027-11-13", memberSince: "2026-10-04" });
      expect(await balanceOf(db, a.id)).toBe(300);
    });

    it("a booking without a client earns nothing and warns", async () => {
      const b = await booked();
      await db.update(bookings).set({ clientId: null }).where(eq(bookings.id, b.bookingId));
      ok(await confirmBooking(sales, { id: b.bookingId }));
      ok(await recordRelease(ops, { bookingId: b.bookingId, actualDate: START.date, actualTime: "09:00", odometerKm: 1000, fuelLevelEighths: 8 }));
      const r = ok(await recordReturn(ops, { bookingId: b.bookingId, actualDate: END.date, actualTime: "09:00", odometerKm: 1100, fuelLevelEighths: 8 }));
      expect(r.pointsEarned).toBe(0);
      expect(r.warnings).toContain("No points earned: the booking has no client.");
    });
  });

  describe("undo return (Admin+)", () => {
    it("reverses the points, removes the return check-in and its charges, restores the hold; returning again earns again", async () => {
      const b = await booked();
      ok(await confirmBooking(sales, { id: b.bookingId }));
      ok(await recordRelease(ops, { bookingId: b.bookingId, actualDate: START.date, actualTime: "09:00", odometerKm: 1000, fuelLevelEighths: 8 }));
      // 2 h late, 2/8 short: check-in charges.
      ok(await recordReturn(ops, { bookingId: b.bookingId, actualDate: END.date, actualTime: "11:00", odometerKm: 1200, fuelLevelEighths: 6 }));
      expect((await db.select().from(bookingCharges).where(and(eq(bookingCharges.bookingId, b.bookingId), eq(bookingCharges.source, "check_in")))).length).toBeGreaterThan(0);

      expect(fail(await undoReturn(sales, { bookingId: b.bookingId, reason: "wrong car" })).status).toBe(403);
      expect(fail(await undoReturn(admin, { bookingId: b.bookingId, reason: " " })).status).toBe(400);
      const u = ok(await undoReturn(admin, { bookingId: b.bookingId, reason: "Recorded on the wrong booking" }));
      expect(u).toMatchObject({ status: "released", pointsReversed: 150 });
      expect(u.chargesRemoved).toBeGreaterThan(0);

      const [row] = await db.select().from(bookings).where(eq(bookings.id, b.bookingId));
      expect(row.status).toBe("released");
      expect(await db.select().from(movementEvents).where(and(eq(movementEvents.bookingId, b.bookingId), eq(movementEvents.kind, "return")))).toHaveLength(0);
      expect(await db.select().from(bookingCharges).where(and(eq(bookingCharges.bookingId, b.bookingId), eq(bookingCharges.source, "check_in")))).toHaveLength(0);
      expect(await bookingPointsSum(b.bookingId)).toBe(0);
      const [hold] = await db.select().from(vehicleHolds).where(eq(vehicleHolds.bookingId, b.bookingId));
      expect(hold.active).toBe(true);

      // A second undo is refused; returning again earns again (net 150, not 300).
      expect(fail(await undoReturn(admin, { bookingId: b.bookingId, reason: "again" })).status).toBe(409);
      ok(await recordReturn(ops, { bookingId: b.bookingId, actualDate: END.date, actualTime: "09:00", odometerKm: 1200, fuelLevelEighths: 8 }));
      expect(await bookingPointsSum(b.bookingId)).toBe(150);
      const kinds = (await db.select().from(pointsLedger).where(eq(pointsLedger.bookingId, b.bookingId))).map((r) => r.kind).sort();
      expect(kinds).toEqual(["earn", "earn", "reversal"]);
    });
  });

  describe("redemption", () => {
    it("1 free Sedan hour for 15,000 points: ₱0 line on the quotation, deducted on confirm, refunded on cancel", async () => {
      const a = await cardWith(20_000);
      const preview = ok(await previewPrice(sales, form({ rewardsMode: "free_hours", rewardsHours: 1 })));
      expect(preview.loyalty).toMatchObject({ cardNo: a.cardNo, balance: 20_000, expired: false });
      expect(preview.rewardsProblem).toBeNull();

      const b = await booked({ rewardsMode: "free_hours", rewardsHours: 1 });
      const [q] = await db.select().from(quotations).where(eq(quotations.id, b.quotationId));
      const result = q.result as { lines: { code: string; label: string; amount: number }[]; rewards: unknown };
      expect(result.lines.find((l) => l.code === "rewards_free_hours")).toMatchObject({ label: "Free hours (rewards)", amount: 0 });
      expect(result.rewards).toMatchObject({ mode: "free_hours", points: 15_000, hours: 1 });
      expect(await balanceOf(db, a.id)).toBe(20_000); // nothing deducted at issue

      const c = ok(await confirmBooking(sales, { id: b.bookingId }));
      expect(c.pointsRedeemed).toBe(15_000);
      expect(await balanceOf(db, a.id)).toBe(5_000);
      // Confirm is not repeated, so no double deduction is possible; cancel refunds.
      const x = ok(await cancelBooking(sales, { id: b.bookingId, reason: "Client changed plans" }));
      expect(x.pointsRefunded).toBe(15_000);
      expect(await balanceOf(db, a.id)).toBe(20_000);
      const kinds = (await db.select().from(pointsLedger).where(eq(pointsLedger.bookingId, b.bookingId))).map((r) => [r.kind, r.points]);
      expect(kinds).toEqual([
        ["redeem", -15_000],
        ["refund", 15_000],
      ]);
    });

    it("peso discount: a negative 'Rewards redemption' line and booking charge", async () => {
      const a = await cardWith(5_000);
      const b = await booked({ rewardsMode: "discount", rewardsPoints: 2_500 });
      const charges = await db.select().from(bookingCharges).where(eq(bookingCharges.bookingId, b.bookingId));
      expect(charges.find((ch) => ch.code === "rewards_discount")?.amountCentavos).toBe(-5_000);
      ok(await confirmBooking(sales, { id: b.bookingId }));
      expect(await balanceOf(db, a.id)).toBe(2_500);
    });

    it("cannot redeem more than the balance (issue 409; confirm 409 if the balance dropped meanwhile)", async () => {
      const a = await cardWith(10_000);
      const tooMuch = await issue({ rewardsMode: "free_hours", rewardsHours: 1 });
      expect(fail(tooMuch.result)).toMatchObject({ status: 409 });
      expect(fail(tooMuch.result).error).toContain("Not enough points");

      ok(await adjustPoints(admin, { accountId: a.id, points: 10_000, reason: "promo" }));
      const b = await booked({ rewardsMode: "free_hours", rewardsHours: 1 });
      ok(await adjustPoints(admin, { accountId: a.id, points: -10_000, reason: "correction" }));
      const c = fail(await confirmBooking(sales, { id: b.bookingId }));
      expect(c.status).toBe(409);
      expect(c.error).toContain("Not enough points");
      const [row] = await db.select().from(bookings).where(eq(bookings.id, b.bookingId));
      expect(row.status).toBe("pending_reservation"); // rolled back with the confirm
    });

    it("is blocked when the card is expired, or the client has none", async () => {
      const none = await issue({ rewardsMode: "discount", rewardsPoints: 100 });
      expect(fail(none.result).error).toContain("no loyalty card");
      const a = await cardWith(20_000);
      await db.update(loyaltyAccounts).set({ expiresAt: "2026-11-01", status: "expired" }).where(eq(loyaltyAccounts.id, a.id));
      const exp = await issue({ rewardsMode: "discount", rewardsPoints: 100 });
      expect(fail(exp.result).error).toContain("expired");
    });

    it("no-show keeps the redeemed points; quick quotations never redeem", async () => {
      const a = await cardWith(20_000);
      const b = await booked({ rewardsMode: "free_hours", rewardsHours: 1 });
      ok(await confirmBooking(sales, { id: b.bookingId }));
      ok(await markNoShow(sales, { id: b.bookingId, reason: "" }));
      expect(await balanceOf(db, a.id)).toBe(5_000);

      const quick = ok(await saveQuick(sales, { id: null, form: form({ rewardsMode: "free_hours", rewardsHours: 1 }) }));
      const [q] = await db.select().from(quotations).where(eq(quotations.id, quick.id));
      expect((q.result as { rewards: unknown }).rewards).toBeNull();
    });
  });

  describe("rewards admin", () => {
    it("adjustment: Admin+ with a reason, never below 0; tier: Super Admin; Operations and Sales refused", async () => {
      const a = await cardWith(150);
      expect(fail(await adjustPoints(sales, { accountId: a.id, points: 10, reason: "x" })).status).toBe(403);
      expect(fail(await adjustPoints(ops, { accountId: a.id, points: 10, reason: "x" })).status).toBe(403);
      expect(fail(await adjustPoints(admin, { accountId: a.id, points: 10, reason: "" })).status).toBe(400);
      expect(fail(await adjustPoints(admin, { accountId: a.id, points: -151, reason: "too much" })).status).toBe(409);
      ok(await adjustPoints(admin, { accountId: a.id, points: -150, reason: "Goodwill reversal" }));
      expect(await balanceOf(db, a.id)).toBe(0);

      expect(fail(await setTier(admin, { accountId: a.id, tier: 2 })).status).toBe(403);
      ok(await setTier(sa, { accountId: a.id, tier: 2 }));
      expect((await account()).tier).toBe(2);
    });

    it("links an unmatched card to a client (once; one card per client)", async () => {
      const [orphan] = await db.insert(loyaltyAccounts).values({ cardNo: "JMV-0009", memberSince: "2026-01-01", expiresAt: "2027-01-01", importedName: "Lara L.", imported: true }).returning();
      const list = await listAccounts({ q: "", filter: "unlinked", page: 1 });
      expect(list.items.map((i) => i.cardNo)).toEqual(["JMV-0009"]);
      ok(await linkClient(admin, { accountId: orphan.id, clientId: client.id }));
      expect(fail(await linkClient(admin, { accountId: orphan.id, clientId: client.id })).status).toBe(409);
      const [other] = await db.insert(loyaltyAccounts).values({ cardNo: "JMV-0010", memberSince: "2026-01-01", expiresAt: "2027-01-01" }).returning();
      expect(fail(await linkClient(admin, { accountId: other.id, clientId: client.id })).error).toContain("already has card JMV-0009");
    });
  });

  describe("nightly jobs", () => {
    it("marks issued quotations past validity expired, and expired loyalty cards", async () => {
      const q = ok((await issue()).result);
      const later = new Date(Date.now() + 48 * 3_600_000);
      expect(await expireQuotations(db, new Date())).toBe(0);
      expect(await expireQuotations(db, later)).toBe(1);
      const [row] = await db.select().from(quotations).where(eq(quotations.id, q.id));
      expect(row.status).toBe("expired");

      await cardWith(100);
      expect(await expireLoyalty(db, manilaToUtc("2027-10-04"))).toBe(0); // last valid day of the card from 2026-10-04
      expect(await expireLoyalty(db, manilaToUtc("2027-10-05"))).toBe(1);
      expect((await account()).status).toBe("expired");
      expect(await balanceOf(db, (await account()).id)).toBe(100); // points kept (Q12)
    });
  });

  describe("email by outbox", () => {
    const failing: EmailTransport = {
      name: "fake-failing",
      async send() {
        throw new Error("SMTP 550 mailbox unavailable");
      },
    };

    it("Send by email only writes an outbox row (no external call), Sales+ only", async () => {
      const q = ok((await issue()).result);
      expect(fail(await sendQuotationEmail(ops, { id: q.id, to: "lara@example.test" })).status).toBe(403);
      expect(fail(await sendQuotationEmail(sales, { id: q.id, to: "not-an-email" })).status).toBe(400);
      const r = ok(await sendQuotationEmail(sales, { id: q.id, to: "Lara@Example.test", message: "Here you go" }));
      const [row] = await db.select().from(outbox).where(eq(outbox.id, r.outboxId));
      expect(row).toMatchObject({ kind: "email", status: "pending", attempts: 0, entity: "quotation", entityId: q.id });
      const p = row.payload as { to: string[]; subject: string; text: string; attachments: { kind: string; quotationId: string; filename: string }[] };
      expect(p.to).toEqual(["lara@example.test"]);
      expect(p.subject).toContain(q.number);
      expect(p.text).toContain("Here you go");
      expect(p.attachments).toEqual([{ kind: "quotation_pdf", quotationId: q.id, filename: `${q.number}_Lara-Loyal.pdf` }]);
    });

    it("sends with the PDF attached and records the response", async () => {
      const q = ok((await issue()).result);
      const { outboxId } = ok(await sendQuotationEmail(sales, { id: q.id, to: "lara@example.test" }));
      const sent: EmailMessage[] = [];
      const transport: EmailTransport = {
        name: "fake",
        async send(m, key) {
          sent.push(m);
          return { provider: "fake", id: `msg-${key.slice(0, 8)}` };
        },
      };
      const pdf = Buffer.from("%PDF-1.7 fake");
      const handler = emailHandler({ transport, from: "J-MaVe Cars <quotes@example.test>", resolveAttachment: async () => pdf });
      expect(await processOutbox(db, { email: handler })).toEqual({ sent: 1, retrying: 0, failed: 0 });
      expect(sent[0]).toMatchObject({ from: "J-MaVe Cars <quotes@example.test>", to: ["lara@example.test"] });
      expect(sent[0].attachments[0]).toMatchObject({ filename: `${q.number}_Lara-Loyal.pdf`, contentType: "application/pdf", content: pdf });
      const [row] = await db.select().from(outbox).where(eq(outbox.id, outboxId));
      expect(row).toMatchObject({ status: "sent", attempts: 1, lastError: null, response: { provider: "fake", id: `msg-${outboxId.slice(0, 8)}` } });
      expect(row.sentAt).toBeInstanceOf(Date);
    });

    it("a failing transport retries with backoff and ends failed after 8 attempts, error kept", async () => {
      const q = ok((await issue()).result);
      const { outboxId } = ok(await sendQuotationEmail(sales, { id: q.id, to: "lara@example.test" }));
      const handler = emailHandler({ transport: failing, from: "x@example.test", resolveAttachment: async () => Buffer.from("pdf") });
      // Start the fake clock at the row's own (database) timestamp: Node's and Postgres' clocks may differ.
      const [queued] = await db.select().from(outbox).where(eq(outbox.id, outboxId));
      let clock = queued.nextAttemptAt.getTime() + 1; // +1 ms: Postgres keeps microseconds, Date does not.
      const now = () => new Date(clock);
      const delays: number[] = [];
      for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt++) {
        const s = await processOutbox(db, { email: handler }, { now });
        const [row] = await db.select().from(outbox).where(eq(outbox.id, outboxId));
        expect(row.attempts).toBe(attempt);
        expect(row.lastError).toBe("SMTP 550 mailbox unavailable");
        if (attempt < OUTBOX_MAX_ATTEMPTS) {
          expect(s).toEqual({ sent: 0, retrying: 1, failed: 0 });
          expect(row.status).toBe("pending");
          delays.push(row.nextAttemptAt.getTime() - clock);
          // Not due yet: nothing happens.
          expect(await processOutbox(db, { email: handler }, { now })).toEqual({ sent: 0, retrying: 0, failed: 0 });
          clock = row.nextAttemptAt.getTime();
        } else {
          expect(s).toEqual({ sent: 0, retrying: 0, failed: 1 });
          expect(row.status).toBe("failed");
        }
      }
      expect(delays).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000]);
      // A failed row is never picked up again.
      expect(await processOutbox(db, { email: handler }, { now: () => new Date(clock + 86_400_000) })).toEqual({ sent: 0, retrying: 0, failed: 0 });
    });

    it("two workers never send the same row twice", async () => {
      for (let i = 0; i < 6; i++) await enqueueOutbox(db, { kind: "email", payload: { to: ["a@example.test"], subject: "s", text: "t", html: "<p>t</p>" } });
      let calls = 0;
      const transport: EmailTransport = {
        name: "slow",
        async send() {
          calls += 1;
          await new Promise((r) => setTimeout(r, 30));
          return { provider: "slow", id: null };
        },
      };
      const handler = emailHandler({ transport, from: "x@example.test", resolveAttachment: async () => Buffer.from("") });
      const [a, b] = await Promise.all([processOutbox(db, { email: handler }), processOutbox(db, { email: handler })]);
      expect(a.sent + b.sent).toBe(6);
      expect(calls).toBe(6);
    });

    it("an unknown outbox kind fails into retries, not a crash", async () => {
      const { id } = await enqueueOutbox(db, { kind: "rework_lead", payload: {} });
      expect(await processOutbox(db, {})).toEqual({ sent: 0, retrying: 1, failed: 0 });
      const [row] = await db.select().from(outbox).where(eq(outbox.id, id));
      expect(row.lastError).toBe('No sender for outbox kind "rework_lead".');
    });
  });

  describe("loyalty import", () => {
    // Invented: two cards; one linked via the quotation number, one by name, one unmatched.
    const LOYALTY = {
      log: [
        { A: "Feb 1-3, 2026", B: "JMV-0001", C: "VRA2026001", D: 1, E: 2, F: 100, G: 1 },
        { A: new Date(Date.UTC(2026, 2, 10)), B: "JMV-0001", C: "VRA2026002", D: 2, E: 1, F: 50, G: "Congratulations! You are now a Tier 2 Client!" },
        { A: "Dec 30 - Jan 2, 2026", B: "JMV-0003", C: "VRA2026003", D: 1, E: 3, F: 150 },
        { A: "sometime", B: "JMV-0004", C: "VRA2026999", D: 1, E: 1, F: 50 },
        { A: "Mar 1, 2026", B: "not a card", C: "VRA2026004", F: 50 },
      ],
      vra: [
        { A: "VRA2026001", B: new Date(Date.UTC(2026, 0, 30)), C: "Ana Testcase", D: "QTN-2026-102" },
        { A: "VRA2026002", B: new Date(Date.UTC(2026, 2, 9)), C: "Ana Testcase", D: "QTN-2026-101" },
        { A: "VRA2026003", B: new Date(Date.UTC(2025, 11, 28)), C: "Cora Nocontact", D: null },
      ],
    };

    it("imports cards and points matching the Loyalty Log sums; re-run adds nothing; JMV continues", async () => {
      const buf = await bookingWorkbook({ loyalty: LOYALTY });
      const p = await previewUpload(sa, "Self-Driven and With Driver.xlsx", new Uint8Array(buf));
      if (!p.ok) throw new Error(p.error);
      const sec = p.summary.sections.find((s) => s.section === "loyalty")!;
      expect(sec.counts).toMatchObject({ new: 3 });
      expect(sec.warnings.some((w) => w.message.includes("not a loyalty number"))).toBe(true);
      expect(sec.warnings.some((w) => w.message.includes("VRA2026999"))).toBe(true);
      ok(await commitImport(sa, { runId: p.runId }));

      const cards = Object.fromEntries((await db.select().from(loyaltyAccounts)).map((a) => [a.cardNo, a]));
      expect(Object.keys(cards).sort()).toEqual(["JMV-0001", "JMV-0003", "JMV-0004"]);
      const [ana] = await db.select().from(clients).where(eq(clients.fullName, "Ana Testcase"));
      const [cora] = await db.select().from(clients).where(eq(clients.fullName, "Cora Nocontact"));
      expect(cards["JMV-0001"]).toMatchObject({ clientId: ana.id, memberSince: "2026-02-01", expiresAt: "2027-02-01", tier: 2, imported: true });
      expect(cards["JMV-0003"]).toMatchObject({ clientId: cora.id, memberSince: "2025-12-30", expiresAt: "2026-12-30", tier: null, status: "active" });
      expect(cards["JMV-0004"]).toMatchObject({ clientId: null });
      expect(await balanceOf(db, cards["JMV-0001"].id)).toBe(150);
      expect(await balanceOf(db, cards["JMV-0003"].id)).toBe(150);
      expect(await balanceOf(db, cards["JMV-0004"].id)).toBe(50);
      const [seq] = await db.select().from(numberSequences).where(eq(numberSequences.key, "JMV"));
      expect(seq.lastValue).toBe(4);

      const p2 = await previewUpload(sa, "Self-Driven and With Driver.xlsx", new Uint8Array(buf));
      if (!p2.ok) throw new Error(p2.error);
      expect(p2.summary.sections.find((s) => s.section === "loyalty")!.counts).toMatchObject({ new: 0, changed: 0, unchanged: 3 });
      ok(await commitImport(sa, { runId: p2.runId }));
      expect(await db.select().from(pointsLedger)).toHaveLength(4);
    });
  });

  it("worker: starts pg-boss with its schedules, sends on the enqueue notification, stops gracefully", async () => {
    const sent: string[] = [];
    const transport: EmailTransport = {
      name: "fake",
      async send(m) {
        sent.push(m.to[0]);
        return { provider: "fake", id: null };
      },
    };
    const w = await startWorker({ databaseUrl: TEST_DB_URL!, transport, emailFrom: "x@example.test" });
    try {
      const schedules = await w.boss.getSchedules();
      expect(schedules.map((x) => [x.name, x.cron, x.timezone])).toEqual(
        expect.arrayContaining([
          ["nightly-expire-loyalty", "5 0 * * *", "Asia/Manila"],
          ["nightly-expire-quotations", "5 0 * * *", "Asia/Manila"],
        ]),
      );
      await db.transaction((tx) => enqueueOutbox(tx, { kind: "email", payload: { to: ["notify@example.test"], subject: "s", text: "t", html: "<p>t</p>" } }));
      const deadline = Date.now() + 10_000;
      while (!sent.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      expect(sent).toEqual(["notify@example.test"]);
    } finally {
      await w.stop();
    }
  }, 30_000);

  it("web code never calls Resend: only src/worker references it", async () => {
    const offenders: string[] = [];
    async function walk(dir: string) {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) {
          const src = await readFile(p, "utf8");
          if (/api\.resend\.com|from ["']resend["']|from ["']@\/worker|from ["']pg-boss["']/.test(src)) offenders.push(p);
        }
      }
    }
    for (const d of ["src/app", "src/lib", "src/components"]) await walk(d);
    expect(offenders).toEqual([]);
  });
});

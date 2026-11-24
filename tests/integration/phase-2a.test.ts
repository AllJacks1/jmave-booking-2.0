import { hasTestDb } from "./env";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  auditLog,
  bookingCharges,
  bookings,
  clients,
  drivers,
  numberSequences,
  quotations,
  rateCards,
  vehicleHolds,
  vehicles,
} from "@/db/schema";
import { checkAvailability } from "@/lib/bookings/availability";
import { endBlock, saveBlock } from "@/lib/bookings/blocks";
import { computeLedger } from "@/lib/bookings/ledger";
import {
  addCharge,
  addPayment,
  applyDeposit,
  assignDriver,
  cancelBooking,
  closeBooking,
  confirmBooking,
  convertToBooking,
  markNoShow,
  removeCharge,
  updateBookingDetails,
  updateBookingSchedule,
  voidPayment,
} from "@/lib/bookings/service";
import type { PaymentInput } from "@/lib/bookings/schema";
import { saveDriver } from "@/lib/drivers/service";
import { EXPECTED_RATE_CARD_V1 } from "@/lib/pricing";
import { SD2_FORM, WD1_FORM } from "@/lib/quotes/fixtures";
import { issueQuotation, saveDraft } from "@/lib/quotes/service";
import type { QuoteFormInput } from "@/lib/quotes/schema";
import { ensureDefaultSettings } from "@/lib/settings/service";
import { manilaToUtc } from "@/lib/time";
import { makeUser, truncateAll } from "./helpers";

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
let ops: Actor;
let car: { id: string };
let car2: { id: string };
let client: { id: string };

async function seed() {
  await ensureDefaultSettings();
  await db.insert(rateCards).values({ version: 1, name: "v1", status: "active", data: EXPECTED_RATE_CARD_V1, source: "test" });
  await db.insert(numberSequences).values([
    { key: "QTN-2026", lastValue: 928 },
    { key: "QTN-WD2026", lastValue: 118 },
  ]);
  [car] = await db.insert(vehicles).values({ displayName: "Wigo Gray AT ABC 1234", plate: "ABC 1234", bodyType: "compact", fuelType: "gasoline", tankCapacityL: 33 }).returning();
  [car2] = await db.insert(vehicles).values({ displayName: "Vios Red AT XYZ 9876", plate: "XYZ 9876", bodyType: "sedan", fuelType: "gasoline" }).returning();
  [client] = await db.insert(clients).values({ fullName: "Ana Testing", fbName: "Ana T" }).returning();
  sales = await makeUser("sales");
  admin = await makeUser("admin");
  ops = await makeUser("operations");
}

/** Issue a formal Self-Drive quotation for the car and dates, return its id + number. */
async function issued(form: Partial<QuoteFormInput> = {}) {
  const f: QuoteFormInput = {
    ...SD2_FORM,
    clientId: client.id,
    vehicleId: car.id,
    startDate: "2026-12-01",
    startTime: "08:00",
    endDate: "2026-12-02",
    endTime: "08:00",
    ...form,
  };
  const { id } = ok(await saveDraft(sales, { form: f }));
  return ok(await issueQuotation(sales, { id, form: f, overrideReason: "" }));
}

async function pendingBooking(form: Partial<QuoteFormInput> = {}) {
  const q = await issued(form);
  return ok(await convertToBooking(sales, { quotationId: q.id }));
}

function pay(bookingId: string, type: PaymentInput["type"], pesos: number, extra: Partial<PaymentInput> = {}): PaymentInput {
  return {
    bookingId,
    type,
    amountCentavos: Math.round(pesos * 100),
    method: "gcash",
    collectedByUserId: sales.id,
    paidDate: "2026-11-24",
    paidTime: "10:00",
    ...extra,
  };
}

async function confirmed(form: Partial<QuoteFormInput> = {}) {
  const b = await pendingBooking(form);
  ok(await addPayment(sales, pay(b.id, "reservation_fee", 500)));
  ok(await confirmBooking(sales, { id: b.id }));
  return b;
}

async function booking(id: string) {
  const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
  return row;
}

async function activeHolds(vehicleId = car.id) {
  return db.select().from(vehicleHolds).where(and(eq(vehicleHolds.vehicleId, vehicleId), eq(vehicleHolds.active, true)));
}

describe.skipIf(!hasTestDb)("Phase 2a bookings against the database", () => {
  beforeEach(async () => {
    await truncateAll();
    await seed();
  });
  afterAll(closeDb);

  describe("convert to booking", () => {
    it("copies schedule, client, vehicle and lines; number = quotation number; quotation accepted", async () => {
      const q = await issued();
      const b = ok(await convertToBooking(sales, { quotationId: q.id }));
      expect(b.number).toBe(q.number);
      const row = await booking(b.id);
      expect(row).toMatchObject({ status: "pending_reservation", clientId: client.id, vehicleId: car.id, service: "self_drive", quotationId: q.id });
      expect(row.startAt.toISOString()).toBe(manilaToUtc("2026-12-01", "08:00").toISOString());
      const [qrow] = await db.select().from(quotations).where(eq(quotations.id, q.id));
      expect(qrow.status).toBe("accepted");
      const charges = await db.select().from(bookingCharges).where(eq(bookingCharges.bookingId, b.id));
      expect(charges.length).toBeGreaterThan(0);
      expect(charges.every((c) => c.source === "quote" && c.kind === "quoted")).toBe(true);
      // SD-2 rental total, cash: charges = rental total (deposit excluded).
      const sum = charges.reduce((s, c) => s + c.amountCentavos, 0);
      expect(sum).toBe(qrow.totalCentavos);
      // Pending reservation does not hold the car.
      expect(await activeHolds()).toHaveLength(0);
      const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, b.id));
      expect(audit.map((a) => a.action)).toContain("booking.created");
    });

    it("needs a specific vehicle", async () => {
      const q = await issued({ vehicleId: null });
      expect(fail(await convertToBooking(sales, { quotationId: q.id }))).toMatchObject({ status: 409, error: expect.stringContaining("vehicle") });
    });

    it("refuses a second conversion and non-issued quotations", async () => {
      const q = await issued();
      ok(await convertToBooking(sales, { quotationId: q.id }));
      expect(fail(await convertToBooking(sales, { quotationId: q.id })).status).toBe(409);
      const { id } = ok(await saveDraft(sales, { form: { ...SD2_FORM, clientId: client.id, vehicleId: car.id } }));
      expect(fail(await convertToBooking(sales, { quotationId: id })).status).toBe(409);
    });
  });

  describe("confirm and the double-booking guard", () => {
    it("needs a reservation fee; then holds the car", async () => {
      const b = await pendingBooking();
      expect(fail(await confirmBooking(sales, { id: b.id }))).toMatchObject({ status: 409, error: expect.stringContaining("reservation fee") });
      ok(await addPayment(sales, pay(b.id, "reservation_fee", 500)));
      ok(await confirmBooking(sales, { id: b.id }));
      const row = await booking(b.id);
      expect(row.status).toBe("confirmed");
      expect(row.confirmedBy).toBe(sales.id);
      expect(await activeHolds()).toHaveLength(1);
    });

    it("a voided reservation fee does not count", async () => {
      const b = await pendingBooking();
      const p = ok(await addPayment(sales, pay(b.id, "reservation_fee", 500)));
      ok(await voidPayment(admin, { id: p.id, reason: "Wrong booking" }));
      expect(fail(await confirmBooking(sales, { id: b.id })).status).toBe(409);
    });

    it("confirm without RF: Sales 403, Admin needs a reason", async () => {
      const b = await pendingBooking();
      expect(fail(await confirmBooking(sales, { id: b.id, withoutRf: true, withoutRfReason: "Trusted" })).status).toBe(403);
      expect(fail(await confirmBooking(admin, { id: b.id, withoutRf: true, withoutRfReason: "" })).status).toBe(400);
      ok(await confirmBooking(admin, { id: b.id, withoutRf: true, withoutRfReason: "Corporate account, pays on release" }));
      expect((await booking(b.id)).confirmWithoutRfReason).toBe("Corporate account, pays on release");
    });

    it("second confirm for the same car/time is refused with the conflicting number", async () => {
      const first = await confirmed();
      const second = await pendingBooking({ startTime: "12:00" });
      ok(await addPayment(sales, pay(second.id, "reservation_fee", 500)));
      const r = fail(await confirmBooking(sales, { id: second.id }));
      expect(r.status).toBe(409);
      expect(r.error).toContain(first.number);
      expect((await booking(second.id)).status).toBe("pending_reservation");
    });

    it("concurrent confirms of overlapping bookings: exactly one succeeds", async () => {
      const a = await pendingBooking();
      const b = await pendingBooking({ startDate: "2026-12-01", startTime: "20:00", endDate: "2026-12-02", endTime: "20:00" });
      ok(await addPayment(sales, pay(a.id, "reservation_fee", 500)));
      ok(await addPayment(sales, pay(b.id, "reservation_fee", 500)));
      const results = await Promise.all([confirmBooking(sales, { id: a.id }), confirmBooking(admin, { id: b.id })]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const loser = results.find((r) => !r.ok) as { status: number; error: string };
      expect(loser.status).toBe(409);
      expect(await activeHolds()).toHaveLength(1);
    });

    it("pending reservations never block, but availability warns", async () => {
      const a = await pendingBooking();
      const b = await pendingBooking({ startTime: "10:00" });
      const av = await checkAvailability(db, { vehicleId: car.id, startAt: manilaToUtc("2026-12-01", "09:00"), endAt: manilaToUtc("2026-12-01", "18:00") });
      expect(av).toMatchObject({ state: "pending_overlap" });
      expect(av.state === "pending_overlap" && av.pending.map((p) => p.number).sort()).toEqual([a.number, b.number].sort());
      ok(await addPayment(sales, pay(b.id, "reservation_fee", 500)));
      ok(await confirmBooking(sales, { id: b.id }));
      const av2 = await checkAvailability(db, { vehicleId: car.id, startAt: manilaToUtc("2026-12-01", "09:00"), endAt: manilaToUtc("2026-12-01", "18:00") });
      expect(av2).toMatchObject({ state: "booked", conflict: { bookingNumber: b.number } });
      const free = await checkAvailability(db, { vehicleId: car2.id, startAt: manilaToUtc("2026-12-01", "09:00"), endAt: manilaToUtc("2026-12-01", "18:00") });
      expect(free).toEqual({ state: "available" });
      // The booking's own hold is not a conflict for itself.
      const self = await checkAvailability(db, { vehicleId: car.id, startAt: manilaToUtc("2026-12-01", "10:00"), endAt: manilaToUtc("2026-12-02", "08:00"), excludeBookingId: b.id });
      expect(self.state).toBe("pending_overlap");
    });

    it("availability respects the turnaround buffer", async () => {
      await confirmed(); // 12-01 08:00 → 12-02 08:00, held until 09:00
      const inside = await checkAvailability(db, { vehicleId: car.id, startAt: manilaToUtc("2026-12-02", "08:30"), endAt: manilaToUtc("2026-12-03", "08:00") });
      expect(inside.state).toBe("booked");
      const after = await checkAvailability(db, { vehicleId: car.id, startAt: manilaToUtc("2026-12-02", "09:00"), endAt: manilaToUtc("2026-12-03", "08:00") });
      expect(after.state).toBe("available");
    });
  });

  describe("cancel, no-show, close", () => {
    it("cancel releases the hold so another booking can confirm", async () => {
      const first = await confirmed();
      const second = await pendingBooking();
      ok(await addPayment(sales, pay(second.id, "reservation_fee", 500)));
      expect(fail(await confirmBooking(sales, { id: second.id })).status).toBe(409);
      expect(fail(await cancelBooking(sales, { id: first.id, reason: "" })).status).toBe(400);
      ok(await cancelBooking(sales, { id: first.id, reason: "Client changed plans" }));
      expect(await booking(first.id)).toMatchObject({ status: "cancelled", statusNote: "Client changed plans" });
      ok(await confirmBooking(sales, { id: second.id }));
    });

    it("no-show only from confirmed and releases the hold", async () => {
      const p = await pendingBooking();
      expect(fail(await markNoShow(sales, { id: p.id })).status).toBe(409);
      const c = await confirmed({ startDate: "2026-12-10", endDate: "2026-12-11" });
      ok(await markNoShow(sales, { id: c.id }));
      expect((await booking(c.id)).status).toBe("no_show");
      expect((await activeHolds()).length).toBe(0);
    });

    it("close needs returned, zero balance and no deposit held", async () => {
      const b = await confirmed();
      expect(fail(await closeBooking(sales, { id: b.id })).status).toBe(409);
      // Release/return arrive in Phase 2b; set the status directly here.
      await db.update(bookings).set({ status: "returned" }).where(eq(bookings.id, b.id));
      expect(fail(await closeBooking(sales, { id: b.id })).error).toContain("balance");
      const charges = await db.select().from(bookingCharges).where(eq(bookingCharges.bookingId, b.id));
      const owed = charges.reduce((s, c) => s + c.amountCentavos, 0) - 50000;
      ok(await addPayment(sales, pay(b.id, "deposit", 2000, { method: "cash" })));
      ok(await addPayment(sales, pay(b.id, "rental", owed / 100, { method: "cash" })));
      expect(fail(await closeBooking(sales, { id: b.id })).error).toContain("deposit");
      ok(await addPayment(sales, pay(b.id, "deposit_refund", 2000)));
      ok(await closeBooking(sales, { id: b.id }));
      expect((await booking(b.id)).status).toBe("closed");
      expect(await activeHolds()).toHaveLength(0);
      expect(fail(await addPayment(sales, pay(b.id, "other", 1, { note: "late" }))).status).toBe(409);
    });
  });

  describe("payments ledger", () => {
    it("the §3 example: balance 0, deposit held 2,000", async () => {
      const b = await pendingBooking();
      // Replace the quoted charges by the example's rental total of 2,191.
      await db.delete(bookingCharges).where(eq(bookingCharges.bookingId, b.id));
      ok(await addCharge(sales, { bookingId: b.id, kind: "other", label: "Rental total", amountCentavos: 219100 }));
      ok(await addPayment(sales, pay(b.id, "reservation_fee", 500)));
      ok(await addPayment(sales, pay(b.id, "delivery_fee", 490)));
      ok(await addPayment(sales, pay(b.id, "deposit", 2000, { method: "cash", collectedByUserId: null, collectedByName: "Driver Ben" })));
      ok(await addPayment(sales, pay(b.id, "rental", 1500, { method: "cash" })));
      ok(await addPayment(sales, pay(b.id, "change_given", 299, { method: "cash", collectedByUserId: null, collectedByName: "Driver Ben" })));
      const charges = await db.select().from(bookingCharges).where(eq(bookingCharges.bookingId, b.id));
      const { payments: pays } = await import("@/db/schema");
      const ps = await db.select().from(pays).where(eq(pays.bookingId, b.id));
      const l = computeLedger(charges, ps);
      expect(l.balance).toBe(0);
      expect(l.depositHeld).toBe(200000);
      expect(ps.find((p) => p.type === "change_given")?.direction).toBe("out");
    });

    it("void is Admin+ only; entries need a collector", async () => {
      const b = await pendingBooking();
      const p = ok(await addPayment(sales, pay(b.id, "rental", 100)));
      expect(fail(await voidPayment(sales, { id: p.id, reason: "typo" })).status).toBe(403);
      ok(await voidPayment(admin, { id: p.id, reason: "typo" }));
      expect(fail(await voidPayment(admin, { id: p.id, reason: "again" })).status).toBe(409);
      expect(fail(await addPayment(sales, pay(b.id, "rental", 100, { collectedByUserId: null, collectedByName: "" }))).status).toBe(400);
    });

    it("apply deposit moves it to the balance", async () => {
      const b = await pendingBooking();
      await db.delete(bookingCharges).where(eq(bookingCharges.bookingId, b.id));
      ok(await addCharge(sales, { bookingId: b.id, kind: "damage", label: "Scratch", amountCentavos: 50000 }));
      ok(await addPayment(sales, pay(b.id, "deposit", 2000)));
      expect(fail(await applyDeposit(sales, { bookingId: b.id, amountCentavos: 60000 })).status).toBe(409);
      ok(await applyDeposit(sales, { bookingId: b.id, amountCentavos: 50000 }));
      const charges = await db.select().from(bookingCharges).where(eq(bookingCharges.bookingId, b.id));
      const { payments: pays } = await import("@/db/schema");
      const l = computeLedger(charges, await db.select().from(pays).where(eq(pays.bookingId, b.id)));
      expect(l).toMatchObject({ balance: 0, depositHeld: 150000 });
    });

    it("manual charges can be removed; quoted ones cannot", async () => {
      const b = await pendingBooking();
      const c = ok(await addCharge(sales, { bookingId: b.id, kind: "other", label: "Extra", amountCentavos: 100 }));
      ok(await removeCharge(sales, { id: c.id, reason: "Not needed" }));
      const [quoted] = await db.select().from(bookingCharges).where(eq(bookingCharges.bookingId, b.id));
      expect(fail(await removeCharge(sales, { id: quoted.id, reason: "x" })).status).toBe(409);
    });
  });

  describe("edits", () => {
    it("rescheduling a confirmed booking into a conflict is refused and changes nothing", async () => {
      const a = await confirmed();
      const b = await confirmed({ startDate: "2026-12-05", endDate: "2026-12-06" });
      const r = fail(await updateBookingSchedule(sales, { id: b.id, vehicleId: car.id, startDate: "2026-12-01", startTime: "12:00", endDate: "2026-12-06", endTime: "08:00" }));
      expect(r.status).toBe(409);
      expect(r.error).toContain(a.number);
      expect((await booking(b.id)).startAt.toISOString()).toBe(manilaToUtc("2026-12-05", "08:00").toISOString());
      // Moving to the other car works and moves the hold.
      ok(await updateBookingSchedule(sales, { id: b.id, vehicleId: car2.id, startDate: "2026-12-01", startTime: "12:00", endDate: "2026-12-06", endTime: "08:00" }));
      expect(await activeHolds(car2.id)).toHaveLength(1);
      expect(await activeHolds(car.id)).toHaveLength(1);
    });

    it("details save with §1 fields", async () => {
      const b = await pendingBooking();
      ok(
        await updateBookingDetails(sales, {
          id: b.id,
          deliveryAddress: "Somewhere, Davao City",
          idsPresented: ["Driver's License", "UMID"],
          sourceChannel: "facebook",
          reworkLink: "https://inbox.example.test/c/1",
          orIssued: true,
          driverNameOnLicense: "Ana Testing",
          driversLicenseNo: "N01-23-456789",
        }),
      );
      expect(await booking(b.id)).toMatchObject({ idsPresented: ["Driver's License", "UMID"], sourceChannel: "facebook", orIssued: true });
      expect(fail(await updateBookingDetails(sales, { id: b.id, reworkLink: "not a link" })).status).toBe(400);
    });
  });

  describe("repeat client from bookings", () => {
    it("confirm sets first_rental_at; cancelling the only booking clears it", async () => {
      const b = await confirmed();
      const [c1] = await db.select().from(clients).where(eq(clients.id, client.id));
      expect(c1.firstRentalAt?.toISOString()).toBe(manilaToUtc("2026-12-01", "08:00").toISOString());
      ok(await cancelBooking(sales, { id: b.id, reason: "x" }));
      const [c2] = await db.select().from(clients).where(eq(clients.id, client.id));
      expect(c2.firstRentalAt).toBeNull();
    });
  });

  describe("drivers", () => {
    it("overlap: Sales refused, Admin with a reason", async () => {
      const d = ok(await saveDriver(sales, { name: "Pedro Driver", phone: "09171234567" }));
      expect(fail(await saveDriver(sales, { name: "pedro driver" })).status).toBe(409);
      const wd = (start: string) => ({ ...WD1_FORM, clientId: client.id, vehicleId: car2.id, startDate: start, endDate: start });
      const a = await pendingBooking(wd("2026-12-20"));
      const b = await pendingBooking({ ...wd("2026-12-20"), vehicleId: car.id, bodyType: "compact", category: null });
      ok(await assignDriver(sales, { id: a.id, driverId: d.id }));
      expect(fail(await assignDriver(sales, { id: b.id, driverId: d.id })).error).toContain(a.number);
      expect(fail(await assignDriver(admin, { id: b.id, driverId: d.id })).status).toBe(409);
      ok(await assignDriver(admin, { id: b.id, driverId: d.id, overrideReason: "Short hop, same area" }));
      expect((await booking(b.id)).driverOverlapReason).toBe("Short hop, same area");
      const [row] = await db.select().from(drivers).where(eq(drivers.id, d.id));
      expect(row.phone).toBe("+639171234567");
    });

    it("drivers only on With Driver bookings", async () => {
      const d = ok(await saveDriver(sales, { name: "Solo" }));
      const sd = await pendingBooking();
      expect(fail(await assignDriver(sales, { id: sd.id, driverId: d.id })).status).toBe(409);
    });
  });

  describe("vehicle blocks", () => {
    it("blocks conflict with bookings both ways and can be removed", async () => {
      const b = await confirmed();
      const r = fail(await saveBlock(sales, { vehicleId: car.id, kind: "maintenance", startDate: "2026-12-01", startTime: "12:00", endDate: "2026-12-01", endTime: "18:00", reason: "PMS" }));
      expect(r.error).toContain(b.number);
      const blk = ok(await saveBlock(sales, { vehicleId: car.id, kind: "owner_use", startDate: "2026-12-15", startTime: "00:00", endDate: "2026-12-17", endTime: "00:00", reason: "Owner trip" }));
      const p = await pendingBooking({ startDate: "2026-12-16", endDate: "2026-12-17" });
      ok(await addPayment(sales, pay(p.id, "reservation_fee", 500)));
      expect(fail(await confirmBooking(sales, { id: p.id })).error).toContain("blocked");
      ok(await endBlock(sales, { id: blk.id })); // not started yet → removed
      ok(await confirmBooking(sales, { id: p.id }));
      expect(fail(await saveBlock(ops, { vehicleId: car.id, kind: "other", startDate: "2027-01-01", startTime: "00:00", endDate: "2027-01-02", endTime: "00:00", reason: "x" })).status).toBe(403);
    });
  });

  describe("calendar", () => {
    it("stays fast with 20 vehicles × 31 days of bookings", async () => {
      const cars = await db
        .insert(vehicles)
        .values(Array.from({ length: 18 }, (_, i) => ({ displayName: `Perf Car ${i}`, plate: `PRF ${1000 + i}`, bodyType: "sedan" as const, sortOrder: i })))
        .returning({ id: vehicles.id });
      const all = [car, car2, ...cars];
      const rows = all.flatMap((v, vi) =>
        Array.from({ length: 31 }, (_, d) => {
          const day = `2027-03-${String(d + 1).padStart(2, "0")}`;
          return {
            number: `QTN-2097-${vi}-${d}`,
            service: "self_drive" as const,
            status: (d % 3 === 0 ? "pending_reservation" : "confirmed") as "pending_reservation" | "confirmed",
            vehicleId: v.id,
            clientName: `Client ${vi}-${d}`,
            startAt: manilaToUtc(day, "08:00"),
            endAt: manilaToUtc(day, "20:00"),
          };
        }),
      );
      await db.insert(bookings).values(rows);
      const { calendarData, calendarFilterSchema } = await import("@/lib/calendar/service");
      const { calendarBounds, calendarDays, placeBars } = await import("@/lib/calendar/layout");
      const days = calendarDays("month", "2027-03-01");
      const { from, to } = calendarBounds(days);
      const t0 = performance.now();
      const data = await calendarData(from, to, calendarFilterSchema.parse({ view: "month" }));
      for (const v of data.vehicles) {
        placeBars(
          data.items.filter((i) => i.vehicleId === v.id).map((i) => ({ ...i, start: new Date(i.start), end: new Date(i.end) })),
          from,
          to,
        );
      }
      const ms = performance.now() - t0;
      expect(data.vehicles).toHaveLength(20);
      expect(data.items).toHaveLength(620);
      expect(ms).toBeLessThan(1000);
    });
  });

  describe("Operations", () => {
    it("gets 403 on every booking edit action", async () => {
      const b = await pendingBooking();
      const q = await issued({ startDate: "2026-12-12", endDate: "2026-12-13" });
      const results = await Promise.all([
        convertToBooking(ops, { quotationId: q.id }),
        confirmBooking(ops, { id: b.id }),
        cancelBooking(ops, { id: b.id, reason: "x" }),
        markNoShow(ops, { id: b.id }),
        closeBooking(ops, { id: b.id }),
        updateBookingDetails(ops, { id: b.id }),
        updateBookingSchedule(ops, { id: b.id, vehicleId: car.id, startDate: "2026-12-01", startTime: "08:00", endDate: "2026-12-02", endTime: "08:00" }),
        addPayment(ops, pay(b.id, "rental", 1)),
        voidPayment(ops, { id: b.id, reason: "x" }),
        applyDeposit(ops, { bookingId: b.id, amountCentavos: 1 }),
        addCharge(ops, { bookingId: b.id, kind: "other", label: "x", amountCentavos: 1 }),
        removeCharge(ops, { id: b.id, reason: "x" }),
        assignDriver(ops, { id: b.id, driverId: null }),
        saveDriver(ops, { name: "X" }),
        endBlock(ops, { id: b.id }),
      ]);
      for (const r of results) expect(r).toMatchObject({ ok: false, status: 403 });
    });
  });
});

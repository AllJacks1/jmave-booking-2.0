import { hasTestDb } from "./env";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { auditLog, bookingCharges, bookings, clients, movementEvents, numberSequences, rateCards, shiftAssignments, shiftTemplates, vehicles } from "@/db/schema";
import { boardData } from "@/lib/board/service";
import {
  addCharge,
  addPayment,
  cancelBooking,
  confirmBooking,
  convertToBooking,
  removeCharge,
  updateBookingDetails,
  updateBookingSchedule,
  voidPayment,
} from "@/lib/bookings/service";
import { computeLedger } from "@/lib/bookings/ledger";
import { extendBooking, previewExtension, previewReturn, recordRelease, recordReturn } from "@/lib/check-in/service";
import { EXPECTED_RATE_CARD_V1 } from "@/lib/pricing";
import { SD2_FORM } from "@/lib/quotes/fixtures";
import { issueQuotation, saveDraft } from "@/lib/quotes/service";
import type { QuoteFormInput } from "@/lib/quotes/schema";
import { copyPreviousWeek, onDutyNow, rosterForDay, setShift } from "@/lib/roster/service";
import { ensureDefaultSettings } from "@/lib/settings/service";
import { getHold } from "@/lib/holds";
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
let client: { id: string };

// Check-ins cannot be in the future, so the rental is in the past (invented data).
const START = { date: "2026-11-10", time: "09:00" };
const END = { date: "2026-11-11", time: "09:00" };

async function seed() {
  await ensureDefaultSettings();
  await db.insert(rateCards).values({ version: 1, name: "v1", status: "active", data: EXPECTED_RATE_CARD_V1, source: "test" });
  await db.insert(numberSequences).values([{ key: "QTN-2026", lastValue: 928 }]);
  [car] = await db
    .insert(vehicles)
    .values({ displayName: "Vios Silver AT TST 4242", plate: "TST 4242", bodyType: "sedan", fuelType: "gasoline", tankCapacityL: 42 })
    .returning();
  [client] = await db.insert(clients).values({ fullName: "Rita Renter", fbName: "Rita R" }).returning();
  sales = await makeUser("sales");
  admin = await makeUser("admin");
  ops = await makeUser("operations");
}

/** Confirmed 1-day Self-Drive Sedan booking (brief step 10). */
async function confirmed(form: Partial<QuoteFormInput> = {}) {
  const f: QuoteFormInput = {
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
    ...form,
  };
  const { id } = ok(await saveDraft(sales, { form: f }));
  const q = ok(await issueQuotation(sales, { id, form: f, overrideReason: "" }));
  const b = ok(await convertToBooking(sales, { quotationId: q.id }));
  ok(await addPayment(sales, { bookingId: b.id, type: "reservation_fee", amountCentavos: 50_000, method: "gcash", collectedByUserId: sales.id, paidDate: "2026-11-05", paidTime: "10:00" }));
  ok(await confirmBooking(sales, { id: b.id }));
  return b;
}

const release = (bookingId: string, over: Record<string, unknown> = {}) => ({
  bookingId,
  actualDate: START.date,
  actualTime: "09:05",
  odometerKm: 10_000,
  fuelLevelEighths: 8,
  ...over,
});
const ret = (bookingId: string, over: Record<string, unknown> = {}) => ({
  bookingId,
  actualDate: END.date,
  actualTime: "11:00",
  odometerKm: 10_450,
  fuelLevelEighths: 6,
  ...over,
});

async function row(id: string) {
  const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
  return b;
}

describe.skipIf(!hasTestDb)("Phase 2b check-in, board and roster against the database", () => {
  beforeEach(async () => {
    await truncateAll();
    await seed();
  });
  afterAll(closeDb);

  describe("release", () => {
    it("Ops releases a confirmed booking: event written, status released, audited", async () => {
      const b = await confirmed();
      ok(await recordRelease(ops, { ...release(b.id), delivery: true, notes: "Scratch on rear bumper noted" }));
      expect((await row(b.id)).status).toBe("released");
      const [ev] = await db.select().from(movementEvents).where(eq(movementEvents.bookingId, b.id));
      expect(ev).toMatchObject({ kind: "release", odometerKm: 10_000, fuelLevelEighths: 8, delivery: true, recordedBy: ops.id });
      expect(ev.actualAt).toEqual(manilaToUtc(START.date, "09:05"));
      expect(ev.plannedAt).toEqual(manilaToUtc(START.date, START.time));
      const audit = await db.select().from(auditLog).where(and(eq(auditLog.entityId, b.id), eq(auditLog.action, "booking.release")));
      expect(audit).toHaveLength(1);
    });

    it("requires a confirmed booking (pending → 409) and only once", async () => {
      const f = { ...SD2_FORM, bodyType: "sedan" as const, category: "primo" as const, clientId: client.id, vehicleId: car.id, startDate: START.date, startTime: "09:00", endDate: END.date, endTime: "09:00" };
      const { id } = ok(await saveDraft(sales, { form: f }));
      const q = ok(await issueQuotation(sales, { id, form: f, overrideReason: "" }));
      const pending = ok(await convertToBooking(sales, { quotationId: q.id }));
      expect(fail(await recordRelease(ops, release(pending.id)))).toMatchObject({ status: 409, error: "Confirm the booking before releasing the car." });
      ok(await cancelBooking(sales, { id: pending.id, reason: "test" }));

      const b = await confirmed();
      ok(await recordRelease(ops, release(b.id)));
      expect(fail(await recordRelease(ops, release(b.id))).status).toBe(409);
    });

    it("refuses a time in the future and a bad fuel level", async () => {
      const b = await confirmed();
      expect(fail(await recordRelease(ops, release(b.id, { actualDate: "2099-01-01" }))).status).toBe(400);
      expect(fail(await recordRelease(ops, release(b.id, { fuelLevelEighths: 9 }))).status).toBe(400);
    });
  });

  describe("return", () => {
    it("brief step 10: excess km ₱1,200, fuel ₱987, late return ₱600; preview first; balance updates", async () => {
      const b = await confirmed();
      ok(await recordRelease(ops, release(b.id)));
      const before = await row(b.id);

      const p = ok(await previewReturn(ops, ret(b.id)));
      expect(p.lines.map((l) => [l.kind, l.amount])).toEqual([
        ["excess_km", 120_000],
        ["fuel_shortage", 98_700],
        ["extension", 60_000],
      ]);
      expect(p.total).toBe(278_700);
      expect(p.balanceAfter).toBe(p.ledger.balance + 278_700);
      // Preview writes nothing.
      expect((await row(b.id)).status).toBe("released");

      const r = ok(await recordReturn(ops, ret(b.id, { delivery: false })));
      expect(r.total).toBe(278_700);
      const after = await row(b.id);
      expect(after.status).toBe("returned");
      const charges = await db.select().from(bookingCharges).where(and(eq(bookingCharges.bookingId, b.id), eq(bookingCharges.source, "check_in")));
      expect(charges.map((c) => [c.kind, c.amountCentavos, c.code])).toEqual([
        ["excess_km", 120_000, "check_in_excess_km"],
        ["fuel_shortage", 98_700, "check_in_fuel_shortage"],
        ["extension", 60_000, "check_in_late_return"],
      ]);
      const all = await db.select().from(bookingCharges).where(eq(bookingCharges.bookingId, b.id));
      expect(computeLedger(all, []).charges).toBe(p.ledger.charges + 278_700);
      // Hold end = actual return + 60 min buffer.
      const h = await getHold(db, { bookingId: b.id });
      expect(h?.active).toBe(true);
      expect(h?.end).toEqual(manilaToUtc(END.date, "12:00"));
      expect(before.endAt).toEqual(after.endAt);
    });

    it("on time, within allowance, full tank: no charges", async () => {
      const b = await confirmed();
      ok(await recordRelease(ops, release(b.id)));
      const r = ok(await recordReturn(ops, ret(b.id, { actualTime: "09:45", odometerKm: 10_120, fuelLevelEighths: 8 })));
      expect(r.charges).toEqual([]);
    });

    it("refuses an odometer below the release reading and a return before release", async () => {
      const b = await confirmed();
      ok(await recordRelease(ops, release(b.id)));
      expect(fail(await recordReturn(ops, ret(b.id, { odometerKm: 9_999 }))).status).toBe(400);
      expect(fail(await recordReturn(ops, ret(b.id, { actualDate: START.date, actualTime: "08:00" }))).status).toBe(400);
    });

    it("needs a released booking", async () => {
      const b = await confirmed();
      expect(fail(await recordReturn(ops, ret(b.id))).status).toBe(409);
    });

    it("a late return that runs into the next booking still saves, with a warning", async () => {
      const a = await confirmed();
      // Next rental starts 10:30 on the return day; car comes back at 11:00.
      const next = await confirmed({ startDate: END.date, startTime: "10:30", endDate: "2026-11-12", endTime: "10:30" }).catch(() => null);
      // Confirming the next one needs the hold (09:00 + 60 min buffer = 10:00 < 10:30): fine.
      expect(next).not.toBeNull();
      ok(await recordRelease(ops, release(a.id)));
      const r = ok(await recordReturn(ops, ret(a.id)));
      expect((await row(a.id)).status).toBe("returned");
      expect(r.warnings.join(" ")).toMatch(/next booking/);
    });

    it("check-in charges: Ops and Sales cannot remove them, Admin can with a reason", async () => {
      const b = await confirmed();
      ok(await recordRelease(ops, release(b.id)));
      ok(await recordReturn(ops, ret(b.id)));
      const [fuel] = await db.select().from(bookingCharges).where(and(eq(bookingCharges.bookingId, b.id), eq(bookingCharges.kind, "fuel_shortage")));
      expect(fail(await removeCharge(ops, { id: fuel.id, reason: "x" })).status).toBe(403);
      expect(fail(await removeCharge(sales, { id: fuel.id, reason: "x" })).status).toBe(403);
      expect(fail(await removeCharge(admin, { id: fuel.id, reason: "" })).status).toBe(400);
      ok(await removeCharge(admin, { id: fuel.id, reason: "Client refuelled at the shop" }));
      expect(await db.select().from(bookingCharges).where(eq(bookingCharges.id, fuel.id))).toHaveLength(0);
      const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, b.id), eq(auditLog.action, "charge.removed")));
      expect(audit.after).toMatchObject({ reason: "Client refuelled at the shop" });
    });
  });

  describe("extension", () => {
    it("Sales extends a released booking: priced per hour, hold moves, event written", async () => {
      const b = await confirmed();
      ok(await recordRelease(ops, release(b.id)));
      const p = ok(await previewExtension(sales, { bookingId: b.id, newEndDate: END.date, newEndTime: "12:00" }));
      expect(p).toMatchObject({ hours: 3, amount: 90_000 });
      ok(await extendBooking(sales, { bookingId: b.id, newEndDate: END.date, newEndTime: "12:00", note: "Client asked by Messenger" }));
      const after = await row(b.id);
      expect(after.endAt).toEqual(manilaToUtc(END.date, "12:00"));
      const [c] = await db.select().from(bookingCharges).where(and(eq(bookingCharges.bookingId, b.id), eq(bookingCharges.code, "extension")));
      expect(c.amountCentavos).toBe(90_000);
      const [ev] = await db.select().from(movementEvents).where(and(eq(movementEvents.bookingId, b.id), eq(movementEvents.kind, "extension")));
      expect(ev.previousEndAt).toEqual(manilaToUtc(END.date, "09:00"));
      expect((await getHold(db, { bookingId: b.id }))?.end).toEqual(manilaToUtc(END.date, "13:00"));

      // Return at 12:30 is now on time (within grace): no late charge.
      const r = ok(await recordReturn(ops, ret(b.id, { actualTime: "12:30", odometerKm: 10_100, fuelLevelEighths: 8 })));
      expect(r.charges).toEqual([]);
    });

    it("conflict with the next booking → 409, nothing changes", async () => {
      const b = await confirmed();
      await confirmed({ startDate: END.date, startTime: "14:00", endDate: "2026-11-12", endTime: "14:00" });
      const r = fail(await extendBooking(sales, { bookingId: b.id, newEndDate: END.date, newEndTime: "13:30" }));
      expect(r.status).toBe(409);
      expect(r.error).toMatch(/already booked/);
      expect((await row(b.id)).endAt).toEqual(manilaToUtc(END.date, END.time));
      expect(await db.select().from(movementEvents).where(eq(movementEvents.bookingId, b.id))).toHaveLength(0);
    });

    it("Ops cannot extend; new end must be later", async () => {
      const b = await confirmed();
      expect(fail(await extendBooking(ops, { bookingId: b.id, newEndDate: END.date, newEndTime: "12:00" })).status).toBe(403);
      expect(fail(await extendBooking(sales, { bookingId: b.id, newEndDate: END.date, newEndTime: "08:00" })).status).toBe(400);
    });
  });

  describe("Operations permissions", () => {
    it("can release/return but gets 403 on bookings, payments and quotations", async () => {
      const b = await confirmed();
      const f = { ...SD2_FORM, clientId: client.id };
      const results = await Promise.all([
        updateBookingDetails(ops, { id: b.id }),
        updateBookingSchedule(ops, { id: b.id, vehicleId: car.id, startDate: START.date, startTime: "08:00", endDate: END.date, endTime: "08:00" }),
        cancelBooking(ops, { id: b.id, reason: "x" }),
        addPayment(ops, { bookingId: b.id, type: "rental", amountCentavos: 100, method: "cash", collectedByName: "X", paidDate: START.date, paidTime: "10:00" }),
        voidPayment(ops, { id: b.id, reason: "x" }),
        addCharge(ops, { bookingId: b.id, kind: "other", label: "x", amountCentavos: 1 }),
        extendBooking(ops, { bookingId: b.id, newEndDate: END.date, newEndTime: "12:00" }),
        previewExtension(ops, { bookingId: b.id, newEndDate: END.date, newEndTime: "12:00" }),
        saveDraft(ops, { form: f }),
        issueQuotation(ops, { id: b.id, form: f, overrideReason: "" }),
        setShift(ops, { date: START.date, userId: ops.id, templateId: null }),
        copyPreviousWeek(ops, { week: START.date }),
      ]);
      for (const r of results) expect(r).toMatchObject({ ok: false, status: 403 });
      ok(await recordRelease(ops, release(b.id)));
      ok(await recordReturn(ops, ret(b.id)));
    });
  });

  describe("board", () => {
    it("shows the day's statuses, events with actual times and the ledger balance", async () => {
      const b = await confirmed();
      const day1 = await boardData(START.date, manilaToUtc(START.date, "08:00"));
      const r1 = day1.day.rows.find((r) => r.vehicle.id === car.id)!;
      expect(r1.primary).toBe("out_today");
      expect(r1.events.map((e) => e.kind)).toEqual(["OUT"]);
      expect(day1.lookAhead.find((r) => r.vehicle.id === car.id)!.days[0].events.map((e) => e.kind)).toEqual(["IN"]);

      ok(await recordRelease(ops, release(b.id)));
      ok(await recordReturn(ops, ret(b.id)));
      const day2 = await boardData(END.date, manilaToUtc(END.date, "12:00"));
      const r2 = day2.day.rows.find((r) => r.vehicle.id === car.id)!;
      expect(r2.primary).toBe("return");
      expect(r2.events[0]).toMatchObject({ kind: "IN", done: true, actualAt: manilaToUtc(END.date, "11:00") });
      expect(r2.booking?.balance).toBeGreaterThan(278_700 - 1);
    });

    it("loads 20 vehicles quickly", async () => {
      const cars = await db
        .insert(vehicles)
        .values(Array.from({ length: 19 }, (_, i) => ({ displayName: `Car ${i} AT ZZZ ${100 + i}`, plate: `ZZZ ${100 + i}`, bodyType: "sedan" as const })))
        .returning({ id: vehicles.id });
      await db.insert(bookings).values(
        cars.flatMap((c, i) =>
          Array.from({ length: 6 }, (_, d) => ({
            number: `QTN-TEST-${i}-${d}`,
            vehicleId: c.id,
            service: "self_drive" as const,
            status: "confirmed" as const,
            startAt: manilaToUtc(`2026-11-${String(10 + d).padStart(2, "0")}`, "08:00"),
            endAt: manilaToUtc(`2026-11-${String(10 + d).padStart(2, "0")}`, "20:00"),
            clientName: "Test",
          })),
        ),
      );
      await boardData(START.date); // warm up
      const t0 = performance.now();
      const d = await boardData(START.date);
      const ms = performance.now() - t0;
      expect(d.day.rows).toHaveLength(20);
      expect(ms).toBeLessThan(1500);
    });
  });

  describe("roster", () => {
    it("Admin assigns shifts; one per person per day; copy previous week; on duty and board roster", async () => {
      const templates = await db.select().from(shiftTemplates);
      expect(templates.map((t) => t.name).sort()).toEqual(["10AM–7PM", "1PM–10PM", "5AM–2PM", "8AM–5PM", "9PM–6AM"].sort());
      const day = templates.find((t) => t.name === "8AM–5PM")!;
      const night = templates.find((t) => t.name === "9PM–6AM")!;
      expect(fail(await setShift(sales, { date: "2026-11-09", userId: ops.id, templateId: day.id })).status).toBe(403);

      ok(await setShift(admin, { date: "2026-11-09", userId: ops.id, templateId: day.id, duty: "operations" }));
      ok(await setShift(admin, { date: "2026-11-09", userId: ops.id, templateId: night.id, duty: "operations" })); // replaces
      ok(await setShift(admin, { date: "2026-11-10", userId: sales.id, templateId: day.id, duty: "sales" }));
      expect(await db.select().from(shiftAssignments)).toHaveLength(2);

      const board = await rosterForDay("2026-11-10");
      expect(board.today.map((e) => e.userId)).toEqual([sales.id]);
      expect(board.carried.map((e) => e.userId)).toEqual([ops.id]);
      expect((await onDutyNow(manilaToUtc("2026-11-10", "05:00"))).map((e) => e.userId)).toEqual([ops.id]);
      expect((await onDutyNow(manilaToUtc("2026-11-10", "09:00"))).map((e) => e.userId)).toEqual([sales.id]);

      // Clear, then copy previous week into the next one.
      ok(await setShift(admin, { date: "2026-11-10", userId: sales.id, templateId: null }));
      ok(await setShift(admin, { date: "2026-11-17", userId: ops.id, templateId: day.id, duty: "operations" }));
      const copied = ok(await copyPreviousWeek(admin, { week: "2026-11-18" }));
      expect(copied.added).toBe(1); // 11-09 → 11-16 (11-17 already set)
      const rows = await db.select().from(shiftAssignments).where(eq(shiftAssignments.userId, ops.id));
      expect(rows.map((r) => r.date).sort()).toEqual(["2026-11-09", "2026-11-16", "2026-11-17"]);
    });
  });
});

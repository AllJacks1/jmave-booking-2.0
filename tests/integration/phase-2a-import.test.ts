import { hasTestDb } from "./env";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { bookingCharges, bookings, clients, drivers, payments, quotations, vehicleHolds } from "@/db/schema";
import { clientHistory } from "@/lib/bookings/queries";
import { addPayment, confirmBooking, convertToBooking } from "@/lib/bookings/service";
import { calendarBounds, calendarDays } from "@/lib/calendar/layout";
import { calendarData, calendarFilterSchema } from "@/lib/calendar/service";
import { commitImport, previewUpload } from "@/lib/import/service";
import { ensureDefaultSettings } from "@/lib/settings/service";
import { manilaToUtc } from "@/lib/time";
import { bookingWorkbook } from "../fixtures/workbooks";
import { makeUser, truncateAll } from "./helpers";

const BOOKING = "Self-Driven and With Driver.xlsx";
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

/** Future rows (2027) on the Testcar (plate TST 1001). Invented data. */
const FUTURE = [
  { A: "QTN-2027-001", B: d(2026, 11, 20), C: d(2027, 1, 10), D: 2, E: 0.375, G: "Fay Future", AF: 9170000011, K: "Testcar Red AT - TST 1001", M: 3000, Q: 490, Y: 500, Z: 3490, AA: "GCash", AM: "BOOKED" },
  { A: "QTN-2027-002", B: d(2026, 11, 21), C: d(2027, 1, 11), D: 1, E: 0.375, G: "Gil Overlap", AF: 9170000012, K: "Testcar Red AT - TST1001", M: 1500, Z: 1500, AM: "BOOKED" },
  { A: "QTN-2027-003", B: d(2026, 11, 21), C: d(2027, 1, 20), D: 1, E: 0.375, G: "Hal Nocar", AF: 9170000013, K: "Mystery Car - ZZZ 9999", M: 1500, Z: 1500, AM: "BOOKED" },
  { A: "QTN-2027-004", B: d(2026, 11, 22), C: d(2027, 2, 1), D: 1, E: 0.375, G: "Ivy Quoted", AF: 9170000014, K: "Testcar Red AT - TST 1001", M: 1500, X: 100, Z: 1400, AM: "QUOTED" },
];

async function importFile(actor: Awaited<ReturnType<typeof makeUser>>, buf: Buffer) {
  const preview = await previewUpload(actor, BOOKING, new Uint8Array(buf));
  if (!preview.ok) throw new Error(preview.error);
  const commit = await commitImport(actor, { runId: preview.runId });
  if (!commit.ok) throw new Error(commit.error);
  return { preview: preview.summary, totals: commit.data.totals };
}

async function byNumber(number: string) {
  const [b] = await db.select().from(bookings).where(eq(bookings.number, number));
  return b;
}

describe.skipIf(!hasTestDb)("Phase 2a history import", () => {
  beforeEach(async () => {
    await truncateAll();
    await ensureDefaultSettings();
  });
  afterAll(closeDb);

  it("imports quotations, bookings, charges, payments and holds; conflicts become pending; re-run changes nothing", async () => {
    const sa = await makeUser("super_admin");
    const buf = await bookingWorkbook({ extraRentalRows: FUTURE });
    const { preview } = await importFile(sa, buf);
    const hist = preview.sections.find((s) => s.section === "history")!;
    // 6 default Rental Log rows + 4 future + 2 WD rows.
    expect(hist.counts).toMatchObject({ new: 12, unchanged: 0 });
    expect(hist.warnings.some((w) => w.message.startsWith("Conflict: QTN-2027-002") && w.message.includes("QTN-2027-001"))).toBe(true);
    expect(hist.warnings.some((w) => w.message.includes("Mystery Car"))).toBe(true);
    const dr = preview.sections.find((s) => s.section === "drivers")!;
    expect(dr.counts.new).toBe(2);

    const qs = Object.fromEntries((await db.select().from(quotations)).map((q) => [q.number, q]));
    expect(Object.keys(qs)).toHaveLength(12);
    expect(qs["QTN-2026-101"]).toMatchObject({ status: "expired", imported: true, kind: "formal" });
    expect(qs["QTN-2026-102"].status).toBe("accepted");
    expect(qs["QTN-2027-004"]).toMatchObject({ status: "issued", totalCentavos: 140000 });
    expect(qs["QTN-WD2026-007"]).toMatchObject({ status: "expired", service: "with_driver" });

    // Past BOOKED / COMPLETED → closed, no hold.
    expect((await byNumber("QTN-2026-102")).status).toBe("closed");
    expect((await byNumber("QTN-2026-103")).status).toBe("closed");
    // Future BOOKED → confirmed with a hold; charges and RF payment from the log.
    const fay = await byNumber("QTN-2027-001");
    expect(fay).toMatchObject({ status: "confirmed", imported: true });
    expect(fay.startAt.toISOString()).toBe(manilaToUtc("2027-01-10", "09:00").toISOString());
    expect(fay.endAt.toISOString()).toBe(manilaToUtc("2027-01-12", "09:00").toISOString());
    const charges = await db.select().from(bookingCharges).where(eq(bookingCharges.bookingId, fay.id));
    expect(charges.reduce((s, c) => s + c.amountCentavos, 0)).toBe(349000);
    const [rf] = await db.select().from(payments).where(eq(payments.bookingId, fay.id));
    expect(rf).toMatchObject({ type: "reservation_fee", amountCentavos: 50000, method: "gcash" });
    const holds = await db.select().from(vehicleHolds).where(eq(vehicleHolds.bookingId, fay.id));
    expect(holds).toHaveLength(1);
    // Overlap → pending with a note naming the winner; unmatched car → pending without vehicle.
    const gil = await byNumber("QTN-2027-002");
    expect(gil.status).toBe("pending_reservation");
    expect(gil.statusNote).toContain("QTN-2027-001");
    const hal = await byNumber("QTN-2027-003");
    expect(hal).toMatchObject({ status: "pending_reservation", vehicleId: null, vehicleLabel: "Mystery Car - ZZZ 9999" });
    expect(await db.select().from(bookings)).toHaveLength(5);
    expect((await db.select().from(vehicleHolds)).length).toBe(1);

    // Drivers seeded.
    const ds = await db.select().from(drivers);
    expect(ds.map((x) => x.name).sort()).toEqual(["Dario Driverson", "Wendy Wheel"]);
    expect(ds.find((x) => x.name === "Dario Driverson")?.phone).toBe("+639170001111");

    // Calendar shows the imported future booking.
    const days = calendarDays("month", "2027-01-01");
    const { from, to } = calendarBounds(days);
    const cal = await calendarData(from, to, calendarFilterSchema.parse({}));
    expect(cal.items.map((i) => i.number)).toContain("QTN-2027-001");
    expect(cal.items.find((i) => i.number === "QTN-2027-002")?.status).toBe("pending_reservation");

    // Past bookings show in the client's history.
    const [ana] = await db.select().from(clients).where(eq(clients.phone, "+639170000001"));
    const h = await clientHistory(ana.id);
    expect(h.bookings.map((b) => b.number)).toContain("QTN-2026-102");
    expect(h.quotations.map((q) => q.number)).toEqual(expect.arrayContaining(["QTN-2026-101", "QTN-2026-102", "QTN-WD2026-007"]));
    expect(h.lifetimeDays).toBeGreaterThan(0);

    // Re-run: nothing new.
    const again = await importFile(sa, buf);
    expect(again.totals).toMatchObject({ new: 0, changed: 0 });
    expect(await db.select().from(bookings)).toHaveLength(5);
    expect(await db.select().from(drivers)).toHaveLength(2);
  });

  it("an imported issued quotation with a matched car converts with its logged lines", async () => {
    const sa = await makeUser("super_admin");
    const sales = await makeUser("sales");
    await importFile(sa, await bookingWorkbook({ extraRentalRows: FUTURE }));
    const [q] = await db.select().from(quotations).where(eq(quotations.number, "QTN-2027-004"));
    const r = await convertToBooking(sales, { quotationId: q.id });
    if (!r.ok) throw new Error(r.error);
    const charges = await db.select().from(bookingCharges).where(eq(bookingCharges.bookingId, r.data.id));
    expect(charges.reduce((s, c) => s + c.amountCentavos, 0)).toBe(140000);
    const p = await addPayment(sales, {
      bookingId: r.data.id,
      type: "reservation_fee",
      amountCentavos: 50000,
      method: "cash",
      collectedByUserId: sales.id,
      paidDate: "2026-11-24",
      paidTime: "10:00",
    });
    expect(p.ok).toBe(true);
    expect((await confirmBooking(sales, { id: r.data.id })).ok).toBe(true);
  });
});

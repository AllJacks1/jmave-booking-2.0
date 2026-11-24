import { hasTestDb } from "./env";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db, type DbOrTx } from "@/db/client";
import { bookings, vehicleBlocks, vehicleHolds, vehicles } from "@/db/schema";
import { pgErrorCode, releaseHold, setHold, VehicleConflictError } from "@/lib/holds";
import { manilaToUtc } from "@/lib/time";
import { truncateAll } from "./helpers";

const BUFFER = 60;
let seq = 0;

async function makeVehicle(name = "Test Sedan") {
  const [v] = await db.insert(vehicles).values({ displayName: name, bodyType: "sedan" }).returning();
  return v;
}

async function makeBooking(tx: DbOrTx, vehicleId: string, startAt: Date, endAt: Date) {
  seq += 1;
  const [b] = await tx
    .insert(bookings)
    .values({ number: `QTN-2099-${String(seq).padStart(3, "0")}`, service: "self_drive", vehicleId, startAt, endAt })
    .returning();
  return b;
}

/** Book [start, end) for the vehicle in its own transaction, with the hold. */
async function book(vehicleId: string, startAt: Date, endAt: Date) {
  return db.transaction(async (tx) => {
    const b = await makeBooking(tx, vehicleId, startAt, endAt);
    await setHold(tx, { bookingId: b.id }, { vehicleId, startAt, endAt, bufferMinutes: BUFFER });
    return b;
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const at = (day: string, time: string) => manilaToUtc(day, time);

describe.skipIf(!hasTestDb)("vehicle holds (PLAN §6.2)", () => {
  beforeEach(truncateAll);
  afterAll(closeDb);

  it("the exclusion constraint exists and btree_gist is installed", async () => {
    const ext = await db.execute(sql`select 1 from pg_extension where extname = 'btree_gist'`);
    expect(ext.length).toBe(1);
    const con = await db.execute(
      sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'vehicle_holds_no_overlap'`,
    );
    expect(String((con[0] as { def: string }).def)).toMatch(/EXCLUDE USING gist .*WHERE \(active\)/);
  });

  it("two concurrent transactions confirming overlapping bookings: exactly one succeeds", async () => {
    const car = await makeVehicle();
    const bothInside = [deferred(), deferred()];
    const run = (i: 0 | 1, start: Date, end: Date) =>
      db.transaction(async (tx) => {
        const b = await makeBooking(tx, car.id, start, end);
        bothInside[i].resolve();
        // Wait until the other transaction is also open and uncommitted.
        await Promise.all(bothInside.map((d) => d.promise));
        await setHold(tx, { bookingId: b.id }, { vehicleId: car.id, startAt: start, endAt: end, bufferMinutes: BUFFER });
        return b.number;
      });

    const results = await Promise.allSettled([
      run(0, at("2026-12-01", "08:00"), at("2026-12-03", "08:00")),
      run(1, at("2026-12-02", "08:00"), at("2026-12-04", "08:00")),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(VehicleConflictError);
    const winner = (ok[0] as PromiseFulfilledResult<string>).value;
    expect((failed[0].reason as VehicleConflictError).conflict?.bookingNumber).toBe(winner);
    expect((failed[0].reason as VehicleConflictError).message).toContain(winner);

    const holds = await db.select().from(vehicleHolds).where(eq(vehicleHolds.vehicleId, car.id));
    expect(holds).toHaveLength(1);
    // The loser's booking row rolled back with its transaction.
    expect(await db.select().from(bookings)).toHaveLength(1);
  });

  it("ten concurrent overlapping confirmations: exactly one hold", async () => {
    const car = await makeVehicle();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        book(car.id, at("2026-12-10", `0${i % 10}:00`), at("2026-12-11", "10:00")),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(VehicleConflictError);
    }
    expect(await db.select().from(vehicleHolds)).toHaveLength(1);
  });

  it("back-to-back bookings separated by the turnaround buffer both succeed", async () => {
    const car = await makeVehicle();
    await book(car.id, at("2026-12-01", "08:00"), at("2026-12-02", "08:00"));
    // Next starts exactly end + 60 min: periods are [) so they only touch.
    await expect(book(car.id, at("2026-12-02", "09:00"), at("2026-12-03", "09:00"))).resolves.toBeTruthy();
  });

  it("a booking starting inside the buffer fails and names the booking", async () => {
    const car = await makeVehicle();
    const first = await book(car.id, at("2026-12-01", "08:00"), at("2026-12-02", "08:00"));
    const err = await book(car.id, at("2026-12-02", "08:59"), at("2026-12-03", "08:00")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VehicleConflictError);
    expect((err as VehicleConflictError).conflict).toMatchObject({ kind: "booking", bookingNumber: first.number });
  });

  it("a booking ending inside the next one's start buffer also fails (its own buffer overlaps)", async () => {
    const car = await makeVehicle();
    await book(car.id, at("2026-12-05", "08:00"), at("2026-12-06", "08:00"));
    // Ends 07:30 → held until 08:30, overlapping the 08:00 start.
    await expect(book(car.id, at("2026-12-04", "08:00"), at("2026-12-05", "07:30"))).rejects.toBeInstanceOf(
      VehicleConflictError,
    );
    await expect(book(car.id, at("2026-12-04", "08:00"), at("2026-12-05", "07:00"))).resolves.toBeTruthy();
  });

  it("other vehicles and released holds do not block", async () => {
    const a = await makeVehicle("Car A");
    const b = await makeVehicle("Car B");
    const first = await book(a.id, at("2026-12-01", "08:00"), at("2026-12-02", "08:00"));
    await expect(book(b.id, at("2026-12-01", "08:00"), at("2026-12-02", "08:00"))).resolves.toBeTruthy();
    await db.transaction((tx) => releaseHold(tx, { bookingId: first.id }));
    await expect(book(a.id, at("2026-12-01", "10:00"), at("2026-12-02", "08:00"))).resolves.toBeTruthy();
  });

  it("blocks hold the car and are named in the conflict", async () => {
    const car = await makeVehicle();
    const [block] = await db
      .insert(vehicleBlocks)
      .values({ vehicleId: car.id, kind: "maintenance", startAt: at("2026-12-01", "00:00"), endAt: at("2026-12-03", "00:00"), reason: "PMS" })
      .returning();
    await db.transaction((tx) =>
      setHold(tx, { blockId: block.id }, { vehicleId: car.id, startAt: block.startAt, endAt: block.endAt, bufferMinutes: 0 }),
    );
    const err = await book(car.id, at("2026-12-02", "08:00"), at("2026-12-04", "08:00")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VehicleConflictError);
    expect((err as VehicleConflictError).conflict).toMatchObject({ kind: "block", blockKind: "maintenance" });
  });

  it("moving a hold re-checks the constraint and leaves the transaction usable", async () => {
    const car = await makeVehicle();
    const first = await book(car.id, at("2026-12-01", "08:00"), at("2026-12-02", "08:00"));
    const second = await book(car.id, at("2026-12-05", "08:00"), at("2026-12-06", "08:00"));
    await db.transaction(async (tx) => {
      await expect(
        setHold(tx, { bookingId: second.id }, { vehicleId: car.id, startAt: at("2026-12-01", "12:00"), endAt: at("2026-12-06", "08:00"), bufferMinutes: BUFFER }),
      ).rejects.toMatchObject({ conflict: { bookingNumber: first.number } });
      // Savepoint rolled back: the transaction can still write.
      await setHold(tx, { bookingId: second.id }, { vehicleId: car.id, startAt: at("2026-12-04", "08:00"), endAt: at("2026-12-06", "08:00"), bufferMinutes: BUFFER });
    });
    const [hold] = await db
      .select({ lower: sql<string>`lower(${vehicleHolds.period})` })
      .from(vehicleHolds)
      .where(eq(vehicleHolds.bookingId, second.id));
    expect(new Date(hold.lower).toISOString()).toBe(at("2026-12-04", "08:00").toISOString());
  });

  it("the database refuses an overlapping active hold even without the service", async () => {
    const car = await makeVehicle();
    const b1 = await book(car.id, at("2026-12-01", "08:00"), at("2026-12-02", "08:00"));
    const b2 = await db.transaction((tx) => makeBooking(tx, car.id, at("2026-12-01", "08:00"), at("2026-12-02", "08:00")));
    const err = await db
      .execute(
        sql`insert into vehicle_holds (vehicle_id, kind, booking_id, period) values (${car.id}, 'booking', ${b2.id}, tstzrange(now(), now() + interval '100 years'))`,
      )
      .catch((e: unknown) => e);
    expect(pgErrorCode(err)).toBe("23P01");
    expect(b1).toBeTruthy();
  });
});

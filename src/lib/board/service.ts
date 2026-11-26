/**
 * Daily Movement board data (bookings-and-movement.md §6): a handful of
 * queries for the day + 5-day look-ahead, then the pure derivation in
 * `src/lib/movements.ts`. Shared by `/board` and the board PDF.
 */
import "server-only";
import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { bookingCharges, bookings, clients, drivers, movementEvents, payments, vehicleBlocks, vehicles } from "@/db/schema";
import { computeLedger, type LedgerPayment } from "@/lib/bookings/ledger";
import {
  BOARD_STATUSES,
  boardRange,
  deriveBoardDay,
  deriveLookAhead,
  type BoardBlock,
  type BoardBooking,
  type BoardInput,
  type BoardVehicle,
} from "@/lib/movements";
import { BODY_TYPES, type BodyType } from "@/lib/pricing/types";
import { rosterForDay } from "@/lib/roster/service";
import type { DateKey } from "@/lib/time";

/** Look back this far for bookings that started earlier and may still touch the range (late returns). */
const LOOK_BACK_MS = 3 * 24 * 60 * 60 * 1000;

export async function boardInput(date: DateKey, now = new Date()): Promise<BoardInput> {
  const { from, to } = boardRange(date);
  const vehicleRows = await db
    .select({
      id: vehicles.id,
      displayName: vehicles.displayName,
      plate: vehicles.plate,
      dailyRateDisplay: vehicles.dailyRateDisplay,
      bodyType: vehicles.bodyType,
      sortOrder: vehicles.sortOrder,
    })
    .from(vehicles)
    .where(eq(vehicles.active, true));
  const order = (b: BodyType | null) => (b ? BODY_TYPES.indexOf(b) : BODY_TYPES.length);
  vehicleRows.sort((a, b) => order(a.bodyType) - order(b.bodyType) || a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));
  const ids = vehicleRows.map((v) => v.id);
  const boardVehicles: BoardVehicle[] = vehicleRows.map(({ id, displayName, plate, dailyRateDisplay }) => ({ id, displayName, plate, dailyRateDisplay }));
  if (ids.length === 0) return { vehicles: [], bookings: [], blocks: [], now };

  const lookBack = new Date(from.getTime() - LOOK_BACK_MS);
  const [bookingRows, blockRows] = await Promise.all([
    db
      .select({
        b: {
          id: bookings.id,
          number: bookings.number,
          vehicleId: bookings.vehicleId,
          service: bookings.service,
          status: bookings.status,
          startAt: bookings.startAt,
          endAt: bookings.endAt,
          destination: bookings.destination,
          deliveryAddress: bookings.deliveryAddress,
          pickupAddress: bookings.pickupAddress,
          notes: bookings.notes,
          showNotesOnBoard: bookings.showNotesOnBoard,
          bookedName: bookings.clientName,
        },
        clientName: clients.fullName,
        driverName: drivers.name,
      })
      .from(bookings)
      .leftJoin(clients, eq(clients.id, bookings.clientId))
      .leftJoin(drivers, eq(drivers.id, bookings.driverId))
      .where(
        and(
          inArray(bookings.vehicleId, ids),
          inArray(bookings.status, [...BOARD_STATUSES]),
          lt(bookings.startAt, to),
          // Ends after the range starts; released cars may be overdue; returned late cars ended up to 3 days earlier.
          or(gt(bookings.endAt, lookBack), eq(bookings.status, "released")),
        ),
      )
      .orderBy(asc(bookings.startAt)),
    db
      .select()
      .from(vehicleBlocks)
      .where(and(inArray(vehicleBlocks.vehicleId, ids), isNull(vehicleBlocks.cancelledAt), lt(vehicleBlocks.startAt, to), gt(vehicleBlocks.endAt, from))),
  ]);

  const bookingIds = bookingRows.map((r) => r.b.id);
  const [events, chargeSums, paymentSums] = bookingIds.length
    ? await Promise.all([
        db
          .select({
            bookingId: movementEvents.bookingId,
            kind: movementEvents.kind,
            actualAt: movementEvents.actualAt,
            odometerKm: movementEvents.odometerKm,
            fuelLevelEighths: movementEvents.fuelLevelEighths,
            previousEndAt: movementEvents.previousEndAt,
            newEndAt: movementEvents.newEndAt,
          })
          .from(movementEvents)
          .where(inArray(movementEvents.bookingId, bookingIds))
          .orderBy(asc(movementEvents.actualAt)),
        db
          .select({ bookingId: bookingCharges.bookingId, total: sql<number>`sum(${bookingCharges.amountCentavos})::int` })
          .from(bookingCharges)
          .where(inArray(bookingCharges.bookingId, bookingIds))
          .groupBy(bookingCharges.bookingId),
        db
          .select({
            bookingId: payments.bookingId,
            type: payments.type,
            direction: payments.direction,
            total: sql<number>`sum(${payments.amountCentavos})::int`,
          })
          .from(payments)
          .where(and(inArray(payments.bookingId, bookingIds), isNull(payments.voidedAt)))
          .groupBy(payments.bookingId, payments.type, payments.direction),
      ])
    : [[], [], []];

  const chargeBy = new Map(chargeSums.map((c) => [c.bookingId, Number(c.total)]));
  const paysBy = new Map<string, LedgerPayment[]>();
  for (const p of paymentSums) {
    const list = paysBy.get(p.bookingId) ?? [];
    list.push({ type: p.type, direction: p.direction, amountCentavos: Number(p.total), voidedAt: null });
    paysBy.set(p.bookingId, list);
  }

  const boardBookings: BoardBooking[] = bookingRows.map(({ b, clientName, driverName }) => {
    const own = events.filter((e) => e.bookingId === b.id);
    const rel = own.find((e) => e.kind === "release");
    const ret = own.find((e) => e.kind === "return");
    const ledger = computeLedger([{ amountCentavos: chargeBy.get(b.id) ?? 0 }], paysBy.get(b.id) ?? []);
    return {
      id: b.id,
      number: b.number,
      vehicleId: b.vehicleId,
      service: b.service,
      status: b.status,
      startAt: b.startAt,
      endAt: b.endAt,
      clientName: clientName ?? b.bookedName,
      destination: b.destination,
      deliveryAddress: b.deliveryAddress,
      pickupAddress: b.pickupAddress,
      driverName,
      notes: b.notes,
      showNotesOnBoard: b.showNotesOnBoard,
      release: rel ? { actualAt: rel.actualAt, odometerKm: rel.odometerKm, fuelLevelEighths: rel.fuelLevelEighths } : null,
      return: ret ? { actualAt: ret.actualAt, odometerKm: ret.odometerKm, fuelLevelEighths: ret.fuelLevelEighths } : null,
      extensions: own.filter((e) => e.kind === "extension").map((e) => ({ actualAt: e.actualAt, previousEndAt: e.previousEndAt, newEndAt: e.newEndAt })),
      balance: ledger.balance,
      depositHeld: ledger.depositHeld,
    };
  });
  const boardBlocks: BoardBlock[] = blockRows.map((k) => ({ id: k.id, vehicleId: k.vehicleId, kind: k.kind, startAt: k.startAt, endAt: k.endAt, reason: k.reason }));
  return { vehicles: boardVehicles, bookings: boardBookings, blocks: boardBlocks, now };
}

/** Everything `/board` shows for a day. */
export async function boardData(date: DateKey, now = new Date()) {
  const [input, roster] = await Promise.all([boardInput(date, now), rosterForDay(date)]);
  return {
    day: deriveBoardDay(input, date),
    lookAhead: deriveLookAhead(input, date),
    roster,
    asOf: now,
  };
}

export type BoardData = Awaited<ReturnType<typeof boardData>>;

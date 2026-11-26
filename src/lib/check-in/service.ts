/**
 * Release / return check-in and extensions (Phase 2b, bookings-and-movement.md §5).
 *
 * - Release (Ops+): confirmed → released, writes a `release` movement event.
 * - Return (Ops+): released → returned, writes a `return` event, adds the
 *   check-in charges (excess km, fuel shortage, late return) and moves the
 *   hold end to actual return + turnaround buffer. `previewReturn` computes
 *   the same charges without writing, so staff see them before saving.
 * - Extension (Sales+): later end on a confirmed/released booking, priced per
 *   hour; the hold moves in the same transaction (conflict → 409).
 *
 * Every write runs in one transaction with its audit row.
 */
import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import {
  bookingCharges,
  bookings,
  movementEvents,
  payments,
  quotations,
  rateCards,
  user,
  vehicles,
  type BookingRow,
} from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { checkTransition } from "@/lib/booking-status";
import { computeLedger } from "@/lib/bookings/ledger";
import { lockBooking } from "@/lib/bookings/service";
import { getHold, setHold, VehicleConflictError } from "@/lib/holds";
import {
  billedDays,
  computeReturnCharges,
  priceExtension,
  rateCardDataSchema,
  type BodyType,
  type PricingBasis,
  type RateCardData,
  type ReturnCharges,
} from "@/lib/pricing";
import { earnForReturn, reverseEarn } from "@/lib/loyalty/ledger";
import { getSettings } from "@/lib/settings/service";
import { manilaToUtc } from "@/lib/time";
import { extensionSchema, FUTURE_TOLERANCE_MINUTES, releaseSchema, returnSchema, undoReturnSchema } from "./schema";

const MINUTE_MS = 60_000;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type PricingContext = {
  card: RateCardData;
  bodyType: BodyType;
  pricingBasis: PricingBasis | null;
  quotedDays: number | null;
  tankCapacityL: number | null;
  fuelType: "gasoline" | "premium" | "diesel";
};

/** Rate card the booking was quoted with (else the active one), body type, quoted days. */
async function pricingContext(tx: DbOrTx, b: BookingRow): Promise<PricingContext> {
  const [v] = b.vehicleId
    ? await tx
        .select({ bodyType: vehicles.bodyType, fuelType: vehicles.fuelType, tank: vehicles.tankCapacityL })
        .from(vehicles)
        .where(eq(vehicles.id, b.vehicleId))
    : [];
  const [q] = b.quotationId
    ? await tx
        .select({ bodyType: quotations.bodyType, inputs: quotations.inputs, rateCardId: quotations.rateCardId })
        .from(quotations)
        .where(eq(quotations.id, b.quotationId))
    : [];
  const bodyType = (v?.bodyType ?? q?.bodyType ?? null) as BodyType | null;
  if (!bodyType) throw new ActionError(409, "The vehicle has no body type. Set it at Fleet first.");

  let cardRow = q?.rateCardId ? (await tx.select({ data: rateCards.data }).from(rateCards).where(eq(rateCards.id, q.rateCardId)))[0] : undefined;
  if (!cardRow) cardRow = (await tx.select({ data: rateCards.data }).from(rateCards).where(eq(rateCards.status, "active")))[0];
  if (!cardRow) throw new ActionError(409, "There is no active rate card.");
  const parsed = rateCardDataSchema.safeParse(cardRow.data);
  if (!parsed.success) throw new ActionError(409, "The rate card is not valid.");

  const inputs = (q?.inputs ?? {}) as { days?: unknown; wdDays?: unknown; pricingBasis?: unknown; imported?: unknown };
  const days = b.service === "self_drive" ? inputs.days : inputs.wdDays;
  const quotedDays = typeof days === "number" && Number.isInteger(days) && days > 0 ? days : null;
  const pricingBasis = inputs.pricingBasis === "renters_fuel" || inputs.pricingBasis === "all_in" ? inputs.pricingBasis : null;
  const fuelType = v?.fuelType ?? (bodyType === "suv" || bodyType === "pickup" || bodyType === "van" ? "diesel" : "gasoline");
  return { card: parsed.data, bodyType, pricingBasis, quotedDays, tankCapacityL: v?.tank ?? null, fuelType };
}

async function releaseEvent(tx: DbOrTx, bookingId: string) {
  const [row] = await tx
    .select()
    .from(movementEvents)
    .where(and(eq(movementEvents.bookingId, bookingId), eq(movementEvents.kind, "release")));
  return row ?? null;
}

async function quotedExcess(tx: DbOrTx, bookingId: string) {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${bookingCharges.amountCentavos}), 0)::int` })
    .from(bookingCharges)
    .where(and(eq(bookingCharges.bookingId, bookingId), eq(bookingCharges.source, "quote"), eq(bookingCharges.code, "excess_km")));
  return Number(row?.total ?? 0);
}

async function ledgerFor(tx: DbOrTx, bookingId: string) {
  const [charges, pays] = await Promise.all([
    tx.select({ amountCentavos: bookingCharges.amountCentavos }).from(bookingCharges).where(eq(bookingCharges.bookingId, bookingId)),
    tx
      .select({ type: payments.type, direction: payments.direction, amountCentavos: payments.amountCentavos, voidedAt: payments.voidedAt })
      .from(payments)
      .where(eq(payments.bookingId, bookingId)),
  ]);
  return computeLedger(charges, pays);
}

function actualInstant(date: string, time: string, now = new Date()): Date {
  const at = manilaToUtc(date, time);
  if (at.getTime() > now.getTime() + FUTURE_TOLERANCE_MINUTES * MINUTE_MS) {
    throw new ActionError(400, "That time is in the future.", { actualTime: ["That time is in the future"] });
  }
  return at;
}

async function nextSortOrder(tx: DbOrTx, bookingId: string) {
  const [{ max }] = await tx
    .select({ max: sql<number>`coalesce(max(${bookingCharges.sortOrder}), -1)` })
    .from(bookingCharges)
    .where(eq(bookingCharges.bookingId, bookingId));
  return Number(max) + 1;
}

async function setStatus(tx: DbOrTx, cur: BookingRow, to: BookingRow["status"]) {
  const [updated] = await tx
    .update(bookings)
    .set({ status: to })
    .where(and(eq(bookings.id, cur.id), eq(bookings.status, cur.status)))
    .returning();
  if (!updated) throw new ActionError(409, "The booking changed meanwhile. Reload and try again.");
  return updated;
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

export const recordRelease = defineAction({
  permission: "movement.check_in",
  input: releaseSchema,
  handler: async (actor, input) => {
    const actualAt = actualInstant(input.actualDate, input.actualTime);
    return db.transaction(async (tx) => {
      const cur = await lockBooking(tx, input.bookingId);
      const check = checkTransition(cur.status, "release");
      if (!check.ok) throw new ActionError(409, cur.status === "pending_reservation" ? "Confirm the booking before releasing the car." : check.error);
      if (!cur.vehicleId) throw new ActionError(409, "The booking has no vehicle.");
      const [ev] = await tx
        .insert(movementEvents)
        .values({
          bookingId: cur.id,
          vehicleId: cur.vehicleId,
          kind: "release",
          plannedAt: cur.startAt,
          actualAt,
          odometerKm: input.odometerKm,
          fuelLevelEighths: input.fuelLevelEighths,
          delivery: input.delivery,
          recordedBy: actor.id,
          notes: input.notes,
        })
        .returning();
      await setStatus(tx, cur, check.to);
      await withAudit(
        actor,
        "booking.release",
        "booking",
        cur.id,
        { status: cur.status },
        { status: check.to, actualAt: actualAt.toISOString(), odometerKm: input.odometerKm, fuelLevelEighths: input.fuelLevelEighths, delivery: input.delivery, eventId: ev.id },
        tx,
      );
      return { id: cur.id, status: check.to };
    });
  },
});

// ---------------------------------------------------------------------------
// Return
// ---------------------------------------------------------------------------

export type ReturnPreview = ReturnCharges & {
  releaseAt: string;
  releaseOdometerKm: number;
  releaseFuelEighths: number;
  billedDays: number;
  graceMinutes: number;
  plannedEndAt: string;
  ledger: { charges: number; balance: number; depositHeld: number };
  /** Balance after these charges are added. */
  balanceAfter: number;
};

async function computeReturn(tx: DbOrTx, cur: BookingRow, input: { odometerKm: number; fuelLevelEighths: number }, actualAt: Date): Promise<ReturnPreview> {
  if (cur.status !== "released") {
    throw new ActionError(409, cur.status === "returned" || cur.status === "closed" ? "This car is already back." : "Release the car before recording its return.");
  }
  const release = await releaseEvent(tx, cur.id);
  if (!release || release.odometerKm === null || release.fuelLevelEighths === null) {
    throw new ActionError(409, "No release check-in is recorded for this booking.");
  }
  if (actualAt <= release.actualAt) {
    throw new ActionError(400, "The return must be after the release.", { actualTime: ["Must be after the release"] });
  }
  if (input.odometerKm < release.odometerKm) {
    throw new ActionError(400, `The odometer cannot be below the release reading (${release.odometerKm.toLocaleString("en-PH")} km).`, {
      odometerKm: [`At least ${release.odometerKm.toLocaleString("en-PH")} km`],
    });
  }
  const [ctx, settings, quoted, ledger] = await Promise.all([pricingContext(tx, cur), getSettings(tx), quotedExcess(tx, cur.id), ledgerFor(tx, cur.id)]);
  const days = billedDays(cur.service, cur.startAt, cur.endAt, ctx.quotedDays);
  const charges = computeReturnCharges(ctx.card, {
    service: cur.service,
    bodyType: ctx.bodyType,
    pricingBasis: ctx.pricingBasis,
    billedDays: days,
    releaseOdometerKm: release.odometerKm,
    returnOdometerKm: input.odometerKm,
    quotedExcessCentavos: quoted,
    tankCapacityL: ctx.tankCapacityL,
    releaseFuelEighths: release.fuelLevelEighths,
    returnFuelEighths: input.fuelLevelEighths,
    fuelPricePerLiter: settings.fuel_prices_centavos[ctx.fuelType],
    plannedEndAt: cur.endAt,
    actualReturnAt: actualAt,
    graceMinutes: settings.late_return_grace_minutes,
  });
  return {
    ...charges,
    releaseAt: release.actualAt.toISOString(),
    releaseOdometerKm: release.odometerKm,
    releaseFuelEighths: release.fuelLevelEighths,
    billedDays: days,
    graceMinutes: settings.late_return_grace_minutes,
    plannedEndAt: cur.endAt.toISOString(),
    ledger: { charges: ledger.charges, balance: ledger.balance, depositHeld: ledger.depositHeld },
    balanceAfter: ledger.balance + charges.total,
  };
}

/** The charges a return would add (no writes). */
export const previewReturn = defineAction({
  permission: "movement.check_in",
  input: returnSchema,
  handler: async (_actor, input) => {
    const actualAt = actualInstant(input.actualDate, input.actualTime);
    const [cur] = await db.select().from(bookings).where(eq(bookings.id, input.bookingId));
    if (!cur) throw new ActionError(404, "Booking not found.");
    return computeReturn(db, cur, input, actualAt);
  },
});

export const recordReturn = defineAction({
  permission: "movement.check_in",
  input: returnSchema,
  handler: async (actor, input) => {
    const actualAt = actualInstant(input.actualDate, input.actualTime);
    return db.transaction(async (tx) => {
      const cur = await lockBooking(tx, input.bookingId);
      const preview = await computeReturn(tx, cur, input, actualAt);
      const check = checkTransition(cur.status, "return");
      if (!check.ok) throw new ActionError(409, check.error);

      const [ev] = await tx
        .insert(movementEvents)
        .values({
          bookingId: cur.id,
          vehicleId: cur.vehicleId,
          kind: "return",
          plannedAt: cur.endAt,
          actualAt,
          odometerKm: input.odometerKm,
          fuelLevelEighths: input.fuelLevelEighths,
          delivery: input.delivery,
          recordedBy: actor.id,
          notes: input.notes,
        })
        .returning();
      if (preview.lines.length) {
        const order = await nextSortOrder(tx, cur.id);
        await tx.insert(bookingCharges).values(
          preview.lines.map((l, i) => ({
            bookingId: cur.id,
            kind: l.kind,
            code: l.code,
            label: `${l.label} · ${l.remark}`,
            amountCentavos: l.amount,
            source: "check_in" as const,
            sortOrder: order + i,
            createdBy: actor.id,
          })),
        );
      }
      await setStatus(tx, cur, check.to);
      const warnings = [...preview.warnings];

      // Rewards: 50 points per billed rental day (pricing.md §4), idempotent per booking.
      const earned = await earnForReturn(tx, actor, cur, preview.billedDays, actualAt);
      if (earned.warning) warnings.push(earned.warning);

      // Hold end = actual return + buffer (PLAN §6.2). A late car may now touch
      // the next booking's hold: keep the return (the car is back) and warn.
      if (cur.vehicleId) {
        const settings = await getSettings(tx);
        const releasedAt = new Date(preview.releaseAt);
        const holdStart = releasedAt < cur.startAt ? releasedAt : cur.startAt;
        try {
          await setHold(tx, { bookingId: cur.id }, { vehicleId: cur.vehicleId, startAt: holdStart, endAt: actualAt, bufferMinutes: settings.turnaround_buffer_minutes });
        } catch (err) {
          if (!(err instanceof VehicleConflictError)) throw err;
          try {
            await setHold(tx, { bookingId: cur.id }, { vehicleId: cur.vehicleId, startAt: holdStart, endAt: actualAt, bufferMinutes: 0 });
            warnings.push(`The turnaround time overlaps the next booking (${err.conflict?.bookingNumber ?? "next hold"}). Prepare the car quickly.`);
          } catch (err2) {
            if (!(err2 instanceof VehicleConflictError)) throw err2;
            warnings.push(`The car came back after the next booking (${err2.conflict?.bookingNumber ?? "next hold"}) was due to start. Tell Sales.`);
          }
        }
      }

      await withAudit(
        actor,
        "booking.return",
        "booking",
        cur.id,
        { status: cur.status },
        {
          status: check.to,
          actualAt: actualAt.toISOString(),
          odometerKm: input.odometerKm,
          fuelLevelEighths: input.fuelLevelEighths,
          delivery: input.delivery,
          eventId: ev.id,
          charges: preview.lines.map((l) => ({ kind: l.kind, amount: l.amount })),
          pointsEarned: earned.points,
        },
        tx,
      );
      return { id: cur.id, status: check.to, charges: preview.lines, total: preview.total, warnings, pointsEarned: earned.points, cardNo: earned.cardNo };
    });
  },
});

// ---------------------------------------------------------------------------
// Undo a return (Admin+, with a reason)
// ---------------------------------------------------------------------------

/**
 * returned → released: removes the return check-in and the charges it added,
 * moves the hold back to the planned end and takes back the points earned.
 * Refused (409) when the planned period now clashes with another hold, or the
 * booking is already closed.
 */
export const undoReturn = defineAction({
  permission: "movement.undo_return",
  input: undoReturnSchema,
  handler: async (actor, { bookingId, reason }) => {
    return db.transaction(async (tx) => {
      const cur = await lockBooking(tx, bookingId);
      if (cur.status !== "returned") {
        throw new ActionError(409, cur.status === "closed" ? "A closed booking cannot be reopened." : "Only a returned booking can have its return undone.");
      }
      const [ret] = await tx
        .select()
        .from(movementEvents)
        .where(and(eq(movementEvents.bookingId, cur.id), eq(movementEvents.kind, "return")));
      const removed = await tx
        .delete(bookingCharges)
        .where(and(eq(bookingCharges.bookingId, cur.id), eq(bookingCharges.source, "check_in")))
        .returning({ code: bookingCharges.code, amountCentavos: bookingCharges.amountCentavos });
      if (ret) await tx.delete(movementEvents).where(eq(movementEvents.id, ret.id));
      await setStatus(tx, cur, "released");

      if (cur.vehicleId) {
        const release = await releaseEvent(tx, cur.id);
        const holdStart = release && release.actualAt < cur.startAt ? release.actualAt : cur.startAt;
        const settings = await getSettings(tx);
        try {
          await setHold(tx, { bookingId: cur.id }, { vehicleId: cur.vehicleId, startAt: holdStart, endAt: cur.endAt, bufferMinutes: settings.turnaround_buffer_minutes });
        } catch (err) {
          if (err instanceof VehicleConflictError) {
            throw new ActionError(409, `The car's planned period now clashes with ${err.conflict?.bookingNumber ?? "another hold"}. Move that booking first.`);
          }
          throw err;
        }
      }
      const pointsReversed = await reverseEarn(tx, actor, cur, reason);
      await withAudit(
        actor,
        "booking.undo_return",
        "booking",
        cur.id,
        {
          status: cur.status,
          returnEvent: ret ? { actualAt: ret.actualAt.toISOString(), odometerKm: ret.odometerKm, fuelLevelEighths: ret.fuelLevelEighths } : null,
          charges: removed,
        },
        { status: "released", reason, pointsReversed },
        tx,
      );
      return { id: cur.id, status: "released" as const, chargesRemoved: removed.length, pointsReversed };
    });
  },
});

// ---------------------------------------------------------------------------
// Extension (Sales+)
// ---------------------------------------------------------------------------

async function extensionContext(tx: DbOrTx, cur: BookingRow, newEndAt: Date) {
  if (cur.status !== "confirmed" && cur.status !== "released") {
    throw new ActionError(409, "Only a confirmed or released booking can be extended.");
  }
  if (!(newEndAt > cur.endAt)) {
    throw new ActionError(400, "The new return must be after the current return.", { newEndTime: ["Must be after the current return"] });
  }
  const ctx = await pricingContext(tx, cur);
  return priceExtension(ctx.card, { service: cur.service, bodyType: ctx.bodyType, pricingBasis: ctx.pricingBasis, currentEndAt: cur.endAt, newEndAt });
}

export const previewExtension = defineAction({
  permission: "bookings.manage",
  input: extensionSchema,
  handler: async (_actor, input) => {
    const newEndAt = manilaToUtc(input.newEndDate, input.newEndTime);
    const [cur] = await db.select().from(bookings).where(eq(bookings.id, input.bookingId));
    if (!cur) throw new ActionError(404, "Booking not found.");
    return extensionContext(db, cur, newEndAt);
  },
});

export const extendBooking = defineAction({
  permission: "bookings.manage",
  input: extensionSchema,
  handler: async (actor, input) => {
    const newEndAt = manilaToUtc(input.newEndDate, input.newEndTime);
    return db.transaction(async (tx) => {
      const cur = await lockBooking(tx, input.bookingId);
      const price = await extensionContext(tx, cur, newEndAt);
      if (!cur.vehicleId) throw new ActionError(409, "The booking has no vehicle.");
      const [updated] = await tx.update(bookings).set({ endAt: newEndAt }).where(eq(bookings.id, cur.id)).returning();
      const settings = await getSettings(tx);
      try {
        await setHold(tx, { bookingId: cur.id }, { vehicleId: cur.vehicleId, startAt: updated.startAt, endAt: newEndAt, bufferMinutes: settings.turnaround_buffer_minutes });
      } catch (err) {
        if (err instanceof VehicleConflictError) throw new ActionError(409, err.message);
        throw err;
      }
      const [ev] = await tx
        .insert(movementEvents)
        .values({
          bookingId: cur.id,
          vehicleId: cur.vehicleId,
          kind: "extension",
          plannedAt: newEndAt,
          actualAt: new Date(),
          previousEndAt: cur.endAt,
          newEndAt,
          recordedBy: actor.id,
          notes: input.note,
        })
        .returning();
      if (price.amount > 0) {
        await tx.insert(bookingCharges).values({
          bookingId: cur.id,
          kind: "extension",
          code: "extension",
          label: `${price.label} · ${price.remark}`,
          amountCentavos: price.amount,
          source: "manual",
          sortOrder: await nextSortOrder(tx, cur.id),
          createdBy: actor.id,
        });
      }
      await withAudit(
        actor,
        "booking.extended",
        "booking",
        cur.id,
        { endAt: cur.endAt.toISOString() },
        { endAt: newEndAt.toISOString(), hours: price.hours, amount: price.amount, eventId: ev.id, note: input.note },
        tx,
      );
      return { id: cur.id, hours: price.hours, amount: price.amount };
    });
  },
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Movement events of a booking, oldest first, with who recorded them. */
export async function bookingMovements(bookingId: string) {
  return db
    .select({ e: movementEvents, recordedByName: user.displayName })
    .from(movementEvents)
    .leftJoin(user, eq(user.id, movementEvents.recordedBy))
    .where(eq(movementEvents.bookingId, bookingId))
    .orderBy(asc(movementEvents.actualAt), asc(movementEvents.createdAt))
    .then((rows) => rows.map((r) => ({ ...r.e, recordedByName: r.recordedByName })));
}

/** What a check-in form needs: the booking, vehicle, release reading, hold. */
export async function checkInView(bookingId: string) {
  const [row] = await db
    .select({
      b: bookings,
      vehicleName: vehicles.displayName,
      plate: vehicles.plate,
      tank: vehicles.tankCapacityL,
    })
    .from(bookings)
    .leftJoin(vehicles, eq(vehicles.id, bookings.vehicleId))
    .where(eq(bookings.id, bookingId));
  if (!row) return null;
  const [events, hold, lastOdo] = await Promise.all([
    bookingMovements(bookingId),
    getHold(db, { bookingId }),
    row.b.vehicleId
      ? db
          .select({ odometerKm: movementEvents.odometerKm, actualAt: movementEvents.actualAt })
          .from(movementEvents)
          .where(and(eq(movementEvents.vehicleId, row.b.vehicleId), sql`${movementEvents.odometerKm} is not null`))
          .orderBy(desc(movementEvents.actualAt))
          .limit(1)
          .then((r) => r[0] ?? null)
      : null,
  ]);
  return {
    booking: row.b,
    vehicleName: row.vehicleName ?? row.b.vehicleLabel,
    plate: row.plate,
    tankCapacityL: row.tank,
    release: events.find((e) => e.kind === "release") ?? null,
    return: events.find((e) => e.kind === "return") ?? null,
    events,
    hold,
    lastOdometerKm: lastOdo?.odometerKm ?? null,
  };
}

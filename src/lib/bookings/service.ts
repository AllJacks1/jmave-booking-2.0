/**
 * Bookings (Phase 2a): convert from a quotation, edit, confirm / cancel /
 * no-show / close, payments ledger, manual charges, driver assignment.
 *
 * Every write runs in one transaction with its `audit_log` row. The vehicle
 * hold (PLAN §6.2) is created, moved or released in the same transaction as
 * the status change, so a refused hold rolls the whole change back.
 */
import "server-only";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import {
  bookingCharges,
  bookings,
  clients,
  drivers,
  payments,
  quotations,
  user,
  vehicles,
  type BookingRow,
} from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { checkTransition, holdsVehicle, paymentsOpen, releasesHold, scheduleEditable, detailsEditable, type BookingEvent } from "@/lib/booking-status";
import { releaseHold, setHold, turnaroundBufferMinutes, VehicleConflictError } from "@/lib/holds";
import { can } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { effectiveStatus } from "@/lib/quotes/document";
import type { QuoteResult } from "@/lib/quotes/engine";
import { manilaToUtc } from "@/lib/time";
import { checkAvailability } from "./availability";
import { chargesFromImported, chargesFromQuoteResult, type ImportedQuotationData } from "./charges";
import { computeLedger, hasReservationFee } from "./ledger";
import {
  applyDepositSchema,
  assignDriverSchema,
  availabilitySchema,
  bookingDetailsSchema,
  bookingIdSchema,
  bookingScheduleSchema,
  chargeSchema,
  confirmSchema,
  convertSchema,
  optionalReasonSchema,
  paymentSchema,
  reasonSchema,
} from "./schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function lockBooking(tx: DbOrTx, id: string): Promise<BookingRow> {
  const [row] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
  if (!row) throw new ActionError(404, "Booking not found.");
  return row;
}

function conflictToActionError(err: unknown): never {
  if (err instanceof VehicleConflictError) throw new ActionError(409, err.message);
  throw err;
}

async function bufferMinutes(tx: DbOrTx) {
  return turnaroundBufferMinutes(tx);
}

async function holdFor(tx: DbOrTx, b: Pick<BookingRow, "id" | "vehicleId" | "startAt" | "endAt">) {
  if (!b.vehicleId) throw new ActionError(409, "Choose a vehicle first.");
  try {
    await setHold(tx, { bookingId: b.id }, { vehicleId: b.vehicleId, startAt: b.startAt, endAt: b.endAt, bufferMinutes: await bufferMinutes(tx) });
  } catch (err) {
    conflictToActionError(err);
  }
}

/** Statuses that count as a real rental for "repeat client" (PLAN §7 2026-11-23). */
const RENTED_STATUSES = ["confirmed", "released", "returned", "closed"] as const;

/**
 * Keep `clients.first_rental_at` in step with bookings: earliest start of a
 * confirmed/released/returned/closed booking. Called after confirm, cancel,
 * no-show and schedule changes.
 */
export async function syncFirstRental(tx: DbOrTx, clientId: string | null) {
  if (!clientId) return;
  const [row] = await tx
    .select({ first: sql<string | null>`min(${bookings.startAt})` })
    .from(bookings)
    .where(and(eq(bookings.clientId, clientId), inArray(bookings.status, [...RENTED_STATUSES])));
  const first = row?.first ? new Date(row.first) : null;
  await tx.update(clients).set({ firstRentalAt: first }).where(eq(clients.id, clientId));
}

async function ledgerFor(tx: DbOrTx, bookingId: string) {
  const [charges, pays] = await Promise.all([
    tx.select({ amountCentavos: bookingCharges.amountCentavos }).from(bookingCharges).where(eq(bookingCharges.bookingId, bookingId)),
    tx
      .select({ type: payments.type, direction: payments.direction, amountCentavos: payments.amountCentavos, voidedAt: payments.voidedAt })
      .from(payments)
      .where(eq(payments.bookingId, bookingId)),
  ]);
  return { ledger: computeLedger(charges, pays), hasRf: hasReservationFee(pays) };
}

function snapshot(b: BookingRow) {
  return {
    status: b.status,
    vehicleId: b.vehicleId,
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    driverId: b.driverId,
  };
}

// ---------------------------------------------------------------------------
// Convert an issued formal quotation into a booking
// ---------------------------------------------------------------------------

export const convertToBooking = defineAction({
  permission: "bookings.manage",
  input: convertSchema,
  handler: async (actor, { quotationId }) => {
    return db.transaction(async (tx) => {
      const [q] = await tx.select().from(quotations).where(eq(quotations.id, quotationId)).for("update");
      if (!q) throw new ActionError(404, "Quotation not found.");
      if (q.kind !== "formal" || !q.number) throw new ActionError(409, "Only formal quotations can become bookings.");
      const eff = effectiveStatus(q);
      if (eff === "expired") throw new ActionError(409, "This quotation has expired. Revise it to issue an updated one.");
      // Issued, or accepted earlier with "Mark accepted" (Phase 1c) and no booking yet.
      if (q.status !== "issued" && q.status !== "accepted") throw new ActionError(409, "Only issued quotations can become bookings.");
      if (!q.vehicleId) throw new ActionError(409, "Choose a specific vehicle on the quotation (revise it) before converting.");
      if (!q.clientId) throw new ActionError(409, "The quotation has no client.");
      if ((!q.result && !q.imported) || !q.startAt || !q.endAt) throw new ActionError(409, "The quotation has no priced result.");
      const [existing] = await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.quotationId, q.id));
      if (existing) throw new ActionError(409, "This quotation already has a booking.");

      const inputs = q.inputs as { destination?: string };
      const imported = q.imported ? (q.importedData as ImportedQuotationData | null) : null;
      const [b] = await tx
        .insert(bookings)
        .values({
          number: q.number,
          quotationId: q.id,
          clientId: q.clientId,
          clientName: q.clientName,
          vehicleId: q.vehicleId,
          service: q.service,
          status: "pending_reservation",
          startAt: q.startAt,
          endAt: q.endAt,
          destination: (imported ? imported.destination : inputs.destination?.trim()) || null,
          createdBy: actor.id,
        })
        .returning();
      const charges = q.imported ? chargesFromImported(imported) : chargesFromQuoteResult(q.result as QuoteResult);
      if (charges.length) {
        await tx.insert(bookingCharges).values(charges.map((c) => ({ ...c, bookingId: b.id, createdBy: actor.id })));
      }
      if (q.status === "issued") {
        await tx.update(quotations).set({ status: "accepted" }).where(eq(quotations.id, q.id));
        await withAudit(actor, "quotation.accepted", "quotation", q.id, { status: "issued" }, { status: "accepted", bookingId: b.id }, tx);
      }
      await withAudit(actor, "booking.created", "booking", b.id, null, { ...snapshot(b), number: b.number, quotationId: q.id, charges: charges.length }, tx);
      return { id: b.id, number: b.number };
    });
  },
});

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export const updateBookingDetails = defineAction({
  permission: "bookings.manage",
  input: bookingDetailsSchema,
  handler: async (actor, { id, ...fields }) => {
    return db.transaction(async (tx) => {
      const cur = await lockBooking(tx, id);
      if (!detailsEditable(cur.status)) throw new ActionError(409, "A cancelled or no-show booking cannot be edited.");
      const before = Object.fromEntries(Object.keys(fields).map((k) => [k, cur[k as keyof BookingRow]]));
      await tx.update(bookings).set(fields).where(eq(bookings.id, id));
      await withAudit(actor, "booking.updated", "booking", id, before, fields, tx);
      return { id };
    });
  },
});

export const updateBookingSchedule = defineAction({
  permission: "bookings.manage",
  input: bookingScheduleSchema,
  handler: async (actor, { id, vehicleId, startDate, startTime, endDate, endTime }) => {
    const startAt = manilaToUtc(startDate, startTime);
    const endAt = manilaToUtc(endDate, endTime);
    if (!(endAt > startAt)) throw new ActionError(400, "Return must be after release.", { endTime: ["Return must be after release"] });
    return db.transaction(async (tx) => {
      const cur = await lockBooking(tx, id);
      if (!scheduleEditable(cur.status)) throw new ActionError(409, "The schedule can only change before the car is released.");
      const [v] = await tx.select({ id: vehicles.id, active: vehicles.active }).from(vehicles).where(eq(vehicles.id, vehicleId));
      if (!v) throw new ActionError(400, "Vehicle not found.", { vehicleId: ["Vehicle not found"] });
      const [updated] = await tx.update(bookings).set({ vehicleId, startAt, endAt }).where(eq(bookings.id, id)).returning();
      if (holdsVehicle(cur.status)) await holdFor(tx, updated);
      await syncFirstRental(tx, cur.clientId);
      await withAudit(actor, "booking.rescheduled", "booking", id, snapshot(cur), snapshot(updated), tx);
      return { id };
    });
  },
});

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

async function transition(
  tx: DbOrTx,
  actor: CurrentUser,
  cur: BookingRow,
  event: BookingEvent,
  extra: Partial<BookingRow> = {},
  auditExtra: Record<string, unknown> = {},
) {
  const { ledger, hasRf } = await ledgerFor(tx, cur.id);
  const check = checkTransition(cur.status, event, {
    hasVehicle: Boolean(cur.vehicleId),
    hasReservationFee: hasRf,
    confirmWithoutRf: (auditExtra.confirmWithoutRf as { allowed: boolean; reason: string } | undefined) ?? null,
    balance: ledger.balance,
    depositHeld: ledger.depositHeld,
  });
  if (!check.ok) throw new ActionError(check.status, check.error);
  const [updated] = await tx
    .update(bookings)
    .set({ ...extra, status: check.to })
    .where(and(eq(bookings.id, cur.id), eq(bookings.status, cur.status)))
    .returning();
  if (!updated) throw new ActionError(409, "The booking changed meanwhile. Reload and try again.");
  if (event === "confirm") await holdFor(tx, updated);
  if (releasesHold(event)) await releaseHold(tx, { bookingId: cur.id });
  if (event === "confirm" || event === "cancel" || event === "no_show") await syncFirstRental(tx, cur.clientId);
  const { confirmWithoutRf: _omit, ...rest } = auditExtra;
  void _omit;
  await withAudit(actor, `booking.${event}`, "booking", cur.id, { status: cur.status }, { status: check.to, ...rest }, tx);
  return updated;
}

export const confirmBooking = defineAction({
  permission: "bookings.confirm",
  input: confirmSchema,
  handler: async (actor, { id, withoutRf, withoutRfReason }) => {
    return db.transaction(async (tx) => {
      const cur = await lockBooking(tx, id);
      const { hasRf } = await ledgerFor(tx, id);
      const skipRf = !hasRf && withoutRf;
      const updated = await transition(
        tx,
        actor,
        cur,
        "confirm",
        {
          confirmedBy: actor.id,
          confirmedAt: new Date(),
          confirmWithoutRfReason: skipRf ? withoutRfReason : null,
        },
        {
          confirmWithoutRf: withoutRf ? { allowed: can(actor, "bookings.confirm_without_rf"), reason: withoutRfReason } : undefined,
          ...(skipRf ? { withoutRfReason } : {}),
        },
      );
      return { id: updated.id, status: updated.status };
    });
  },
});

export const cancelBooking = defineAction({
  permission: "bookings.manage",
  input: reasonSchema,
  handler: async (actor, { id, reason }) => {
    return db.transaction(async (tx) => {
      const cur = await lockBooking(tx, id);
      const updated = await transition(tx, actor, cur, "cancel", { statusNote: reason }, { reason });
      return { id: updated.id, status: updated.status };
    });
  },
});

export const markNoShow = defineAction({
  permission: "bookings.manage",
  input: optionalReasonSchema,
  handler: async (actor, { id, reason }) => {
    return db.transaction(async (tx) => {
      const cur = await lockBooking(tx, id);
      const updated = await transition(tx, actor, cur, "no_show", { statusNote: reason || "Client did not show" }, { reason });
      return { id: updated.id, status: updated.status };
    });
  },
});

export const closeBooking = defineAction({
  permission: "bookings.manage",
  input: bookingIdSchema,
  handler: async (actor, { id }) => {
    return db.transaction(async (tx) => {
      const cur = await lockBooking(tx, id);
      const updated = await transition(tx, actor, cur, "close");
      return { id: updated.id, status: updated.status };
    });
  },
});

// ---------------------------------------------------------------------------
// Payments ledger
// ---------------------------------------------------------------------------

export const addPayment = defineAction({
  permission: "payments.add",
  input: paymentSchema,
  handler: async (actor, input) => {
    return db.transaction(async (tx) => {
      const cur = await lockBooking(tx, input.bookingId);
      if (!paymentsOpen(cur.status)) throw new ActionError(409, "This booking is closed for payments.");
      if (input.collectedByUserId) {
        const [u] = await tx.select({ id: user.id }).from(user).where(eq(user.id, input.collectedByUserId));
        if (!u) throw new ActionError(400, "Staff member not found.", { collectedByUserId: ["Not found"] });
      }
      const [row] = await tx
        .insert(payments)
        .values({
          bookingId: input.bookingId,
          type: input.type,
          direction: input.direction,
          amountCentavos: input.amountCentavos,
          method: input.method,
          reference: input.reference,
          collectedByUserId: input.collectedByUserId,
          collectedByName: input.collectedByUserId ? null : input.collectedByName,
          paidAt: manilaToUtc(input.paidDate, input.paidTime),
          note: input.note,
          createdBy: actor.id,
        })
        .returning();
      await withAudit(actor, "payment.added", "payment", row.id, null, { ...row, bookingNumber: cur.number }, tx);
      return { id: row.id };
    });
  },
});

export const voidPayment = defineAction({
  permission: "payments.void",
  input: reasonSchema,
  handler: async (actor, { id, reason }) => {
    return db.transaction(async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
      if (!p) throw new ActionError(404, "Payment not found.");
      if (p.voidedAt) throw new ActionError(409, "This entry is already void.");
      const [b] = await tx.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, p.bookingId));
      if (b?.status === "closed") throw new ActionError(409, "The booking is closed.");
      await tx.update(payments).set({ voidedAt: new Date(), voidedBy: actor.id, voidReason: reason }).where(eq(payments.id, id));
      await withAudit(actor, "payment.voided", "payment", id, { voidedAt: null }, { voidReason: reason }, tx);
      return { id };
    });
  },
});

/**
 * Apply (part of) the deposit to the balance: a `deposit_refund` out and a
 * matching `rental` in, so the §3 formulas stay as they are.
 */
export const applyDeposit = defineAction({
  permission: "payments.add",
  input: applyDepositSchema,
  handler: async (actor, { bookingId, amountCentavos }) => {
    return db.transaction(async (tx) => {
      const cur = await lockBooking(tx, bookingId);
      if (!paymentsOpen(cur.status)) throw new ActionError(409, "This booking is closed for payments.");
      const { ledger } = await ledgerFor(tx, bookingId);
      if (amountCentavos > ledger.depositHeld) throw new ActionError(409, "That is more than the deposit held.");
      if (amountCentavos > ledger.balance) throw new ActionError(409, "That is more than the balance.");
      const now = new Date();
      const note = "Deposit applied to balance";
      const rows = await tx
        .insert(payments)
        .values([
          { bookingId, type: "deposit_refund", direction: "out", amountCentavos, method: "other", collectedByUserId: actor.id, paidAt: now, note, createdBy: actor.id },
          { bookingId, type: "rental", direction: "in", amountCentavos, method: "other", collectedByUserId: actor.id, paidAt: now, note, createdBy: actor.id },
        ])
        .returning({ id: payments.id });
      await withAudit(actor, "payment.deposit_applied", "booking", bookingId, null, { amountCentavos, paymentIds: rows.map((r) => r.id) }, tx);
      return { ids: rows.map((r) => r.id) };
    });
  },
});

// ---------------------------------------------------------------------------
// Manual charges
// ---------------------------------------------------------------------------

export const addCharge = defineAction({
  permission: "bookings.manage",
  input: chargeSchema,
  handler: async (actor, { bookingId, kind, label, amountCentavos }) => {
    return db.transaction(async (tx) => {
      const cur = await lockBooking(tx, bookingId);
      if (!paymentsOpen(cur.status)) throw new ActionError(409, "This booking is closed.");
      const [{ max }] = await tx
        .select({ max: sql<number>`coalesce(max(${bookingCharges.sortOrder}), -1)` })
        .from(bookingCharges)
        .where(eq(bookingCharges.bookingId, bookingId));
      const [row] = await tx
        .insert(bookingCharges)
        .values({ bookingId, kind, label, amountCentavos, source: "manual", sortOrder: Number(max) + 1, createdBy: actor.id })
        .returning();
      await withAudit(actor, "charge.added", "booking", bookingId, null, row, tx);
      return { id: row.id };
    });
  },
});

export const removeCharge = defineAction({
  permission: "bookings.manage",
  input: reasonSchema,
  handler: async (actor, { id, reason }) => {
    return db.transaction(async (tx) => {
      const [c] = await tx.select().from(bookingCharges).where(eq(bookingCharges.id, id));
      if (!c) throw new ActionError(404, "Charge not found.");
      if (c.source !== "manual") throw new ActionError(409, "Only manual charges can be removed.");
      const cur = await lockBooking(tx, c.bookingId);
      if (!paymentsOpen(cur.status)) throw new ActionError(409, "This booking is closed.");
      await tx.delete(bookingCharges).where(eq(bookingCharges.id, id));
      await withAudit(actor, "charge.removed", "booking", c.bookingId, c, { reason }, tx);
      return { id };
    });
  },
});

// ---------------------------------------------------------------------------
// Drivers on With Driver bookings (§8)
// ---------------------------------------------------------------------------

const DRIVER_BUSY_STATUSES = ["pending_reservation", "confirmed", "released"] as const;

/** Other With Driver bookings of this driver overlapping [startAt, endAt). */
export async function driverOverlaps(executor: DbOrTx, driverId: string, startAt: Date, endAt: Date, excludeBookingId?: string) {
  return executor
    .select({ id: bookings.id, number: bookings.number })
    .from(bookings)
    .where(
      and(
        eq(bookings.driverId, driverId),
        eq(bookings.service, "with_driver"),
        inArray(bookings.status, [...DRIVER_BUSY_STATUSES]),
        sql`${bookings.startAt} < ${endAt.toISOString()}::timestamptz`,
        sql`${bookings.endAt} > ${startAt.toISOString()}::timestamptz`,
        excludeBookingId ? ne(bookings.id, excludeBookingId) : undefined,
      ),
    )
    .orderBy(asc(bookings.startAt));
}

export const assignDriver = defineAction({
  permission: "drivers.manage",
  input: assignDriverSchema,
  handler: async (actor, { id, driverId, overrideReason }) => {
    return db.transaction(async (tx) => {
      const cur = await lockBooking(tx, id);
      if (cur.service !== "with_driver") throw new ActionError(409, "Drivers are assigned to With Driver bookings only.");
      if (!detailsEditable(cur.status) || cur.status === "closed") throw new ActionError(409, "This booking can no longer change.");
      let reason: string | null = null;
      if (driverId) {
        const [d] = await tx.select({ id: drivers.id, active: drivers.active }).from(drivers).where(eq(drivers.id, driverId));
        if (!d) throw new ActionError(400, "Driver not found.");
        if (!d.active) throw new ActionError(409, "This driver is inactive.");
        const clash = await driverOverlaps(tx, driverId, cur.startAt, cur.endAt, id);
        if (clash.length) {
          const numbers = clash.map((c) => c.number).join(", ");
          if (!can(actor, "drivers.override_overlap")) {
            throw new ActionError(409, `This driver already has an overlapping trip (${numbers}).`);
          }
          if (!overrideReason) {
            throw new ActionError(409, `This driver already has an overlapping trip (${numbers}). Give a reason to assign anyway.`, {
              overrideReason: ["Give a reason to assign anyway"],
            });
          }
          reason = overrideReason;
        }
      }
      await tx.update(bookings).set({ driverId, driverOverlapReason: reason }).where(eq(bookings.id, id));
      await withAudit(actor, "booking.driver_assigned", "booking", id, { driverId: cur.driverId }, { driverId, overrideReason: reason }, tx);
      return { id };
    });
  },
});

// ---------------------------------------------------------------------------
// Availability (quotation + booking forms)
// ---------------------------------------------------------------------------

export const availabilityAction = defineAction({
  permission: "quotes.manage",
  input: availabilitySchema,
  handler: async (_actor, { vehicleId, startAt, endAt, excludeBookingId }) => {
    const s = new Date(startAt);
    const e = new Date(endAt);
    if (!(e > s)) throw new ActionError(400, "Return must be after release.");
    return checkAvailability(db, { vehicleId, startAt: s, endAt: e, excludeBookingId });
  },
});

/** Unvoided payments for a booking (oldest first). Exported for tests. */
export async function bookingPayments(bookingId: string) {
  return db.select().from(payments).where(and(eq(payments.bookingId, bookingId), isNull(payments.voidedAt))).orderBy(asc(payments.paidAt));
}

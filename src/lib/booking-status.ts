/**
 * Booking state machine (docs/reference/bookings-and-movement.md §2). Pure.
 *
 *   pending_reservation ─confirm→ confirmed ─release→ released ─return→ returned ─close→ closed
 *   pending_reservation / confirmed ─cancel→ cancelled
 *   confirmed ─no_show→ no_show
 *
 * Server actions call `checkTransition` and act on its answer; release and
 * return actions arrive in Phase 2b but the table already has them.
 */
import type { BookingStatus } from "@/lib/bookings/constants";

export const BOOKING_EVENTS = ["confirm", "release", "return", "close", "cancel", "no_show"] as const;
export type BookingEvent = (typeof BOOKING_EVENTS)[number];

export const TRANSITIONS: Record<BookingStatus, Partial<Record<BookingEvent, BookingStatus>>> = {
  pending_reservation: { confirm: "confirmed", cancel: "cancelled" },
  confirmed: { release: "released", cancel: "cancelled", no_show: "no_show" },
  released: { return: "returned" },
  returned: { close: "closed" },
  closed: {},
  cancelled: {},
  no_show: {},
};

export const EVENT_LABELS: Record<BookingEvent, string> = {
  confirm: "Confirm",
  release: "Release",
  return: "Return",
  close: "Close",
  cancel: "Cancel",
  no_show: "No-show",
};

export function nextStatus(from: BookingStatus, event: BookingEvent): BookingStatus | null {
  return TRANSITIONS[from][event] ?? null;
}

export function allowedEvents(from: BookingStatus): BookingEvent[] {
  return Object.keys(TRANSITIONS[from]) as BookingEvent[];
}

/** Statuses whose booking owns an active vehicle hold (PLAN §6.2). Pending never holds. */
export function holdsVehicle(status: BookingStatus): boolean {
  return status === "confirmed" || status === "released" || status === "returned";
}

/** Events after which the hold becomes inactive. */
export function releasesHold(event: BookingEvent): boolean {
  return event === "cancel" || event === "no_show" || event === "close";
}

/** Vehicle and schedule may change only before the car leaves. */
export function scheduleEditable(status: BookingStatus): boolean {
  return status === "pending_reservation" || status === "confirmed";
}

/** Booking details (addresses, IDs, notes, OR issued…) stay editable until cancelled / no-show. */
export function detailsEditable(status: BookingStatus): boolean {
  return status !== "cancelled" && status !== "no_show";
}

/** Payments may be added while the booking is live (and after close, for late corrections: no). */
export function paymentsOpen(status: BookingStatus): boolean {
  return status !== "closed" && status !== "cancelled" && status !== "no_show";
}

export type TransitionContext = {
  /** At least one non-voided reservation_fee payment. */
  hasReservationFee?: boolean;
  /** Admin+ "confirm without RF" with a non-empty reason. */
  confirmWithoutRf?: { allowed: boolean; reason: string } | null;
  hasVehicle?: boolean;
  /** Centavos (see ledger.ts). */
  balance?: number;
  depositHeld?: number;
};

export type TransitionCheck =
  | { ok: true; to: BookingStatus }
  | { ok: false; status: 403 | 409 | 400; error: string };

/** Is `event` allowed from `from`, given the §2 rules? */
export function checkTransition(from: BookingStatus, event: BookingEvent, ctx: TransitionContext = {}): TransitionCheck {
  const to = nextStatus(from, event);
  if (!to) {
    return { ok: false, status: 409, error: `A ${from.replace("_", " ")} booking cannot be ${pastTense(event)}.` };
  }
  if (event === "confirm") {
    if (!ctx.hasVehicle) return { ok: false, status: 409, error: "Choose a vehicle before confirming." };
    if (!ctx.hasReservationFee) {
      const o = ctx.confirmWithoutRf;
      if (!o) return { ok: false, status: 409, error: "Record the reservation fee payment before confirming." };
      if (!o.allowed) return { ok: false, status: 403, error: "Only Admin can confirm without a reservation fee." };
      if (!o.reason.trim()) return { ok: false, status: 400, error: "Give a reason for confirming without a reservation fee." };
    }
  }
  if (event === "close") {
    if ((ctx.balance ?? 0) !== 0) return { ok: false, status: 409, error: "The balance must be zero to close." };
    if ((ctx.depositHeld ?? 0) !== 0) return { ok: false, status: 409, error: "Refund or apply the deposit before closing." };
  }
  return { ok: true, to };
}

function pastTense(event: BookingEvent): string {
  switch (event) {
    case "confirm":
      return "confirmed";
    case "release":
      return "released";
    case "return":
      return "returned";
    case "close":
      return "closed";
    case "cancel":
      return "cancelled";
    case "no_show":
      return "marked as no-show";
  }
}

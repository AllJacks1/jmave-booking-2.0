/**
 * Availability of one vehicle for a time window (Phase 2a brief item 6):
 * "Available", "Overlaps pending reservation QTN-…" (warning) or
 * "Booked by QTN-…" / blocked (error on confirm).
 *
 * The window is compared with the turnaround buffer added, exactly as the
 * hold would be stored. Pending reservations never hold the car; they only warn.
 */
import "server-only";
import { and, eq, lt, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { bookings } from "@/db/schema";
import { findOverlappingHolds, heldUntil, turnaroundBufferMinutes } from "@/lib/holds";
import type { Availability } from "./format";

export type { Availability };

export async function checkAvailability(
  executor: DbOrTx,
  opts: { vehicleId: string; startAt: Date; endAt: Date; excludeBookingId?: string | null },
): Promise<Availability> {
  const buffer = await turnaroundBufferMinutes(executor);
  const end = heldUntil(opts.endAt, buffer);
  const exclude = opts.excludeBookingId ? { bookingId: opts.excludeBookingId } : undefined;
  const [conflict] = await findOverlappingHolds(executor, opts.vehicleId, opts.startAt, end, exclude);

  // Pending reservations: their own window + buffer overlaps ours.
  const pending = await executor
    .select({ id: bookings.id, number: bookings.number })
    .from(bookings)
    .where(
      and(
        eq(bookings.vehicleId, opts.vehicleId),
        eq(bookings.status, "pending_reservation"),
        lt(bookings.startAt, end),
        sql`${bookings.endAt} + make_interval(mins => ${buffer}) > ${opts.startAt.toISOString()}::timestamptz`,
        opts.excludeBookingId ? ne(bookings.id, opts.excludeBookingId) : undefined,
      ),
    )
    .orderBy(bookings.startAt);

  if (conflict) return { state: "booked", conflict, pending };
  if (pending.length) return { state: "pending_overlap", pending };
  return { state: "available" };
}

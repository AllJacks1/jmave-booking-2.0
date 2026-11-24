/**
 * Vehicle holds (PLAN §6.2): the only thing that stops double booking.
 *
 * Every confirmed/released booking and every vehicle block owns one row in
 * `vehicle_holds`. The exclusion constraint `vehicle_holds_no_overlap` refuses
 * two overlapping active periods for one vehicle, even under concurrent
 * requests. Functions here run inside the caller's transaction; each write runs
 * in a savepoint so a conflict can be reported (and the caller's transaction
 * stays usable) instead of aborting everything.
 */
import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { bookings, vehicleBlocks, vehicleHolds } from "@/db/schema";
import type { BlockKind } from "@/lib/bookings/constants";
import { getSettings } from "@/lib/settings/service";

export const EXCLUSION_VIOLATION = "23P01";

export type HoldOwner = { bookingId: string } | { blockId: string };

export type HoldConflict = {
  holdId: string;
  kind: "booking" | "block";
  bookingId: string | null;
  bookingNumber: string | null;
  blockId: string | null;
  blockKind: BlockKind | null;
  /** Held period, buffer included. */
  start: Date;
  end: Date;
};

export class VehicleConflictError extends Error {
  readonly status = 409 as const;
  constructor(public readonly conflict: HoldConflict | null) {
    super(describeConflict(conflict));
    this.name = "VehicleConflictError";
  }
}

export function describeConflict(c: HoldConflict | null): string {
  if (!c) return "This vehicle is already booked for that time.";
  if (c.kind === "booking") return `This vehicle is already booked for that time by ${c.bookingNumber ?? "another booking"}.`;
  return `This vehicle is blocked for that time (${(c.blockKind ?? "other").replace("_", " ")}).`;
}

/** Postgres error code, also when wrapped by drizzle's `DrizzleQueryError`. */
export function pgErrorCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 4 && e && typeof e === "object"; i += 1) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** End of the held period: end + turnaround buffer. */
export function heldUntil(endAt: Date, bufferMinutes: number): Date {
  return new Date(endAt.getTime() + bufferMinutes * 60_000);
}

export async function turnaroundBufferMinutes(tx: DbOrTx): Promise<number> {
  return (await getSettings(tx)).turnaround_buffer_minutes;
}

function rangeSql(start: Date, end: Date) {
  return sql`tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')`;
}

function ownerCondition(owner: HoldOwner) {
  return "bookingId" in owner ? eq(vehicleHolds.bookingId, owner.bookingId) : eq(vehicleHolds.blockId, owner.blockId);
}

/**
 * Active holds on `vehicleId` overlapping [start, end), joined with their
 * booking number / block kind. Excludes the given owner's own hold.
 */
export async function findOverlappingHolds(
  tx: DbOrTx,
  vehicleId: string,
  start: Date,
  end: Date,
  exclude?: HoldOwner,
): Promise<HoldConflict[]> {
  const rows = await tx
    .select({
      holdId: vehicleHolds.id,
      kind: vehicleHolds.kind,
      bookingId: vehicleHolds.bookingId,
      bookingNumber: bookings.number,
      blockId: vehicleHolds.blockId,
      blockKind: vehicleBlocks.kind,
      start: sql<string>`lower(${vehicleHolds.period})`,
      end: sql<string>`upper(${vehicleHolds.period})`,
    })
    .from(vehicleHolds)
    .leftJoin(bookings, eq(bookings.id, vehicleHolds.bookingId))
    .leftJoin(vehicleBlocks, eq(vehicleBlocks.id, vehicleHolds.blockId))
    .where(
      and(
        eq(vehicleHolds.vehicleId, vehicleId),
        eq(vehicleHolds.active, true),
        sql`${vehicleHolds.period} && ${rangeSql(start, end)}`,
        exclude
          ? "bookingId" in exclude
            ? sql`${vehicleHolds.bookingId} is distinct from ${exclude.bookingId}`
            : sql`${vehicleHolds.blockId} is distinct from ${exclude.blockId}`
          : undefined,
      ),
    )
    .orderBy(sql`lower(${vehicleHolds.period})`);
  return rows.map((r) => ({ ...r, start: new Date(r.start), end: new Date(r.end) }));
}

export type HoldInput = {
  vehicleId: string;
  startAt: Date;
  /** Planned end; the held period adds `bufferMinutes`. */
  endAt: Date;
  bufferMinutes: number;
};

/**
 * Create or replace the owner's hold and make it active. Throws
 * `VehicleConflictError` (naming the conflicting booking or block) when the
 * exclusion constraint refuses it. The caller's transaction stays usable.
 */
export async function setHold(tx: DbOrTx, owner: HoldOwner, input: HoldInput): Promise<void> {
  const start = input.startAt;
  const end = heldUntil(input.endAt, input.bufferMinutes);
  if (!(end > start)) throw new Error("Hold period must end after it starts.");
  try {
    await tx.transaction(async (sp) => {
      const [existing] = await sp.select({ id: vehicleHolds.id }).from(vehicleHolds).where(ownerCondition(owner));
      if (existing) {
        await sp
          .update(vehicleHolds)
          .set({ vehicleId: input.vehicleId, period: rangeSql(start, end), active: true })
          .where(eq(vehicleHolds.id, existing.id));
      } else {
        await sp.insert(vehicleHolds).values({
          vehicleId: input.vehicleId,
          kind: "bookingId" in owner ? "booking" : "block",
          bookingId: "bookingId" in owner ? owner.bookingId : null,
          blockId: "blockId" in owner ? owner.blockId : null,
          period: rangeSql(start, end),
          active: true,
        });
      }
    });
  } catch (err) {
    if (pgErrorCode(err) !== EXCLUSION_VIOLATION) throw err;
    const [conflict] = await findOverlappingHolds(tx, input.vehicleId, start, end, owner);
    throw new VehicleConflictError(conflict ?? null);
  }
}

/** Deactivate the owner's hold (cancel, no-show, closed, block removed). No-op without a hold. */
export async function releaseHold(tx: DbOrTx, owner: HoldOwner): Promise<void> {
  await tx.update(vehicleHolds).set({ active: false }).where(and(ownerCondition(owner), ne(vehicleHolds.active, false)));
}

/** The owner's hold, if any (period as dates). */
export async function getHold(tx: DbOrTx, owner: HoldOwner) {
  const [row] = await tx
    .select({
      id: vehicleHolds.id,
      vehicleId: vehicleHolds.vehicleId,
      active: vehicleHolds.active,
      start: sql<string>`lower(${vehicleHolds.period})`,
      end: sql<string>`upper(${vehicleHolds.period})`,
    })
    .from(vehicleHolds)
    .where(ownerCondition(owner));
  return row ? { ...row, start: new Date(row.start), end: new Date(row.end) } : null;
}

/**
 * Fleet calendar data: one query each for vehicles, bookings and blocks in
 * the visible range (fast for 20 vehicles × 31 days).
 */
import "server-only";
import { and, asc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { bookings, clients, vehicleBlocks, vehicles } from "@/db/schema";
import type { BlockKind, BookingStatus } from "@/lib/bookings/constants";
import { bookingLabel, movementCodes } from "@/lib/bookings/format";
import { BODY_TYPES, type BodyType, type Service } from "@/lib/pricing/types";

export const CALENDAR_STATUSES = ["pending_reservation", "confirmed", "released", "returned", "closed"] as const;
export const CALENDAR_STATUS_FILTERS = ["all", ...CALENDAR_STATUSES, "block"] as const;
export type CalendarStatusFilter = (typeof CALENDAR_STATUS_FILTERS)[number];

export const calendarFilterSchema = z.object({
  view: z.enum(["week", "month"]).catch("week"),
  date: z.string().optional().catch(undefined),
  body: z.enum(["all", ...BODY_TYPES]).catch("all"),
  status: z.enum(CALENDAR_STATUS_FILTERS).catch("all"),
  service: z.enum(["all", "self_drive", "with_driver"]).catch("all"),
});
export type CalendarFilters = z.output<typeof calendarFilterSchema>;

export type CalendarVehicle = { id: string; name: string; plate: string | null; bodyType: BodyType | null };

export type CalendarItem = {
  id: string;
  kind: "booking" | "block";
  vehicleId: string;
  /** ISO instants. */
  start: string;
  end: string;
  status: BookingStatus | "block";
  label: string;
  number: string | null;
  clientName: string | null;
  service: Service | null;
  blockKind: BlockKind | null;
  reason: string | null;
};

export async function calendarData(from: Date, to: Date, f: CalendarFilters) {
  const vehicleRows = await db
    .select({ id: vehicles.id, name: vehicles.displayName, plate: vehicles.plate, bodyType: vehicles.bodyType, sortOrder: vehicles.sortOrder })
    .from(vehicles)
    .where(and(eq(vehicles.active, true), f.body === "all" ? undefined : eq(vehicles.bodyType, f.body)));
  const order = (b: BodyType | null) => (b ? BODY_TYPES.indexOf(b) : BODY_TYPES.length);
  vehicleRows.sort((a, b) => order(a.bodyType) - order(b.bodyType) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const ids = vehicleRows.map((v) => v.id);
  if (ids.length === 0) return { vehicles: [] as CalendarVehicle[], items: [] as CalendarItem[] };

  const wantBookings = f.status !== "block";
  const wantBlocks = f.status === "all" || f.status === "block";
  const statuses = f.status === "all" || f.status === "block" ? [...CALENDAR_STATUSES] : [f.status];

  const [bookingRows, blockRows] = await Promise.all([
    wantBookings
      ? db
          .select({
            id: bookings.id,
            vehicleId: bookings.vehicleId,
            number: bookings.number,
            status: bookings.status,
            service: bookings.service,
            startAt: bookings.startAt,
            endAt: bookings.endAt,
            deliveryAddress: bookings.deliveryAddress,
            pickupAddress: bookings.pickupAddress,
            clientName: clients.fullName,
            bookedName: bookings.clientName,
          })
          .from(bookings)
          .leftJoin(clients, eq(clients.id, bookings.clientId))
          .where(
            and(
              inArray(bookings.vehicleId, ids),
              inArray(bookings.status, statuses),
              lt(bookings.startAt, to),
              gt(bookings.endAt, from),
              f.service === "all" ? undefined : eq(bookings.service, f.service),
            ),
          )
          .orderBy(asc(bookings.startAt))
      : [],
    wantBlocks
      ? db
          .select()
          .from(vehicleBlocks)
          .where(and(inArray(vehicleBlocks.vehicleId, ids), isNull(vehicleBlocks.cancelledAt), lt(vehicleBlocks.startAt, to), gt(vehicleBlocks.endAt, from)))
      : [],
  ]);

  const items: CalendarItem[] = [
    ...bookingRows.map((b) => {
      const clientName = b.clientName ?? b.bookedName;
      return {
        id: b.id,
        kind: "booking" as const,
        vehicleId: b.vehicleId!,
        start: b.startAt.toISOString(),
        end: b.endAt.toISOString(),
        status: b.status,
        label: `${b.number} · ${bookingLabel(movementCodes(b), clientName)}`,
        number: b.number,
        clientName,
        service: b.service,
        blockKind: null,
        reason: null,
      };
    }),
    ...blockRows.map((b) => ({
      id: b.id,
      kind: "block" as const,
      vehicleId: b.vehicleId,
      start: b.startAt.toISOString(),
      end: b.endAt.toISOString(),
      status: "block" as const,
      label: `Blocked · ${b.reason}`,
      number: null,
      clientName: null,
      service: null,
      blockKind: b.kind,
      reason: b.reason,
    })),
  ];
  return {
    vehicles: vehicleRows.map(({ id, name, plate, bodyType }) => ({ id, name, plate, bodyType })),
    items,
  };
}

/**
 * Daily Movement board derivation (bookings-and-movement.md §6). Pure: the
 * board page, the board PDF and tests all feed it rows and get the same
 * answer. Days are Asia/Manila calendar days.
 *
 * Per vehicle and day:
 *   Return      – a booking ends that day (due back, or came back)
 *   Out today   – a booking starts that day (release)
 *   Rented      – a booking covers the whole day (out, not due today)
 *   Blocked     – a vehicle block (owner use, maintenance, …) touches the day
 *   Pending     – only a pending reservation touches the day (no hold)
 *   Available   – nothing
 * A car can carry several (e.g. Return then Out today); `primary` is the first.
 *
 * Times: once checked in, the actual release / return time replaces the
 * planned one. A released car that is past its end and not back stays out
 * until now (`overdue`).
 */
import type { BlockKind, BookingStatus } from "@/lib/bookings/constants";
import { bookingLabel, vehicleShortName } from "@/lib/bookings/format";
import type { Service } from "@/lib/pricing/types";
import { addDaysToKey, manilaDateKey, manilaToUtc, type DateKey } from "@/lib/time";

const MINUTE_MS = 60_000;
export const SLOT_MINUTES = 30;
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;
export const LOOK_AHEAD_DAYS = 5;

/** Booking statuses the board shows. Cancelled and no-show never appear. */
export const BOARD_STATUSES = ["pending_reservation", "confirmed", "released", "returned", "closed"] as const satisfies readonly BookingStatus[];

export const DAY_STATUSES = ["return", "out_today", "rented", "blocked", "pending", "available"] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];
export const DAY_STATUS_LABELS: Record<DayStatus, string> = {
  return: "Return",
  out_today: "Out today",
  rented: "Rented",
  blocked: "Blocked",
  pending: "Pending reservation",
  available: "Available",
};

export type MovementCode = "FD" | "PU" | "WD" | "PR";
export type EventKind = "OUT" | "IN" | "EXT";

export type BoardVehicle = {
  id: string;
  displayName: string;
  plate: string | null;
  dailyRateDisplay: number | null;
};

export type BoardCheckIn = { actualAt: Date; odometerKm: number | null; fuelLevelEighths: number | null };
export type BoardExtension = { actualAt: Date; previousEndAt: Date | null; newEndAt: Date | null };

export type BoardBooking = {
  id: string;
  number: string;
  vehicleId: string | null;
  service: Service;
  status: BookingStatus;
  startAt: Date;
  endAt: Date;
  clientName: string | null;
  destination: string | null;
  deliveryAddress: string | null;
  pickupAddress: string | null;
  driverName: string | null;
  notes: string | null;
  showNotesOnBoard: boolean;
  release: BoardCheckIn | null;
  return: BoardCheckIn | null;
  extensions: BoardExtension[];
  /** Ledger (centavos), when loaded. */
  balance?: number;
  depositHeld?: number;
};

export type BoardBlock = { id: string; vehicleId: string; kind: BlockKind; startAt: Date; endAt: Date; reason: string };

export type BoardInput = {
  vehicles: BoardVehicle[];
  bookings: BoardBooking[];
  blocks: BoardBlock[];
  now: Date;
};

export type TimelineEvent = {
  key: string;
  bookingId: string;
  number: string;
  vehicleId: string;
  kind: EventKind;
  codes: MovementCode[];
  plannedAt: Date;
  actualAt: Date | null;
  /** Where the chip sits: actual time once checked in, else planned. */
  at: Date;
  /** 30-minute slot of `at` within its day, 0–47. */
  slot: number;
  /** Extensions: the new end. */
  newEndAt: Date | null;
  label: string;
  done: boolean;
};

export type VehicleDay = {
  vehicle: BoardVehicle;
  statuses: DayStatus[];
  primary: DayStatus;
  /** The booking that explains the primary status (or the first one that day). */
  booking: BoardBooking | null;
  /** Every board booking touching the day, by start. */
  bookings: BoardBooking[];
  block: BoardBlock | null;
  events: TimelineEvent[];
  /** Released, past its end and not back yet. */
  overdue: boolean;
  /** Confirmed, past its start and not released yet. */
  releaseOverdue: boolean;
};

export type WithDriverTrip = {
  bookingId: string;
  number: string;
  clientName: string | null;
  vehicle: BoardVehicle | null;
  driverName: string | null;
  startAt: Date;
  endAt: Date;
  status: BookingStatus;
  destination: string | null;
};

export type Instruction = {
  bookingId: string;
  number: string;
  vehicle: BoardVehicle | null;
  kind: "FD" | "PU" | "NOTE";
  at: Date | null;
  text: string;
  clientName: string | null;
};

export type BoardDay = {
  date: DateKey;
  rows: VehicleDay[];
  events: TimelineEvent[];
  withDriver: WithDriverTrip[];
  instructions: Instruction[];
  counts: Record<DayStatus, number>;
};

export type LookAheadDay = { date: DateKey; events: TimelineEvent[]; statuses: DayStatus[] };
export type LookAheadRow = { vehicle: BoardVehicle; days: LookAheadDay[] };

// ---------------------------------------------------------------------------

export function dayBounds(date: DateKey): { start: Date; end: Date } {
  return { start: manilaToUtc(date), end: manilaToUtc(addDaysToKey(date, 1)) };
}

/** Effective [start, end) of a booking: actual times once checked in; overdue rentals run until now. */
export function effectiveWindow(b: BoardBooking, now: Date): { start: Date; end: Date; overdue: boolean } {
  const start = b.release?.actualAt ?? b.startAt;
  if (b.return) return { start, end: b.return.actualAt, overdue: false };
  const overdue = b.status === "released" && now > b.endAt;
  return { start, end: overdue ? now : b.endAt, overdue };
}

function within(d: Date, start: Date, end: Date) {
  return d >= start && d < end;
}

function codesFor(b: BoardBooking, kind: EventKind): MovementCode[] {
  const codes: MovementCode[] = [];
  if (b.status === "pending_reservation") codes.push("PR");
  if (b.service === "with_driver") codes.push("WD");
  if (kind === "OUT" && b.deliveryAddress) codes.push("FD");
  if (kind === "IN" && b.pickupAddress) codes.push("PU");
  return codes;
}

function slotOf(at: Date, dayStart: Date): number {
  const m = Math.floor((at.getTime() - dayStart.getTime()) / MINUTE_MS);
  return Math.min(SLOTS_PER_DAY - 1, Math.max(0, Math.floor(m / SLOT_MINUTES)));
}

/** All events of a booking (OUT, EXT…, IN), whatever the day. */
export function bookingEvents(b: BoardBooking, vehicle: BoardVehicle | null): Omit<TimelineEvent, "slot">[] {
  if (!b.vehicleId) return [];
  const short = vehicle ? vehicleShortName(vehicle.displayName) : null;
  const make = (kind: EventKind, plannedAt: Date, actualAt: Date | null, extra: Partial<TimelineEvent> = {}) => {
    const codes = codesFor(b, kind);
    return {
      key: `${b.id}:${kind}:${(actualAt ?? plannedAt).getTime()}`,
      bookingId: b.id,
      number: b.number,
      vehicleId: b.vehicleId!,
      kind,
      codes,
      plannedAt,
      actualAt,
      at: actualAt ?? plannedAt,
      newEndAt: null,
      label: `${kind} ${bookingLabel(codes, b.clientName, short)}`,
      done: actualAt !== null || b.status === "closed" || (kind === "OUT" && (b.status === "released" || b.status === "returned")) || (kind === "IN" && b.status === "returned"),
      ...extra,
    };
  };
  const out = [make("OUT", b.startAt, b.release?.actualAt ?? null)];
  for (const x of b.extensions) {
    const at = x.previousEndAt ?? x.actualAt;
    out.push(make("EXT", at, null, { key: `${b.id}:EXT:${x.actualAt.getTime()}`, newEndAt: x.newEndAt, done: true }));
  }
  out.push(make("IN", b.endAt, b.return?.actualAt ?? null));
  return out;
}

const PRIORITY: Record<DayStatus, number> = Object.fromEntries(DAY_STATUSES.map((s, i) => [s, i])) as Record<DayStatus, number>;

/** Statuses a booking gives a day, or none. */
function bookingDayStatus(b: BoardBooking, start: Date, end: Date, dayStart: Date, dayEnd: Date, overdue: boolean): DayStatus[] {
  if (!(start < dayEnd && end > dayStart)) return [];
  if (b.status === "pending_reservation") return ["pending"];
  const out: DayStatus[] = [];
  const dueThatDay = (d: Date) => d > dayStart && d <= dayEnd;
  // Due back during the day (midnight at the end counts as that day). An
  // overdue car still shows Return on its planned day, not Rented.
  if (dueThatDay(end) || (overdue && dueThatDay(b.endAt))) out.push("return");
  if (within(start, dayStart, dayEnd)) out.push("out_today");
  if (out.length === 0) out.push("rented");
  return out;
}

function vehicleDay(
  vehicle: BoardVehicle,
  bookings: BoardBooking[],
  blocks: BoardBlock[],
  date: DateKey,
  now: Date,
): VehicleDay {
  const { start: dayStart, end: dayEnd } = dayBounds(date);
  const statuses = new Set<DayStatus>();
  const touching: { b: BoardBooking; s: DayStatus[]; overdue: boolean }[] = [];
  const events: TimelineEvent[] = [];
  let releaseOverdue = false;
  for (const b of bookings) {
    const w = effectiveWindow(b, now);
    const s = bookingDayStatus(b, w.start, w.end, dayStart, dayEnd, w.overdue);
    if (s.length) {
      touching.push({ b, s, overdue: w.overdue });
      s.forEach((x) => statuses.add(x));
      if (b.status === "confirmed" && !b.release && now > b.startAt && within(now, dayStart, dayEnd)) releaseOverdue = true;
    }
    for (const e of bookingEvents(b, vehicle)) {
      if (within(e.at, dayStart, dayEnd)) events.push({ ...e, slot: slotOf(e.at, dayStart) });
    }
  }
  const block = blocks.find((k) => k.startAt < dayEnd && k.endAt > dayStart) ?? null;
  if (block) statuses.add("blocked");
  const list = [...statuses].sort((a, b) => PRIORITY[a] - PRIORITY[b]);
  if (list.length === 0) list.push("available");
  const primary = list[0];
  touching.sort((a, b) => a.b.startAt.getTime() - b.b.startAt.getTime());
  const main = touching.find((t) => t.s.includes(primary)) ?? touching[0] ?? null;
  events.sort((a, b) => a.at.getTime() - b.at.getTime() || kindOrder(a.kind) - kindOrder(b.kind));
  return {
    vehicle,
    statuses: list,
    primary,
    booking: main?.b ?? null,
    bookings: touching.map((t) => t.b),
    block,
    events,
    overdue: touching.some((t) => t.overdue) && within(now, dayStart, dayEnd),
    releaseOverdue,
  };
}

function kindOrder(k: EventKind) {
  return k === "IN" ? 0 : k === "EXT" ? 1 : 2;
}

function groupByVehicle<T extends { vehicleId: string | null }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.vehicleId) continue;
    const list = m.get(r.vehicleId) ?? [];
    list.push(r);
    m.set(r.vehicleId, list);
  }
  return m;
}

function visibleBookings(input: BoardInput) {
  return input.bookings.filter((b) => (BOARD_STATUSES as readonly string[]).includes(b.status));
}

/** The board for one Manila day. Vehicles keep the order they are given in. */
export function deriveBoardDay(input: BoardInput, date: DateKey): BoardDay {
  const { start: dayStart, end: dayEnd } = dayBounds(date);
  const bookings = visibleBookings(input);
  const byVehicle = groupByVehicle(bookings);
  const blocksByVehicle = groupByVehicle(input.blocks);
  const vehicleById = new Map(input.vehicles.map((v) => [v.id, v]));

  const rows = input.vehicles.map((v) => vehicleDay(v, byVehicle.get(v.id) ?? [], blocksByVehicle.get(v.id) ?? [], date, input.now));
  const events = rows.flatMap((r) => r.events).sort((a, b) => a.at.getTime() - b.at.getTime());

  const withDriver: WithDriverTrip[] = bookings
    .filter((b) => b.service === "with_driver")
    .filter((b) => {
      const w = effectiveWindow(b, input.now);
      return w.start < dayEnd && w.end > dayStart;
    })
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map((b) => ({
      bookingId: b.id,
      number: b.number,
      clientName: b.clientName,
      vehicle: b.vehicleId ? (vehicleById.get(b.vehicleId) ?? null) : null,
      driverName: b.driverName,
      startAt: b.startAt,
      endAt: b.endAt,
      status: b.status,
      destination: b.destination,
    }));

  const instructions: Instruction[] = [];
  for (const e of events) {
    const b = bookings.find((x) => x.id === e.bookingId)!;
    const vehicle = vehicleById.get(e.vehicleId) ?? null;
    if (e.kind === "OUT" && b.deliveryAddress) {
      instructions.push({ bookingId: b.id, number: b.number, vehicle, kind: "FD", at: e.at, text: b.deliveryAddress, clientName: b.clientName });
    }
    if (e.kind === "IN" && b.pickupAddress) {
      instructions.push({ bookingId: b.id, number: b.number, vehicle, kind: "PU", at: e.at, text: b.pickupAddress, clientName: b.clientName });
    }
  }
  const noted = new Set<string>();
  for (const r of rows) {
    for (const b of r.bookings) {
      if (b.showNotesOnBoard && b.notes?.trim() && !noted.has(b.id)) {
        noted.add(b.id);
        instructions.push({ bookingId: b.id, number: b.number, vehicle: r.vehicle, kind: "NOTE", at: null, text: b.notes.trim(), clientName: b.clientName });
      }
    }
  }

  const counts = Object.fromEntries(DAY_STATUSES.map((s) => [s, 0])) as Record<DayStatus, number>;
  for (const r of rows) counts[r.primary] += 1;

  return { date, rows, events, withDriver, instructions, counts };
}

/** Next `days` days after `date`, per vehicle: events (code + time) and statuses. */
export function deriveLookAhead(input: BoardInput, date: DateKey, days = LOOK_AHEAD_DAYS): LookAheadRow[] {
  const keys = Array.from({ length: days }, (_, i) => addDaysToKey(date, i + 1));
  const perDay = keys.map((k) => deriveBoardDay(input, k));
  return input.vehicles.map((vehicle, i) => ({
    vehicle,
    days: perDay.map((d) => ({ date: d.date, events: d.rows[i].events, statuses: d.rows[i].statuses })),
  }));
}

/** UTC range the board needs rows for: the day plus the look-ahead. */
export function boardRange(date: DateKey, lookAhead = LOOK_AHEAD_DAYS): { from: Date; to: Date } {
  return { from: manilaToUtc(date), to: manilaToUtc(addDaysToKey(date, lookAhead + 1)) };
}

/** Today in Manila. */
export function todayKey(now: Date = new Date()): DateKey {
  return manilaDateKey(now);
}

/** `09:30` label for a slot index. */
export function slotLabel(slot: number): string {
  const m = slot * SLOT_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

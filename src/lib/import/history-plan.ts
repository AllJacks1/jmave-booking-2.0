/**
 * Phase 2a import plan: drivers and booking history (import-map.md "Phase 2a imports").
 *
 * Preview lists what will be created; Commit runs the same plan inside the
 * import transaction, after the fleet and client ops, so vehicles and clients
 * created by the same file are found when the history rows are written.
 *
 * Idempotent: a quotation number that already exists is left alone (and so
 * is its booking), a driver whose name already exists is left alone.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { bookingCharges, bookings, clients, drivers, payments, quotations, vehicleHolds, vehicles, type VehicleRow } from "@/db/schema";
import type { BookingStatus } from "@/lib/bookings/constants";
import { heldUntil, setHold, VehicleConflictError } from "@/lib/holds";
import type { QuotationStatus } from "@/db/schema";
import { getSettings } from "@/lib/settings/service";
import { manilaToUtc } from "@/lib/time";
import { indexClients, matchClient } from "./client-match";
import type { ClientImport, DriverImport, HistoryImport, ImportWarning, PreviewItem, SectionSummary, VehicleImport } from "./types";

type Op = (tx: DbOrTx, actor: { id: string }) => Promise<void>;

const MAX_ITEMS = 5000;
function push(s: SectionSummary, item: PreviewItem) {
  s.counts[item.action] += 1;
  if (s.items.length < MAX_ITEMS) s.items.push(item);
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export function planDrivers(items: DriverImport[], existing: { name: string }[], s: SectionSummary, ops: Op[]) {
  const have = new Set(existing.map((d) => d.name.toLowerCase()));
  for (const d of items) {
    if (have.has(d.name.toLowerCase())) {
      push(s, { action: "unchanged", label: d.name });
      continue;
    }
    have.add(d.name.toLowerCase());
    push(s, { action: "new", label: d.name, changes: { name: [null, d.name], phone: [null, d.phone] } });
    ops.push(async (tx) => {
      await tx.insert(drivers).values({ name: d.name, phone: d.phone, source: "import" });
    });
  }
}

// ---------------------------------------------------------------------------
// Vehicles: `Vios Silver 2026 AT - LAS 2163` contains the plate.
// ---------------------------------------------------------------------------

type VehicleCandidate = { plate: string | null; displayName: string };

function compact(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Vehicle named by a log cell: plate inside the text, else the exact display name. */
export function matchVehicleText<T extends VehicleCandidate>(text: string | null, candidates: readonly T[]): T | null {
  if (!text) return null;
  const t = compact(text);
  if (!t) return null;
  const byPlate = candidates.filter((c) => c.plate && compact(c.plate).length >= 4 && t.includes(compact(c.plate)));
  if (byPlate.length) return byPlate.sort((a, b) => compact(b.plate!).length - compact(a.plate!).length)[0];
  const byName = candidates.filter((c) => compact(c.displayName) === t);
  return byName.length === 1 ? byName[0] : null;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export type HistoryDecision = {
  quotationStatus: QuotationStatus;
  booking: BookingStatus | null;
  /** Why a booked row is not confirmed (conflict, no vehicle). */
  note: string | null;
};

/** Status mapping (import-map.md table). Pure. */
export function decideHistory(h: HistoryImport, now: Date): HistoryDecision {
  const start = h.startAt ? new Date(h.startAt) : null;
  const end = h.endAt ? new Date(h.endAt) : null;
  const past = !start || start < now;
  if (h.service === "with_driver" || h.status === "QUOTED" || h.status === null) {
    return { quotationStatus: past ? "expired" : "issued", booking: null, note: null };
  }
  if (!start || !end) return { quotationStatus: "accepted", booking: null, note: "No readable travel date: no booking created." };
  if (h.status === "COMPLETED") return { quotationStatus: "accepted", booking: "closed", note: null };
  // BOOKED
  return { quotationStatus: "accepted", booking: end > now ? "confirmed" : "closed", note: null };
}

/** Logged lines plus a balancing line when they do not add up to the logged total. */
export function historyCharges(h: HistoryImport): { label: string; amount: number }[] {
  const lines = h.lines.map((l) => ({ ...l }));
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  if (h.total !== null && h.total !== sum) lines.push({ label: "Difference to logged total", amount: h.total - sum });
  return lines;
}

type Ctx = {
  clientIdx: ReturnType<typeof indexClients>;
  vehicleRows: VehicleRow[];
  buffer: number;
};

export async function planHistory(
  opts: {
    history: HistoryImport[];
    clients: ClientImport[];
    fleet: VehicleImport[];
    existingNumbers: Set<string>;
    vehicles: VehicleRow[];
    buffer: number;
    /** Active holds in the DB: vehicle id → periods. */
    holds: Map<string, { start: Date; end: Date; label: string }[]>;
    now: Date;
  },
  s: SectionSummary,
  ops: Op[],
) {
  const { now, buffer } = opts;
  const clientByRow = new Map<string, ClientImport>();
  for (const c of opts.clients) for (const r of c.rows) clientByRow.set(`${r.tab}#${r.row}`, c);
  const candidates: (VehicleCandidate & { id: string | null })[] = [
    ...opts.vehicles.map((v) => ({ plate: v.plate, displayName: v.displayName, id: v.id })),
    ...opts.fleet
      .filter((f) => !opts.vehicles.some((v) => (f.plate && v.plate === f.plate) || v.displayName === f.displayName))
      .map((f) => ({ plate: f.plate, displayName: f.displayName, id: null })),
  ];

  // Conflicts among future confirmed bookings (in file order of start time) and with DB holds.
  const accepted = new Map<string, { start: Date; end: Date; label: string }[]>();
  const conflictNote = new Map<string, string>();
  const futureBooked = opts.history
    .filter((h) => !opts.existingNumbers.has(h.number))
    .map((h) => ({ h, d: decideHistory(h, now), v: matchVehicleText(h.vehicleText, candidates) }))
    .filter((x) => x.d.booking === "confirmed" && x.v)
    .sort((a, b) => a.h.startAt!.localeCompare(b.h.startAt!));
  for (const { h, v } of futureBooked) {
    const key = v!.plate ?? v!.displayName;
    const start = new Date(h.startAt!);
    const end = heldUntil(new Date(h.endAt!), buffer);
    const taken = [...(accepted.get(key) ?? []), ...(v!.id ? (opts.holds.get(v!.id) ?? []) : [])];
    const clash = taken.find((p) => p.start < end && start < p.end);
    if (clash) {
      conflictNote.set(h.number, `Import conflict: overlaps ${clash.label} on ${v!.displayName}. Imported as pending reservation.`);
      continue;
    }
    accepted.set(key, [...(accepted.get(key) ?? []), { start, end, label: h.number }]);
  }

  // Lazily built at commit time, after earlier ops created vehicles and clients.
  let ctxP: Promise<Ctx> | null = null;
  const ctx = (tx: DbOrTx) =>
    (ctxP ??= (async () => ({
      clientIdx: indexClients(await tx.select().from(clients)),
      vehicleRows: await tx.select().from(vehicles),
      buffer,
    }))());

  const tally = { bookings: 0, confirmed: 0, pending: 0, closed: 0, conflicts: 0, noVehicle: 0, futureWd: 0 };
  const warnings: ImportWarning[] = [];

  for (const h of opts.history) {
    const label = `${h.number} · ${h.clientName ?? "no client"}`;
    if (opts.existingNumbers.has(h.number)) {
      push(s, { action: "unchanged", label, detail: "Quotation number already in the system." });
      continue;
    }
    const decision = decideHistory(h, now);
    const vehicle = matchVehicleText(h.vehicleText, candidates);
    let booking = decision.booking;
    let note = decision.note;
    if (h.vehicleText && !vehicle && (booking || decision.quotationStatus === "issued")) {
      warnings.push({ section: "history", level: "warning", tab: h.tab, row: h.row, message: `${h.number}: car "${h.vehicleText}" not matched to a vehicle.` });
    }
    if (booking === "confirmed" && !vehicle) {
      booking = "pending_reservation";
      note = "Imported without a matched vehicle: choose the car, then confirm.";
      tally.noVehicle += 1;
    }
    const conflict = conflictNote.get(h.number);
    if (booking === "confirmed" && conflict) {
      booking = "pending_reservation";
      note = conflict;
      tally.conflicts += 1;
      warnings.push({ section: "history", level: "warning", tab: h.tab, row: h.row, message: `Conflict: ${h.number} ${conflict.replace("Import conflict: ", "")}` });
    }
    if (decision.note && !booking) warnings.push({ section: "history", level: "warning", tab: h.tab, row: h.row, message: `${h.number}: ${decision.note}` });
    if (h.service === "with_driver" && decision.quotationStatus === "issued") {
      tally.futureWd += 1;
      warnings.push({
        section: "history",
        level: "info",
        tab: h.tab,
        row: h.row,
        message: `Future With Driver trip ${h.number}: if it is booked, open the quotation and convert it.`,
      });
    }
    if (booking) {
      tally.bookings += 1;
      if (booking === "confirmed") tally.confirmed += 1;
      else if (booking === "pending_reservation") tally.pending += 1;
      else tally.closed += 1;
    }
    push(s, {
      action: "new",
      label,
      detail: `Quotation ${decision.quotationStatus}${booking ? ` · booking ${booking.replace("_", " ")}` : ""}${vehicle ? ` · ${vehicle.displayName}` : ""}`,
    });

    const clientImport = clientByRow.get(`${h.tab}#${h.row}`);
    ops.push(async (tx) => {
      const c = await ctx(tx);
      const client = clientImport ? matchClient(c.clientIdx, clientImport) : undefined;
      const v = matchVehicleText(h.vehicleText, c.vehicleRows);
      const startAt = h.startAt ? new Date(h.startAt) : null;
      const endAt = h.endAt ? new Date(h.endAt) : null;
      const [q] = await tx
        .insert(quotations)
        .values({
          number: h.number,
          kind: "formal",
          service: h.service,
          status: decision.quotationStatus,
          clientId: client?.id ?? null,
          clientName: client?.fullName ?? h.clientName,
          vehicleId: v?.id ?? null,
          bodyType: v?.bodyType ?? null,
          startAt,
          endAt,
          inputs: { imported: true },
          result: null,
          snapshot: { clientName: client?.fullName ?? h.clientName, clientFbName: client?.fbName ?? null, vehicleName: v?.displayName ?? h.vehicleText, consultantName: h.sales },
          totalCentavos: h.total,
          validUntil: decision.quotationStatus === "issued" ? startAt : null,
          issuedAt: h.bookedOn ? manilaToUtc(h.bookedOn, "00:00") : null,
          imported: true,
          importedData: {
            source: `${h.tab}!${h.row}`,
            status: h.status,
            lines: h.lines,
            total: h.total,
            reservationFee: h.reservationFee,
            deposit: h.deposit,
            paymentMethod: h.paymentMethod,
            vehicleText: h.vehicleText,
            category: h.categoryText,
            destination: h.destination,
            sales: h.sales,
          },
        })
        .returning({ id: quotations.id });
      if (!booking || !startAt || !endAt) return;
      const [b] = await tx
        .insert(bookings)
        .values({
          number: h.number,
          quotationId: q.id,
          clientId: client?.id ?? null,
          clientName: client?.fullName ?? h.clientName,
          vehicleId: v?.id ?? null,
          vehicleLabel: v ? null : h.vehicleText,
          service: h.service,
          status: booking,
          startAt,
          endAt,
          destination: h.destination,
          statusNote: note,
          imported: true,
        })
        .returning();
      const lines = historyCharges(h);
      if (lines.length) {
        await tx.insert(bookingCharges).values(
          lines.map((l, i) => ({ bookingId: b.id, kind: "quoted" as const, label: l.label, amountCentavos: l.amount, source: "quote" as const, sortOrder: i })),
        );
      }
      if (h.reservationFee > 0) {
        await tx.insert(payments).values({
          bookingId: b.id,
          type: "reservation_fee",
          direction: "in",
          amountCentavos: h.reservationFee,
          method: h.paymentMethod,
          collectedByName: h.sales ?? "Imported",
          paidAt: h.bookedOn ? manilaToUtc(h.bookedOn, "00:00") : startAt,
          note: "Imported from the rental log",
        });
      }
      if (booking === "confirmed" && v) {
        try {
          await setHold(tx, { bookingId: b.id }, { vehicleId: v.id, startAt, endAt, bufferMinutes: c.buffer });
        } catch (err) {
          if (!(err instanceof VehicleConflictError)) throw err;
          await tx
            .update(bookings)
            .set({ status: "pending_reservation", statusNote: `Import conflict: ${err.message} Imported as pending reservation.` })
            .where(eq(bookings.id, b.id));
        }
      }
    });
  }

  s.warnings.push(...warnings);
  s.warnings.push({
    section: "history",
    level: "info",
    message: `${s.counts.new} quotation(s) to import; ${tally.bookings} booking(s): ${tally.confirmed} confirmed with a hold, ${tally.pending} pending (${tally.conflicts} conflict(s), ${tally.noVehicle} without a matched car), ${tally.closed} closed. ${tally.futureWd} future With Driver trip(s) to review.`,
  });
}

/** Active holds per vehicle, labelled with the booking number or "a block". */
export async function activeHoldsByVehicle(db: DbOrTx) {
  const rows = await db
    .select({
      vehicleId: vehicleHolds.vehicleId,
      start: sql<string>`lower(${vehicleHolds.period})`,
      end: sql<string>`upper(${vehicleHolds.period})`,
      number: bookings.number,
    })
    .from(vehicleHolds)
    .leftJoin(bookings, eq(bookings.id, vehicleHolds.bookingId))
    .where(and(eq(vehicleHolds.active, true), gt(sql`upper(${vehicleHolds.period})`, sql`now()`)));
  const map = new Map<string, { start: Date; end: Date; label: string }[]>();
  for (const r of rows) {
    const list = map.get(r.vehicleId) ?? [];
    list.push({ start: new Date(r.start), end: new Date(r.end), label: r.number ?? "a vehicle block" });
    map.set(r.vehicleId, list);
  }
  return map;
}

export async function bufferMinutesOrDefault(db: DbOrTx) {
  try {
    return (await getSettings(db)).turnaround_buffer_minutes;
  } catch {
    return 60;
  }
}

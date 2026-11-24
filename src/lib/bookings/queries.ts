/**
 * Booking reads: detail view, list, client history, quotation → booking link.
 */
import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import {
  auditLog,
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
import { getHold } from "@/lib/holds";
import { addDaysToKey, manilaToUtc } from "@/lib/time";
import { checkAvailability } from "./availability";
import type { BookingStatus } from "./constants";
import { computeLedger } from "./ledger";
import { driverOverlaps } from "./service";
import type { BookingListQuery } from "./schema";

export const BOOKINGS_PAGE_SIZE = 50;

export type BookingView = Awaited<ReturnType<typeof getBookingView>>;

export async function getBookingView(id: string) {
  const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
  if (!b) return null;
  const collector = alias(user, "collector");
  const voider = alias(user, "voider");
  const [client, vehicle, driver, quote, charges, pays, hold, audit, creator, confirmer] = await Promise.all([
    b.clientId
      ? db
          .select({
            id: clients.id,
            fullName: clients.fullName,
            fbName: clients.fbName,
            phone: clients.phone,
            email: clients.email,
            address: clients.address,
            birthday: clients.birthday,
            altContactName: clients.altContactName,
            altContactPhone: clients.altContactPhone,
            isBlacklisted: clients.isBlacklisted,
            blacklistReason: clients.blacklistReason,
          })
          .from(clients)
          .where(eq(clients.id, b.clientId))
          .then((r) => r[0] ?? null)
      : null,
    b.vehicleId
      ? db
          .select({ id: vehicles.id, displayName: vehicles.displayName, plate: vehicles.plate, bodyType: vehicles.bodyType })
          .from(vehicles)
          .where(eq(vehicles.id, b.vehicleId))
          .then((r) => r[0] ?? null)
      : null,
    b.driverId
      ? db.select({ id: drivers.id, name: drivers.name, phone: drivers.phone }).from(drivers).where(eq(drivers.id, b.driverId)).then((r) => r[0] ?? null)
      : null,
    b.quotationId
      ? db
          .select({ id: quotations.id, number: quotations.number, imported: quotations.imported })
          .from(quotations)
          .where(eq(quotations.id, b.quotationId))
          .then((r) => r[0] ?? null)
      : null,
    db.select().from(bookingCharges).where(eq(bookingCharges.bookingId, id)).orderBy(asc(bookingCharges.sortOrder), asc(bookingCharges.createdAt)),
    db
      .select({
        p: payments,
        collectorName: collector.displayName,
        voidedByName: voider.displayName,
      })
      .from(payments)
      .leftJoin(collector, eq(collector.id, payments.collectedByUserId))
      .leftJoin(voider, eq(voider.id, payments.voidedBy))
      .where(eq(payments.bookingId, id))
      .orderBy(asc(payments.paidAt), asc(payments.createdAt)),
    getHold(db, { bookingId: id }),
    db
      .select({ id: auditLog.id, action: auditLog.action, at: auditLog.at, actorName: user.displayName })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.actorId))
      .where(and(eq(auditLog.entity, "booking"), eq(auditLog.entityId, id)))
      .orderBy(desc(auditLog.at))
      .limit(50),
    b.createdBy ? db.select({ name: user.displayName }).from(user).where(eq(user.id, b.createdBy)).then((r) => r[0]?.name ?? null) : null,
    b.confirmedBy ? db.select({ name: user.displayName }).from(user).where(eq(user.id, b.confirmedBy)).then((r) => r[0]?.name ?? null) : null,
  ]);
  const paymentRows = pays.map((r) => ({
    ...r.p,
    collectorLabel: r.collectorName ?? r.p.collectedByName ?? "—",
    voidedByName: r.voidedByName,
  }));
  const ledger = computeLedger(charges, paymentRows);
  const [availability, driverClash] = await Promise.all([
    b.vehicleId && (b.status === "pending_reservation" || b.status === "confirmed")
      ? checkAvailability(db, { vehicleId: b.vehicleId, startAt: b.startAt, endAt: b.endAt, excludeBookingId: b.id })
      : null,
    b.driverId ? driverOverlaps(db, b.driverId, b.startAt, b.endAt, b.id) : [],
  ]);
  return {
    booking: b,
    client,
    vehicle,
    driver,
    quotation: quote,
    charges,
    payments: paymentRows,
    ledger,
    hold,
    audit,
    createdByName: creator,
    confirmedByName: confirmer,
    availability,
    driverClash,
  };
}

/** The booking made from a quotation, if any. */
export async function bookingForQuotation(quotationId: string) {
  const [row] = await db.select({ id: bookings.id, number: bookings.number, status: bookings.status }).from(bookings).where(eq(bookings.quotationId, quotationId));
  return row ?? null;
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const OPEN_STATUSES: BookingStatus[] = ["pending_reservation", "confirmed", "released", "returned"];

export async function listBookings(query: BookingListQuery) {
  const conds: (SQL | undefined)[] = [];
  if (query.status === "open") conds.push(inArray(bookings.status, OPEN_STATUSES));
  else if (query.status !== "all") conds.push(eq(bookings.status, query.status));
  if (query.service !== "all") conds.push(eq(bookings.service, query.service));
  if (query.from) conds.push(gte(bookings.endAt, manilaToUtc(query.from, "00:00")));
  if (query.to) conds.push(lt(bookings.startAt, manilaToUtc(addDaysToKey(query.to, 1), "00:00")));
  if (query.q) {
    const like = `%${escapeLike(query.q)}%`;
    conds.push(or(ilike(bookings.number, like), ilike(bookings.clientName, like), ilike(clients.fullName, like)));
  }
  const where = and(...conds);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: bookings.id,
        number: bookings.number,
        status: bookings.status,
        service: bookings.service,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        clientName: sql<string | null>`coalesce(${clients.fullName}, ${bookings.clientName})`,
        vehicleName: sql<string | null>`coalesce(${vehicles.displayName}, ${bookings.vehicleLabel})`,
        imported: bookings.imported,
      })
      .from(bookings)
      .leftJoin(clients, eq(clients.id, bookings.clientId))
      .leftJoin(vehicles, eq(vehicles.id, bookings.vehicleId))
      .where(where)
      .orderBy(query.status === "open" ? asc(bookings.startAt) : desc(bookings.startAt))
      .limit(BOOKINGS_PAGE_SIZE)
      .offset((query.page - 1) * BOOKINGS_PAGE_SIZE),
    db.select({ total: count() }).from(bookings).leftJoin(clients, eq(clients.id, bookings.clientId)).where(where),
  ]);
  return { rows, total: Number(total) };
}

/** Client page: bookings + quotations, lifetime days rented, repeat status. */
export async function clientHistory(clientId: string) {
  const [bks, quotes] = await Promise.all([
    db
      .select({
        id: bookings.id,
        number: bookings.number,
        status: bookings.status,
        service: bookings.service,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        vehicleName: sql<string | null>`coalesce(${vehicles.displayName}, ${bookings.vehicleLabel})`,
        imported: bookings.imported,
      })
      .from(bookings)
      .leftJoin(vehicles, eq(vehicles.id, bookings.vehicleId))
      .where(eq(bookings.clientId, clientId))
      .orderBy(desc(bookings.startAt)),
    db
      .select({
        id: quotations.id,
        number: quotations.number,
        status: quotations.status,
        validUntil: quotations.validUntil,
        service: quotations.service,
        startAt: quotations.startAt,
        totalCentavos: quotations.totalCentavos,
        imported: quotations.imported,
        createdAt: quotations.createdAt,
      })
      .from(quotations)
      .where(and(eq(quotations.clientId, clientId), eq(quotations.kind, "formal"), isNotNull(quotations.number), ne(quotations.status, "draft")))
      .orderBy(desc(sql`coalesce(${quotations.startAt}, ${quotations.createdAt})`))
      .limit(200),
  ]);
  const rented = bks.filter((b) => b.status === "confirmed" || b.status === "released" || b.status === "returned" || b.status === "closed");
  const lifetimeDays = rented.reduce((s, b) => s + rentalDays(b.startAt, b.endAt), 0);
  return { bookings: bks, quotations: quotes, lifetimeDays, rentals: rented.length };
}

/** Whole rental days for history: 24-hour periods, any remainder counts as a day. */
export function rentalDays(startAt: Date, endAt: Date): number {
  const ms = endAt.getTime() - startAt.getTime();
  return Math.max(1, Math.ceil(ms / 86_400_000 - 1e-9));
}

export type { BookingRow };

/** Active staff for "collected by". */
export async function staffOptions() {
  return db.select({ id: user.id, name: user.displayName }).from(user).where(eq(user.active, true)).orderBy(asc(user.displayName));
}

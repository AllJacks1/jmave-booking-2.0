import { describe, expect, it } from "vitest";
import { BOOKING_STATUSES, type BookingStatus } from "@/lib/bookings/constants";
import {
  allowedEvents,
  BOOKING_EVENTS,
  checkTransition,
  holdsVehicle,
  nextStatus,
  releasesHold,
  scheduleEditable,
} from "./booking-status";

describe("booking state machine (§2)", () => {
  it("has exactly the documented transitions", () => {
    const edges: string[] = [];
    for (const from of BOOKING_STATUSES) {
      for (const e of BOOKING_EVENTS) {
        const to = nextStatus(from, e);
        if (to) edges.push(`${from} -${e}-> ${to}`);
      }
    }
    expect(edges.sort()).toEqual(
      [
        "pending_reservation -confirm-> confirmed",
        "pending_reservation -cancel-> cancelled",
        "confirmed -release-> released",
        "confirmed -cancel-> cancelled",
        "confirmed -no_show-> no_show",
        "released -return-> returned",
        "returned -close-> closed",
      ].sort(),
    );
  });

  it("terminal statuses allow nothing", () => {
    for (const s of ["closed", "cancelled", "no_show"] as BookingStatus[]) expect(allowedEvents(s)).toEqual([]);
  });

  it("pending reservations never hold the car", () => {
    expect(holdsVehicle("pending_reservation")).toBe(false);
    expect(holdsVehicle("confirmed")).toBe(true);
    expect(holdsVehicle("released")).toBe(true);
    expect(holdsVehicle("returned")).toBe(true);
    for (const s of ["closed", "cancelled", "no_show"] as BookingStatus[]) expect(holdsVehicle(s)).toBe(false);
  });

  it("cancel, no-show and close release the hold", () => {
    expect(BOOKING_EVENTS.filter(releasesHold).sort()).toEqual(["cancel", "close", "no_show"]);
  });

  it("schedule editable only before release", () => {
    expect(BOOKING_STATUSES.filter(scheduleEditable)).toEqual(["pending_reservation", "confirmed"]);
  });

  describe("confirm", () => {
    it("needs a vehicle", () => {
      expect(checkTransition("pending_reservation", "confirm", { hasReservationFee: true, hasVehicle: false })).toMatchObject({ ok: false, status: 409 });
    });
    it("needs a reservation fee", () => {
      expect(checkTransition("pending_reservation", "confirm", { hasVehicle: true })).toMatchObject({
        ok: false,
        status: 409,
        error: expect.stringContaining("reservation fee"),
      });
      expect(checkTransition("pending_reservation", "confirm", { hasVehicle: true, hasReservationFee: true })).toEqual({ ok: true, to: "confirmed" });
    });
    it("without RF: Admin+ with a reason only", () => {
      const base = { hasVehicle: true, hasReservationFee: false };
      expect(checkTransition("pending_reservation", "confirm", { ...base, confirmWithoutRf: { allowed: false, reason: "VIP" } })).toMatchObject({ ok: false, status: 403 });
      expect(checkTransition("pending_reservation", "confirm", { ...base, confirmWithoutRf: { allowed: true, reason: "  " } })).toMatchObject({ ok: false, status: 400 });
      expect(checkTransition("pending_reservation", "confirm", { ...base, confirmWithoutRf: { allowed: true, reason: "Corporate account" } })).toEqual({ ok: true, to: "confirmed" });
    });
    it("cannot confirm twice", () => {
      expect(checkTransition("confirmed", "confirm", { hasVehicle: true, hasReservationFee: true })).toMatchObject({ ok: false, status: 409 });
    });
  });

  describe("close", () => {
    it("needs zero balance and no deposit held", () => {
      expect(checkTransition("returned", "close", { balance: 100, depositHeld: 0 })).toMatchObject({ ok: false });
      expect(checkTransition("returned", "close", { balance: 0, depositHeld: 200000 })).toMatchObject({ ok: false, error: expect.stringContaining("deposit") });
      expect(checkTransition("returned", "close", { balance: 0, depositHeld: 0 })).toEqual({ ok: true, to: "closed" });
    });
    it("only from returned", () => {
      expect(checkTransition("confirmed", "close", { balance: 0, depositHeld: 0 })).toMatchObject({ ok: false, status: 409 });
    });
  });

  it("no-show only from confirmed; cancel from pending or confirmed", () => {
    expect(checkTransition("pending_reservation", "no_show").ok).toBe(false);
    expect(checkTransition("confirmed", "no_show")).toEqual({ ok: true, to: "no_show" });
    expect(checkTransition("pending_reservation", "cancel")).toEqual({ ok: true, to: "cancelled" });
    expect(checkTransition("released", "cancel").ok).toBe(false);
  });
});

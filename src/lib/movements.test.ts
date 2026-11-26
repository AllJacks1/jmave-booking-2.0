import { describe, expect, it } from "vitest";
import { manilaToUtc } from "@/lib/time";
import {
  boardRange,
  deriveBoardDay,
  deriveLookAhead,
  effectiveWindow,
  slotLabel,
  type BoardBlock,
  type BoardBooking,
  type BoardInput,
  type BoardVehicle,
} from "./movements";

const at = (date: string, time: string) => manilaToUtc(date, time);

const wigo: BoardVehicle = { id: "v1", displayName: "Wigo Gray AT ABC 1234", plate: "ABC 1234", dailyRateDisplay: 158_000 };
const vios: BoardVehicle = { id: "v2", displayName: "Vios Red AT XYZ 9876", plate: "XYZ 9876", dailyRateDisplay: 179_000 };
const innova: BoardVehicle = { id: "v3", displayName: "Innova Black AT DEF 5555", plate: "DEF 5555", dailyRateDisplay: 263_000 };

let n = 0;
function booking(over: Partial<BoardBooking>): BoardBooking {
  n += 1;
  return {
    id: `b${n}`,
    number: `QTN-2026-${900 + n}`,
    vehicleId: wigo.id,
    service: "self_drive",
    status: "confirmed",
    startAt: at("2026-12-10", "09:00"),
    endAt: at("2026-12-11", "09:00"),
    clientName: "Ana Testing",
    destination: "Samal",
    deliveryAddress: null,
    pickupAddress: null,
    driverName: null,
    notes: null,
    showNotesOnBoard: false,
    release: null,
    return: null,
    extensions: [],
    ...over,
  };
}

function input(bookings: BoardBooking[], blocks: BoardBlock[] = [], now = at("2026-12-01", "08:00")): BoardInput {
  return { vehicles: [wigo, vios, innova], bookings, blocks, now };
}

describe("deriveBoardDay: day statuses", () => {
  it("multi-day rental: out on day 1, rented in between, return on the last day", () => {
    const b = booking({ startAt: at("2026-12-10", "09:00"), endAt: at("2026-12-13", "17:00") });
    const i = input([b]);
    expect(deriveBoardDay(i, "2026-12-09").rows[0].primary).toBe("available");
    expect(deriveBoardDay(i, "2026-12-10").rows[0].statuses).toEqual(["out_today"]);
    expect(deriveBoardDay(i, "2026-12-11").rows[0].statuses).toEqual(["rented"]);
    expect(deriveBoardDay(i, "2026-12-12").rows[0].statuses).toEqual(["rented"]);
    expect(deriveBoardDay(i, "2026-12-13").rows[0].statuses).toEqual(["return"]);
    expect(deriveBoardDay(i, "2026-12-14").rows[0].primary).toBe("available");
  });

  it("return and out on the same day: Return first, both shown", () => {
    const a = booking({ startAt: at("2026-12-09", "09:00"), endAt: at("2026-12-10", "08:00") });
    const b = booking({ startAt: at("2026-12-10", "14:00"), endAt: at("2026-12-11", "14:00") });
    const row = deriveBoardDay(input([b, a]), "2026-12-10").rows[0];
    expect(row.statuses).toEqual(["return", "out_today"]);
    expect(row.booking?.id).toBe(a.id);
    expect(row.bookings.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(row.events.map((e) => e.kind)).toEqual(["IN", "OUT"]);
  });

  it("same-day rental (out and back the same day)", () => {
    const b = booking({ startAt: at("2026-12-10", "08:00"), endAt: at("2026-12-10", "20:00") });
    expect(deriveBoardDay(input([b]), "2026-12-10").rows[0].statuses).toEqual(["return", "out_today"]);
  });

  it("return due at midnight counts as that day", () => {
    const b = booking({ startAt: at("2026-12-09", "09:00"), endAt: at("2026-12-11", "00:00") });
    expect(deriveBoardDay(input([b]), "2026-12-10").rows[0].statuses).toEqual(["return"]);
    expect(deriveBoardDay(input([b]), "2026-12-11").rows[0].primary).toBe("available");
  });

  it("blocks show Blocked; a booking outranks the block", () => {
    const block: BoardBlock = { id: "k1", vehicleId: vios.id, kind: "maintenance", startAt: at("2026-12-10", "00:00"), endAt: at("2026-12-12", "00:00"), reason: "PMS" };
    const day = deriveBoardDay(input([], [block]), "2026-12-11");
    expect(day.rows[1].primary).toBe("blocked");
    expect(day.rows[1].block?.reason).toBe("PMS");
    expect(deriveBoardDay(input([], [block]), "2026-12-12").rows[1].primary).toBe("available");
  });

  it("pending reservations show as Pending with the PR code, below real bookings", () => {
    const p = booking({ vehicleId: innova.id, status: "pending_reservation" });
    const day = deriveBoardDay(input([p]), "2026-12-10");
    expect(day.rows[2].statuses).toEqual(["pending"]);
    expect(day.rows[2].events[0].codes).toEqual(["PR"]);
    expect(day.rows[2].events[0].label).toBe("OUT PR INNOVA BLACK - Ana Testing");
  });

  it("cancelled and no-show bookings never appear", () => {
    const day = deriveBoardDay(input([booking({ status: "cancelled" }), booking({ status: "no_show" })]), "2026-12-10");
    expect(day.rows[0].primary).toBe("available");
    expect(day.events).toEqual([]);
  });

  it("counts primary statuses", () => {
    const day = deriveBoardDay(input([booking({}), booking({ vehicleId: vios.id, status: "pending_reservation" })]), "2026-12-10");
    expect(day.counts).toMatchObject({ out_today: 1, pending: 1, available: 1 });
  });
});

describe("deriveBoardDay: timeline", () => {
  it("codes: FD on OUT, PU on IN, WD on both; slot from Manila time", () => {
    const b = booking({ service: "with_driver", deliveryAddress: "Lanang", pickupAddress: "Airport", startAt: at("2026-12-10", "09:30"), endAt: at("2026-12-10", "17:45") });
    const day = deriveBoardDay(input([b]), "2026-12-10");
    const [out, inn] = day.events;
    expect(out).toMatchObject({ kind: "OUT", codes: ["WD", "FD"], slot: 19, done: false });
    expect(out.label).toBe("OUT WD FD WIGO GRAY - Ana Testing");
    expect(inn).toMatchObject({ kind: "IN", codes: ["WD", "PU"], slot: 35 });
    expect(slotLabel(19)).toBe("09:30");
  });

  it("actual time replaces planned once checked in", () => {
    const b = booking({ status: "released", release: { actualAt: at("2026-12-10", "10:10"), odometerKm: 10_000, fuelLevelEighths: 8 } });
    const out = deriveBoardDay(input([b]), "2026-12-10").events[0];
    expect(out).toMatchObject({ plannedAt: at("2026-12-10", "09:00"), actualAt: at("2026-12-10", "10:10"), slot: 20, done: true });
  });

  it("an early return moves the Return status to the actual day", () => {
    const b = booking({
      status: "returned",
      endAt: at("2026-12-12", "09:00"),
      release: { actualAt: at("2026-12-10", "09:00"), odometerKm: 1, fuelLevelEighths: 8 },
      return: { actualAt: at("2026-12-11", "15:00"), odometerKm: 2, fuelLevelEighths: 8 },
    });
    const i = input([b]);
    expect(deriveBoardDay(i, "2026-12-11").rows[0].statuses).toEqual(["return"]);
    expect(deriveBoardDay(i, "2026-12-12").rows[0].primary).toBe("available");
  });

  it("extensions add an EXT chip at the old end; IN moves to the new end", () => {
    const b = booking({
      status: "released",
      endAt: at("2026-12-11", "12:00"),
      extensions: [{ actualAt: at("2026-12-11", "07:00"), previousEndAt: at("2026-12-11", "09:00"), newEndAt: at("2026-12-11", "12:00") }],
    });
    const ev = deriveBoardDay(input([b]), "2026-12-11").events;
    expect(ev.map((e) => [e.kind, e.slot])).toEqual([["EXT", 18], ["IN", 24]]);
    expect(ev[0].newEndAt).toEqual(at("2026-12-11", "12:00"));
  });

  it("overdue: released, past its end, not back — still out today", () => {
    const b = booking({ status: "released", release: { actualAt: at("2026-12-10", "09:00"), odometerKm: 1, fuelLevelEighths: 8 } });
    const now = at("2026-12-12", "10:00");
    expect(effectiveWindow(b, now)).toMatchObject({ overdue: true, end: now });
    const row = deriveBoardDay(input([b], [], now), "2026-12-12").rows[0];
    expect(row.overdue).toBe(true);
    expect(row.primary).toBe("return");
  });

  it("overdue car shows Return on its due day, Rented in between, Return again today", () => {
    const b = booking({ status: "released", release: { actualAt: at("2026-12-10", "09:00"), odometerKm: 1, fuelLevelEighths: 8 } });
    const i = input([b], [], at("2026-12-13", "10:00"));
    expect(deriveBoardDay(i, "2026-12-11").rows[0].statuses).toEqual(["return"]);
    expect(deriveBoardDay(i, "2026-12-12").rows[0].statuses).toEqual(["rented"]);
    expect(deriveBoardDay(i, "2026-12-13").rows[0]).toMatchObject({ statuses: ["return"], overdue: true });
  });

  it("release overdue: confirmed, start passed today, not released", () => {
    const b = booking({});
    const row = deriveBoardDay(input([b], [], at("2026-12-10", "11:00")), "2026-12-10").rows[0];
    expect(row.releaseOverdue).toBe(true);
  });
});

describe("With Driver trips and special instructions", () => {
  it("lists WD trips touching the day, with or without driver", () => {
    const a = booking({ service: "with_driver", vehicleId: vios.id, driverName: "Dan Driver" });
    const b = booking({ service: "with_driver", vehicleId: innova.id, startAt: at("2026-12-10", "05:00"), endAt: at("2026-12-10", "21:00") });
    const trips = deriveBoardDay(input([a, b]), "2026-12-10").withDriver;
    expect(trips.map((t) => [t.number, t.driverName])).toEqual([[b.number, null], [a.number, "Dan Driver"]]);
    expect(trips[1].vehicle?.plate).toBe("XYZ 9876");
  });

  it("FD / PU addresses for today's movements plus flagged notes", () => {
    const a = booking({ deliveryAddress: "Lanang Hotel" });
    const b = booking({ vehicleId: vios.id, startAt: at("2026-12-08", "09:00"), endAt: at("2026-12-10", "16:00"), pickupAddress: "SM Lanang" });
    const c = booking({ vehicleId: innova.id, notes: "Child seat", showNotesOnBoard: true });
    const d = booking({ vehicleId: innova.id, startAt: at("2026-12-20", "09:00"), endAt: at("2026-12-21", "09:00"), notes: "Not today", showNotesOnBoard: true });
    const ins = deriveBoardDay(input([a, b, c, d]), "2026-12-10").instructions;
    expect(ins.map((x) => [x.kind, x.text])).toEqual([
      ["FD", "Lanang Hotel"],
      ["PU", "SM Lanang"],
      ["NOTE", "Child seat"],
    ]);
  });
});

describe("look-ahead", () => {
  it("next five days per vehicle with events", () => {
    const b = booking({ startAt: at("2026-12-12", "08:00"), endAt: at("2026-12-14", "08:00") });
    const rows = deriveLookAhead(input([b]), "2026-12-10");
    expect(rows[0].days.map((d) => d.date)).toEqual(["2026-12-11", "2026-12-12", "2026-12-13", "2026-12-14", "2026-12-15"]);
    expect(rows[0].days.map((d) => d.events.map((e) => e.kind).join())).toEqual(["", "OUT", "", "IN", ""]);
    expect(rows[1].days.every((d) => d.events.length === 0)).toBe(true);
  });

  it("boardRange covers the day plus five", () => {
    expect(boardRange("2026-12-10")).toEqual({ from: at("2026-12-10", "00:00"), to: at("2026-12-16", "00:00") });
  });
});

import { describe, expect, it } from "vitest";
import { manilaToUtc } from "@/lib/time";
import { billedDays, computeReturnCharges, hoursBetweenCeil, hourlyRateFor, priceExtension, type ReturnChargeInput } from "./check-in";
import { EXPECTED_RATE_CARD_V1 as card } from "./expected-v1";

const end = manilaToUtc("2026-12-15", "09:00");

/** Phase 2b brief step 10: 1-day Self-Drive Sedan, 42 L, gasoline ₱94. */
const BRIEF: ReturnChargeInput = {
  service: "self_drive",
  bodyType: "sedan",
  billedDays: 1,
  releaseOdometerKm: 10_000,
  returnOdometerKm: 10_450,
  quotedExcessCentavos: 0,
  tankCapacityL: 42,
  releaseFuelEighths: 8,
  returnFuelEighths: 6,
  fuelPricePerLiter: 9_400,
  plannedEndAt: end,
  actualReturnAt: new Date(end.getTime() + 2 * 3_600_000),
  graceMinutes: 60,
};

describe("computeReturnCharges", () => {
  it("brief golden case: ₱1,200 excess km, ₱987 fuel, ₱600 late return", () => {
    const r = computeReturnCharges(card, BRIEF);
    expect(r.lines.map((l) => [l.kind, l.amount])).toEqual([
      ["excess_km", 120_000],
      ["fuel_shortage", 98_700],
      ["extension", 60_000],
    ]);
    expect(r.total).toBe(278_700);
    expect(r.actualKm).toBe(450);
    expect(r.excessKm).toBe(300);
    expect(r.lateHours).toBe(2);
    expect(r.lines[0].remark).toBe("(450 − 150) km × ₱4");
    expect(r.lines[1].remark).toBe("42 L × 2/8 × ₱94/L");
    expect(r.lines[2].remark).toBe("2 h × ₱300 (Sedan)");
  });

  it("no charges when within allowance, full tank and on time", () => {
    const r = computeReturnCharges(card, { ...BRIEF, returnOdometerKm: 10_150, returnFuelEighths: 8, actualReturnAt: end });
    expect(r.lines).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("allowance scales with billed days", () => {
    const r = computeReturnCharges(card, { ...BRIEF, billedDays: 3, returnOdometerKm: 10_500 });
    expect(r.lines.find((l) => l.kind === "excess_km")?.amount).toBe(50 * 400);
  });

  it("subtracts excess km already quoted, never below zero", () => {
    expect(computeReturnCharges(card, { ...BRIEF, quotedExcessCentavos: 40_000 }).lines[0].amount).toBe(80_000);
    const none = computeReturnCharges(card, { ...BRIEF, quotedExcessCentavos: 200_000 });
    expect(none.lines.some((l) => l.kind === "excess_km")).toBe(false);
  });

  it("uses the body type's excess rate (SUV ₱5/km)", () => {
    const r = computeReturnCharges(card, { ...BRIEF, bodyType: "suv" });
    expect(r.lines[0].amount).toBe(300 * 500);
  });

  it("fuel shortage rounds up to the whole peso", () => {
    // 33 × 1 ÷ 8 × 94 = 387.75 → 388
    const r = computeReturnCharges(card, { ...BRIEF, tankCapacityL: 33, returnFuelEighths: 7, returnOdometerKm: 10_000, actualReturnAt: end });
    expect(r.lines).toEqual([expect.objectContaining({ kind: "fuel_shortage", amount: 38_800 })]);
  });

  it("no fuel charge when returned with more fuel", () => {
    const r = computeReturnCharges(card, { ...BRIEF, releaseFuelEighths: 4, returnFuelEighths: 8 });
    expect(r.lines.some((l) => l.kind === "fuel_shortage")).toBe(false);
  });

  it("unknown tank capacity warns instead of charging", () => {
    const r = computeReturnCharges(card, { ...BRIEF, tankCapacityL: null });
    expect(r.lines.some((l) => l.kind === "fuel_shortage")).toBe(false);
    expect(r.warnings).toHaveLength(1);
  });

  it("late return: inside the grace nothing, past it every hour rounded up", () => {
    const at = (min: number) => computeReturnCharges(card, { ...BRIEF, actualReturnAt: new Date(end.getTime() + min * 60_000) });
    expect(at(60).lateHours).toBe(0);
    expect(at(61).lateHours).toBe(2);
    expect(at(61).lines.at(-1)?.amount).toBe(60_000);
    expect(at(181).lateHours).toBe(4);
    expect(at(-30).lateMinutes).toBe(0);
  });

  it("With Driver late return uses the excess-hour rate by pricing basis", () => {
    const late = new Date(end.getTime() + 2 * 3_600_000);
    const allIn = computeReturnCharges(card, { ...BRIEF, service: "with_driver", pricingBasis: "all_in", returnOdometerKm: 10_000, returnFuelEighths: 8, actualReturnAt: late });
    expect(allIn.lines).toEqual([expect.objectContaining({ kind: "extension", amount: 2 * 50_000 })]);
    const renters = computeReturnCharges(card, { ...BRIEF, service: "with_driver", pricingBasis: "renters_fuel", returnOdometerKm: 10_000, returnFuelEighths: 8, actualReturnAt: late });
    expect(renters.lines[0].amount).toBe(2 * 40_000);
  });

  it("refuses an odometer that went backwards", () => {
    expect(() => computeReturnCharges(card, { ...BRIEF, returnOdometerKm: 9_999 })).toThrow(RangeError);
  });
});

describe("billedDays", () => {
  const s = manilaToUtc("2026-12-14", "09:00");
  it("Self-Drive follows the schedule rule and never goes below the quote", () => {
    expect(billedDays("self_drive", s, manilaToUtc("2026-12-15", "09:00"), 1)).toBe(1);
    expect(billedDays("self_drive", s, manilaToUtc("2026-12-15", "17:00"), 1)).toBe(1); // + 8h block
    expect(billedDays("self_drive", s, manilaToUtc("2026-12-16", "09:00"), 1)).toBe(2); // extended a day
    expect(billedDays("self_drive", s, manilaToUtc("2026-12-15", "09:00"), 3)).toBe(3);
  });
  it("With Driver counts started 24 h periods", () => {
    expect(billedDays("with_driver", s, manilaToUtc("2026-12-14", "18:00"), null)).toBe(1);
    expect(billedDays("with_driver", s, manilaToUtc("2026-12-16", "18:00"), null)).toBe(3);
  });
});

describe("extension pricing", () => {
  it("prices extra hours, rounded up, at the hourly rate", () => {
    const p = priceExtension(card, { service: "self_drive", bodyType: "sedan", currentEndAt: end, newEndAt: new Date(end.getTime() + 150 * 60_000) });
    expect(p).toMatchObject({ hours: 3, rate: 30_000, amount: 90_000, label: "Hourly extension", remark: "(300 × 3) = 900" });
  });
  it("van uses ₱500/hr (PLAN Q7); With Driver uses excess-hour rates", () => {
    expect(hourlyRateFor(card, "self_drive", "van")).toBe(50_000);
    expect(hourlyRateFor(card, "with_driver", "mpv", "renters_fuel")).toBe(45_000);
    expect(hourlyRateFor(card, "with_driver", "mpv", null)).toBe(55_000);
  });
  it("hoursBetweenCeil", () => {
    expect(hoursBetweenCeil(end, end)).toBe(0);
    expect(hoursBetweenCeil(end, new Date(end.getTime() + 1))).toBe(1);
  });
});

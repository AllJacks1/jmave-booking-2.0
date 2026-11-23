import { describe, expect, it } from "vitest";
import { EXPECTED_RATE_CARD_V1 as card } from "./expected-v1";
import type { WithDriverInput } from "./inputs";
import { PricingInputError } from "./types";
import { hoursTierFor, nightMinutes, priceWithDriver } from "./with-driver";

const P = (pesos: number) => Math.round(pesos * 100);
const fuelPrices = { gasoline: P(89), premium: P(99), diesel: P(98) };

/** Manila wall-clock → ISO with offset. */
const at = (date: string, time: string) => `${date}T${time}:00+08:00`;

type Over = Partial<WithDriverInput> & Pick<WithDriverInput, "bodyType">;
function price(o: Over, holidays: string[] = []) {
  return priceWithDriver(
    { startAt: at("2026-12-01", "08:00"), endAt: at("2026-12-01", "18:00"), days: 1, fuelPrices, ...o },
    card,
    { holidays },
  );
}
const amounts = (r: ReturnType<typeof price>) =>
  Object.fromEntries([...r.lines, ...r.discounts].map((l) => [l.code, l.amount]));

const WD1: Over = {
  bodyType: "suv",
  category: "primo",
  startAt: at("2026-12-01", "08:30"),
  endAt: at("2026-12-01", "18:30"),
  days: 1,
  oneWayDistanceKm: 50,
  pricingBasis: "all_in",
  drivingTerm: "back_and_forth",
  package: "round_trip",
  serviceArea: "davao_region",
  event: "regular",
  clientType: "individual",
  mealPerDay: P(100),
};

const WD2: Over = {
  bodyType: "sedan",
  category: "primo",
  startAt: at("2026-12-01", "08:00"),
  endAt: at("2026-12-02", "08:00"),
  days: 3,
  oneWayDistanceKm: 120,
  pricingBasis: "all_in",
  drivingTerm: "long_term_parking",
  serviceArea: "davao_region",
  event: "regular",
  mealPerDay: P(300),
};

describe("With Driver golden cases (pricing.md §7)", () => {
  it("WD-1: SUV primo 10h, 50 km, all-in → 7,100 (matches old sheet)", () => {
    const r = price(WD1);
    expect(r.hoursTier).toBe(10);
    expect(amounts(r)).toEqual({
      rental: P(3580),
      cdw: P(500),
      carwash: P(300),
      driver_fee: P(750),
      meal: P(100),
      fuel: P(1347.5),
      rounding: P(22.5),
      service_fee: P(500),
    });
    expect(r.subtotal).toBe(P(7100));
    expect(r.total).toBe(P(7100));
    expect(r.grandTotal).toBe(P(7100));
  });

  it("WD-2: sedan primo 24h, 3 days, long-term parking (B6) → 14,700", () => {
    const r = price(WD2);
    expect(r.hoursTier).toBe(24);
    expect(amounts(r)).toEqual({
      rental: P(5670),
      cdw: P(1050),
      carwash: P(200),
      driver_first_day: P(1500),
      driver_standby: P(1000),
      driver_last_day: P(1500),
      meal: P(900),
      fuel: P(2349.6),
      rounding: P(30.4),
      service_fee: P(500),
    });
    expect(r.subtotal).toBe(P(14700));
  });

  it("WD-3: sedan primo 8h pick-up/drop-off, working hour, 15 km → 2,700", () => {
    const r = price({
      bodyType: "sedan",
      category: "primo",
      startAt: at("2026-12-01", "09:00"),
      endAt: at("2026-12-01", "17:00"),
      package: "pickup_dropoff",
      driverRateMode: "working_hour",
      oneWayDistanceKm: 15,
      pricingBasis: "all_in",
    });
    expect(amounts(r)).toEqual({
      rental: P(1100),
      cdw: P(350),
      carwash: P(200),
      driver_fee: P(200),
      fuel: P(293.7),
      rounding: P(56.3),
      service_fee: P(500),
    });
    expect(r.subtotal).toBe(P(2700));
  });

  it("WD-4: WD-2 with 1 day → first-day driver fee only (B6)", () => {
    const r = price({ ...WD2, days: 1 });
    const codes = r.lines.map((l) => l.code);
    expect(amounts(r).driver_first_day).toBe(P(1500));
    expect(codes).not.toContain("driver_standby");
    expect(codes).not.toContain("driver_last_day");
  });

  it("WD-5: WD-1 corporate 10% → 7,810", () => {
    const r = price({ ...WD1, clientType: "corporate", corporateMarkupBps: 1000 });
    expect(r.total).toBe(P(7100));
    expect(r.corporateMarkup).toBe(P(710));
    expect(r.grandTotal).toBe(P(7810));
  });
});

describe("With Driver edge cases", () => {
  it.each([
    [1, 8],
    [480, 8],
    [481, 10],
    [600, 10],
    [601, 12],
    [720, 12],
    [721, 24],
    [1440, 24],
  ])("%i contract minutes → %ih tier (B8)", (minutes, tier) => {
    expect(hoursTierFor(minutes)).toBe(tier);
  });

  it("rejects more than 24h for one day", () => {
    expect(() => hoursTierFor(1441)).toThrow(PricingInputError);
    expect(() =>
      price({ bodyType: "compact", startAt: at("2026-12-01", "08:00"), endAt: at("2026-12-02", "09:00") }),
    ).toThrow(PricingInputError);
  });

  it("0 km uses the first distance band; no fuel, no excess", () => {
    const r = price({ bodyType: "compact", oneWayDistanceKm: 0 });
    expect(amounts(r).driver_fee).toBe(P(750));
    expect(amounts(r).fuel).toBeUndefined();
    expect(amounts(r).excess_km).toBeUndefined();
  });

  it.each([
    [70, 750],
    [70.5, 900],
    [110, 900],
    [311, 2000],
    [500, 2000],
    [800, 2000],
  ])("%s km one way → driver fee %s (10h)", (km, fee) => {
    expect(amounts(price({ bodyType: "compact", oneWayDistanceKm: km })).driver_fee).toBe(P(fee));
  });

  it("> 500 km: last band, fuel and excess on the full distance", () => {
    const r = price({ bodyType: "van", oneWayDistanceKm: 600 });
    expect(amounts(r).driver_fee).toBe(P(2000));
    expect(amounts(r).fuel).toBe(P(600 * 2.2 / 7 * 98)); // 18,480
    expect(amounts(r).excess_km).toBe(P((1200 - 150) * 5));
  });

  it.each([
    [14, "rental", 14 * 1580],
    [15, "rental", 15 * 1560],
    [29, "rental", 29 * 1560],
    [30, "rental", 30 * 1300],
  ])("%i days compact Davao Region 24h", (days, code, pesos) => {
    const r = price({
      bodyType: "compact",
      startAt: at("2026-12-01", "08:00"),
      endAt: at("2026-12-02", "08:00"),
      days,
      serviceArea: "davao_region",
    });
    expect(amounts(r)[code]).toBe(P(pesos));
  });

  it("long-term rate ignores category and uses the service area", () => {
    const r = price({
      bodyType: "suv",
      category: "primo",
      startAt: at("2026-12-01", "08:00"),
      endAt: at("2026-12-02", "08:00"),
      days: 30,
      serviceArea: "mindanao",
    });
    expect(amounts(r).rental).toBe(P(30 * 2850));
  });

  it("holiday from the holiday list doubles the driver fee (PLAN Q9)", () => {
    const r = price({ ...WD1, event: "auto" }, ["2026-12-01"]);
    expect(r.isHoliday).toBe(true);
    expect(amounts(r).driver_fee).toBe(P(1500));
  });

  it("holiday override both ways", () => {
    expect(price({ ...WD1, event: "regular" }, ["2026-12-01"]).isHoliday).toBe(false);
    expect(price({ ...WD1, event: "holiday" }).isHoliday).toBe(true);
    expect(price({ ...WD1, event: "auto" }).isHoliday).toBe(false);
  });

  it("night differential on a 10h contract running into the night", () => {
    // 18:00–04:00: night 22:01–04:00 = 359 min; 750 × 10% × 359 ÷ 600 = 44.875 → 44.88
    const r = price({
      bodyType: "compact",
      startAt: at("2026-12-01", "18:00"),
      endAt: at("2026-12-02", "04:00"),
    });
    expect(amounts(r).night_diff).toBe(4488);
  });

  it("night differential counts an early-morning start", () => {
    expect(nightMinutes(new Date(at("2026-12-01", "02:00")), new Date(at("2026-12-01", "10:00")))).toBe(240);
  });

  it("no night differential on the 24h tier", () => {
    expect(amounts(price(WD2)).night_diff).toBeUndefined();
  });

  it("renter's fuel: no fuel line; supplemental rate is renter's fuel", () => {
    const r = price({ ...WD1, pricingBasis: "renters_fuel" });
    expect(amounts(r).fuel).toBeUndefined();
    expect(r.supplemental[0].amount).toBe(P(500));
    expect(price(WD1).supplemental[0].amount).toBe(P(600));
  });

  it("additional hours: car and driver blocks", () => {
    const r = price({ ...WD1, additionalHoursBlock: 12 });
    expect(amounts(r).additional_hours).toBe(P(3199));
    expect(amounts(r).additional_hours_driver).toBe(P(850));
  });

  it("card vs cash terminal fees; discount", () => {
    const r = price({
      ...WD1,
      discount: P(100),
      reservationFee: P(1000),
      paymentMethods: { rental: "card", reservation: "card" },
    });
    expect(r.total).toBe(P(7000));
    expect(r.terminalFees).toEqual({ rental: P(245), reservation: P(35) });
    expect(r.grandTotal).toBe(P(7280));
    expect(r.payable.dueToday).toBe(P(1035));
    expect(r.payable.balanceOnRelease).toBe(P(6245));
    const cash = price({ ...WD1, reservationFee: P(1000) });
    expect(cash.terminalFees).toEqual({ rental: 0, reservation: 0 });
  });

  it("working hour is refused for round trips and long distances", () => {
    expect(() => price({ ...WD1, driverRateMode: "working_hour" })).toThrow(PricingInputError);
    expect(() =>
      price({ ...WD1, package: "airport_transfer", driverRateMode: "working_hour", oneWayDistanceKm: 23 }),
    ).toThrow(PricingInputError);
  });

  it("transfer packages bill one day and warn", () => {
    const r = price({ ...WD1, package: "airport_transfer", days: 3 });
    expect(r.billingDays).toBe(1);
    expect(amounts(r).rental).toBe(P(3580));
    expect(r.warnings).toHaveLength(1);
  });

  it("blank optional inputs use defaults", () => {
    const r = priceWithDriver(
      { bodyType: "compact", startAt: at("2026-12-01", "08:00"), endAt: at("2026-12-01", "16:00"), days: 1, fuelPrices },
      card,
    );
    // 950 + 350 + 200 + 600 = 2,100 → rounding 0 → + 500
    expect(r.subtotal).toBe(P(2600));
    expect(r.lines.map((l) => l.code)).toEqual(["rental", "cdw", "carwash", "driver_fee", "service_fee"]);
  });
});

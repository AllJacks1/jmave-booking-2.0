import { describe, expect, it } from "vitest";
import { EXPECTED_RATE_CARD_V1 as card } from "./expected-v1";
import type { SelfDriveInput } from "./inputs";
import { priceSelfDrive } from "./self-drive";
import { PricingInputError } from "./types";

const P = (pesos: number) => Math.round(pesos * 100);
const fuelPrices = { gasoline: P(94), premium: P(99), diesel: P(98) };

function price(overrides: Partial<SelfDriveInput> & Pick<SelfDriveInput, "bodyType">) {
  return priceSelfDrive({ hoursTier: 24, days: 1, fuelPrices, ...overrides }, card);
}
const amounts = (r: ReturnType<typeof price>) =>
  Object.fromEntries([...r.lines, ...r.discounts].map((l) => [l.code, l.amount]));

describe("Self-Drive golden cases (pricing.md §7)", () => {
  it("SD-1: MPV primo 24h 1 day, delivery + pick-up", () => {
    const r = price({ bodyType: "mpv", category: "primo", deliveryFee: P(365), pickupFee: P(365) });
    expect(amounts(r)).toEqual({
      rental: P(2630),
      carwash: P(250),
      delivery_fee: P(365),
      pickup_fee: P(365),
    });
    expect(r.subtotal).toBe(P(3610));
    expect(r.total).toBe(P(3610));
    expect(r.lines[0].remark).toBe("(2,630 × 1) = 2,630");
  });

  it("SD-1 paid by card: terminal fee 126.35 → 3,736.35", () => {
    const r = price({
      bodyType: "mpv",
      category: "primo",
      deliveryFee: P(365),
      pickupFee: P(365),
      paymentMethods: { rental: "card", reservation: "cash", deposit: "cash" },
    });
    expect(r.payable.terminalFees.rental).toBe(12635);
    expect(r.payable.totalContractValue).toBe(373635);
  });

  it("SD-2: Compact, new client, reservation + deposit", () => {
    const r = price({
      bodyType: "compact",
      clientIsRepeat: false,
      deliveryFee: P(490),
      reservationFee: P(500),
      deposit: P(2000),
    });
    expect(amounts(r)).toEqual({
      rental: P(1580),
      carwash: P(200),
      delivery_fee: P(490),
      new_client: -P(79),
    });
    expect(r.subtotal).toBe(P(2270));
    expect(r.total).toBe(P(2191));
    expect(r.payable.totalContractValue).toBe(P(4191));
    expect(r.payable.dueToday).toBe(P(990));
    expect(r.payable.balanceOnRelease).toBe(P(3201));
  });

  it("SD-3: sedan primo 2 days, CDW, 200 km, fuel + excess (B1, B3)", () => {
    const r = price({ bodyType: "sedan", category: "primo", days: 2, withCdw: true, oneWayDistanceKm: 200 });
    expect(amounts(r)).toEqual({
      rental: P(3780),
      cdw: P(700),
      carwash: P(200),
      fuel: P(3760),
      excess_km: P(400),
    });
    expect(r.subtotal).toBe(P(8840));
  });

  it("SD-4: April promo 15% for 5 days (B2)", () => {
    const r = price({ bodyType: "compact", days: 5, promo: "APRIL_TIERED" });
    expect(amounts(r)).toEqual({ rental: P(7900), carwash: P(200), promo_april: -P(1185) });
    expect(r.total).toBe(P(6915));
  });

  it("SD-4: April promo 10% for 4 days", () => {
    const r = price({ bodyType: "compact", days: 4, promo: "APRIL_TIERED" });
    expect(amounts(r)).toEqual({ rental: P(6320), carwash: P(200), promo_april: -P(632) });
    expect(r.total).toBe(P(5888));
  });

  it("SD-5: 7-day discount", () => {
    const r = price({ bodyType: "compact", days: 7, sevenDayDiscount: true });
    expect(amounts(r)).toEqual({ rental: P(10360), carwash: P(200) });
    expect(r.total).toBe(P(10560));
  });

  it("SD-6: hourly extension 2h", () => {
    const r = price({ bodyType: "mpv", category: "primo", extensionHours: 2 });
    expect(amounts(r)).toEqual({ rental: P(2630), carwash: P(250), extension: P(700) });
    expect(r.total).toBe(P(3580));
  });
});

describe("Self-Drive edge cases", () => {
  it("0 km: no fuel, no excess", () => {
    const r = price({ bodyType: "sedan", category: "primo", oneWayDistanceKm: 0 });
    expect(r.lines.map((l) => l.code)).toEqual(["rental", "carwash"]);
  });

  it("> 500 km one way prices fuel and excess on the full distance", () => {
    const r = price({ bodyType: "suv", category: "budgetmile", oneWayDistanceKm: 600 });
    // 1,200 km ÷ 8 × ₱98 = 14,700; excess (1,200 − 150) × 5 = 5,250
    expect(amounts(r).fuel).toBe(P(14700));
    expect(amounts(r).excess_km).toBe(P(5250));
  });

  it("decimal distance rounds once, half-up, to the centavo", () => {
    const r = price({ bodyType: "mpv", category: "budgetmile", oneWayDistanceKm: 12.345 });
    // 24.69 km ÷ 9 × ₱94 = 257.873… → 257.87
    expect(amounts(r).fuel).toBe(25787);
  });

  it("includeFuel off drops fuel but keeps excess", () => {
    const r = price({ bodyType: "compact", oneWayDistanceKm: 100, includeFuel: false });
    expect(amounts(r).fuel).toBeUndefined();
    expect(amounts(r).excess_km).toBe(P(200)); // (200 − 150) × 4
  });

  it("uses the chosen vehicle's fuel type", () => {
    const r = price({ bodyType: "sedan", category: "premium", oneWayDistanceKm: 50, fuelType: "premium" });
    expect(amounts(r).fuel).toBe(P(990)); // 100 ÷ 10 × 99
  });

  it.each([
    [14, 14 * 1580],
    [15, 15 * 1580],
    [29, 29 * 1580],
    [30, 30 * 1580],
  ])("%i days: rental = daily × days", (days, pesos) => {
    expect(amounts(price({ bodyType: "compact", days })).rental).toBe(P(pesos));
  });

  it("8h and 12h tiers", () => {
    expect(amounts(price({ bodyType: "van", hoursTier: 8 })).rental).toBe(P(3500));
    expect(amounts(price({ bodyType: "van", hoursTier: 12 })).rental).toBe(P(4500));
  });

  it("additional-hours block adds one CDW day", () => {
    const r = price({ bodyType: "sedan", category: "primo", days: 2, additionalHoursBlock: 8, withCdw: true });
    expect(amounts(r).additional_hours).toBe(P(1100));
    expect(amounts(r).cdw).toBe(P(1050));
  });

  it("OT premium and beyond operating hours", () => {
    const r = price({ bodyType: "compact", days: 2, otPremiumSlot: "evening", beyondOperatingHours: true });
    expect(amounts(r).ot_premium).toBe(P(500));
    expect(amounts(r).beyond_hours).toBe(P(1000));
    expect(amounts(price({ bodyType: "compact", otPremiumSlot: "overnight" })).ot_premium).toBe(P(300));
  });

  it("City Saver is a flat rental; 7-day discount ignored with a warning", () => {
    const r = price({ bodyType: "sedan", category: "primo", days: 3, promo: "CITY_SAVER", sevenDayDiscount: true });
    expect(amounts(r).rental).toBe(P(4799));
    expect(r.warnings).toHaveLength(1);
    expect(amounts(price({ bodyType: "sedan", category: "primo", promo: "CITY_SAVER_PLUS" })).rental).toBe(P(5299));
  });

  it("7-day discount under 7 days is not applied", () => {
    const r = price({ bodyType: "compact", days: 6, sevenDayDiscount: true });
    expect(amounts(r).rental).toBe(P(9480));
    expect(r.warnings[0]).toMatch(/7\+ days/);
  });

  it("card vs cash: terminal fees only on card, each with its own method", () => {
    const base = { bodyType: "compact" as const, reservationFee: P(500), deposit: P(2000) };
    const cash = price(base);
    expect(cash.payable.terminalFees).toEqual({ rental: 0, reservation: 0, deposit: 0 });
    const gcash = price({ ...base, paymentMethods: { rental: "gcash", reservation: "gcash", deposit: "gcash" } });
    expect(gcash.payable.terminalFees).toEqual({ rental: 0, reservation: 0, deposit: 0 }); // fix B10
    const card3 = price({ ...base, paymentMethods: { rental: "card", reservation: "card", deposit: "card" } });
    expect(card3.payable.terminalFees).toEqual({ rental: 6230, reservation: 1750, deposit: 7000 });
    expect(card3.payable.totalContractValue).toBe(P(1780) + P(2000) + 6230 + 1750 + 7000);
    expect(card3.payable.dueToday).toBe(P(500) + 1750);
  });

  it("blank optional inputs use defaults", () => {
    const r = priceSelfDrive({ bodyType: "compact", hoursTier: 24, days: 1, fuelPrices }, card);
    expect(r.total).toBe(P(1780));
    expect(r.inputs.clientIsRepeat).toBe(true);
    expect(r.inputs.paymentMethods.rental).toBe("cash");
  });

  it("rejects a categorised body type without a category", () => {
    expect(() => price({ bodyType: "sedan" })).toThrow(PricingInputError);
  });

  it("rejects 0 days and negative fees", () => {
    expect(() => price({ bodyType: "compact", days: 0 })).toThrow(PricingInputError);
    expect(() => price({ bodyType: "compact", deliveryFee: -1 })).toThrow(PricingInputError);
  });
});

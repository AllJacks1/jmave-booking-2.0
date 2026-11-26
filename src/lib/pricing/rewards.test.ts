import { describe, expect, it } from "vitest";
import { EXPECTED_RATE_CARD_V1 as card } from "./expected-v1";
import {
  freeHoursPoints,
  pointsForRentalDays,
  pointsValueCentavos,
  POINTS_PER_PESO,
} from "./rewards";
import { priceSelfDrive } from "./self-drive";
import { PricingInputError } from "./types";
import { priceWithDriver } from "./with-driver";

const P = (pesos: number) => Math.round(pesos * 100);
const fuelPrices = { gasoline: P(94), premium: P(99), diesel: P(98) };

describe("rewards math (pricing.md §4)", () => {
  it("earns 50 points per rental day: 3 days → 150 points worth ₱3", () => {
    expect(pointsForRentalDays(3)).toBe(150);
    expect(pointsValueCentavos(150)).toBe(P(3));
  });

  it("values only whole pesos and never below zero", () => {
    expect(POINTS_PER_PESO).toBe(50);
    expect(pointsValueCentavos(49)).toBe(0);
    expect(pointsValueCentavos(99)).toBe(P(1));
    expect(pointsValueCentavos(-500)).toBe(0);
  });

  it("rejects fractional or negative rental days", () => {
    expect(() => pointsForRentalDays(1.5)).toThrow(RangeError);
    expect(() => pointsForRentalDays(-1)).toThrow(RangeError);
    expect(pointsForRentalDays(0)).toBe(0);
  });

  it("free hours cost hours × hourly extension rate × 50", () => {
    expect(freeHoursPoints(card, "sedan", 1)).toBe(15_000);
    expect(freeHoursPoints(card, "wagon", 2)).toBe(35_000);
  });
});

describe("Self-Drive redemption", () => {
  const base = { bodyType: "sedan" as const, category: "primo" as const, hoursTier: 24 as const, days: 1, fuelPrices };

  it("no redemption: no rewards lines, rewards = null", () => {
    const r = priceSelfDrive(base, card);
    expect(r.rewards).toBeNull();
    expect([...r.lines, ...r.discounts].some((l) => l.code.startsWith("rewards_"))).toBe(false);
  });

  it("1 free Sedan hour: ₱0 'Free hours (rewards)' line, 15,000 points, total unchanged", () => {
    const plain = priceSelfDrive(base, card);
    const r = priceSelfDrive({ ...base, rewardsMode: "free_hours", rewardsHours: 1 }, card);
    const l = r.lines.find((x) => x.code === "rewards_free_hours");
    expect(l).toMatchObject({ label: "Free hours (rewards)", amount: 0 });
    expect(l?.remark).toContain("15,000 points");
    expect(r.rewards).toEqual({ mode: "free_hours", points: 15_000, hours: 1, ratePerHour: P(300) });
    expect(r.total).toBe(plain.total);
  });

  it("peso discount: floor(points ÷ 50) pesos as a negative 'Rewards redemption' line", () => {
    const plain = priceSelfDrive(base, card);
    const r = priceSelfDrive({ ...base, rewardsMode: "discount", rewardsPoints: 1_020 }, card);
    const d = r.discounts.find((x) => x.code === "rewards_discount");
    expect(d).toMatchObject({ label: "Rewards redemption", amount: -P(20) });
    expect(r.rewards).toEqual({ mode: "discount", points: 1_000, amount: P(20) });
    expect(r.total).toBe(plain.total - P(20));
    expect(r.warnings.some((w) => w.includes("1,000 points are used"))).toBe(true);
  });

  it("a discount never makes the total negative (capped to whole pesos)", () => {
    const plain = priceSelfDrive(base, card);
    const r = priceSelfDrive({ ...base, rewardsMode: "discount", rewardsPoints: 10_000_000 }, card);
    expect(r.total).toBe(plain.total % 100);
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.rewards?.points).toBe(Math.floor(plain.total / 100) * 50);
    expect(r.warnings.some((w) => w.includes("does not go below ₱0"))).toBe(true);
  });

  it("terminal fee is charged on the total after the discount", () => {
    const r = priceSelfDrive(
      {
        ...base,
        rewardsMode: "discount",
        rewardsPoints: 5_000,
        paymentMethods: { rental: "card", reservation: "cash", deposit: "cash" },
      },
      card,
    );
    const plain = priceSelfDrive({ ...base, paymentMethods: { rental: "card", reservation: "cash", deposit: "cash" } }, card);
    expect(r.payable.terminalFees.rental).toBeLessThan(plain.payable.terminalFees.rental);
  });

  it("refuses empty redemptions", () => {
    expect(() => priceSelfDrive({ ...base, rewardsMode: "free_hours", rewardsHours: 0 }, card)).toThrow(PricingInputError);
    expect(() => priceSelfDrive({ ...base, rewardsMode: "discount", rewardsPoints: 49 }, card)).toThrow(PricingInputError);
  });
});

describe("With Driver redemption", () => {
  const base = {
    bodyType: "sedan" as const,
    category: "primo" as const,
    startAt: "2026-12-01T08:00:00+08:00",
    endAt: "2026-12-01T18:00:00+08:00",
    days: 1,
    fuelPrices,
  };

  it("free hours use the Self-Drive hourly table", () => {
    const r = priceWithDriver({ ...base, rewardsMode: "free_hours", rewardsHours: 1 }, card);
    expect(r.lines.find((l) => l.code === "rewards_free_hours")?.amount).toBe(0);
    expect(r.rewards?.points).toBe(15_000);
  });

  it("discount lowers the total and the grand total", () => {
    const plain = priceWithDriver(base, card);
    const r = priceWithDriver({ ...base, rewardsMode: "discount", rewardsPoints: 2_500 }, card);
    expect(r.total).toBe(plain.total - P(50));
    expect(r.grandTotal).toBe(plain.grandTotal - P(50));
  });
});

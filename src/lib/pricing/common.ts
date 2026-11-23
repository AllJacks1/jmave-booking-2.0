import type { z } from "zod";
import { applyBps, kmToMetres, mulDiv, remarkNumber, remarkPesos, toTenths } from "./math";
import type { RateCardData } from "./rate-card";
import {
  defaultFuelType,
  PricingInputError,
  type BodyType,
  type FuelType,
  type PaymentMethod,
  type PriceLine,
} from "./types";

/** Parse engine input; invalid input becomes a PricingInputError with the first issue. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
    throw new PricingInputError(`${where}${issue.message}`);
  }
  return r.data;
}

export function line(code: string, label: string, amount: number, remark = ""): PriceLine {
  return { code, label, remark, amount };
}

/** "(2,630 × 1) = 2,630" */
export function timesRemark(unit: number, qty: number, total: number): string {
  return `(${remarkPesos(unit)} × ${remarkNumber(qty)}) = ${remarkPesos(total)}`;
}

export function sum(lines: readonly PriceLine[]): number {
  return lines.reduce((s, l) => s + l.amount, 0);
}

/** Terminal fee (§1): card only. */
export function terminalFee(card: RateCardData, amount: number, method: PaymentMethod): number {
  return method === "card" ? applyBps(amount, card.terminalFeeBps) : 0;
}

export function fuelPriceFor(
  bodyType: BodyType,
  fuelType: FuelType | null,
  prices: Record<FuelType, number>,
): { type: FuelType; price: number } {
  const type = fuelType ?? defaultFuelType(bodyType);
  return { type, price: prices[type] };
}

/**
 * Fuel cost = km × factor ÷ kmPerLiter × price.
 * `factorTenths`: 20 for Self-Drive (round trip), 22 for With Driver.
 */
export function fuelCost(
  oneWayKm: number,
  factorTenths: number,
  kmPerLiter: number,
  pricePerLiter: number,
): number {
  // metres × factor/10 × price ÷ (kmPerL/10 × 1000)
  return mulDiv([kmToMetres(oneWayKm), factorTenths, pricePerLiter], [toTenths(kmPerLiter), 1000]);
}

export function fuelRemark(oneWayKm: number, factorTenths: number, kmPerLiter: number, price: number): string {
  const km = remarkNumber(mulDiv([kmToMetres(oneWayKm), factorTenths], [10_000]) / 100);
  return `${km} km ÷ ${remarkNumber(kmPerLiter)} km/L × ₱${remarkPesos(price)}/L`;
}

/** Excess mileage (§1): max(0, roundTrip − allowance × days) × rate. */
export function excessMileage(
  card: RateCardData,
  oneWayKm: number,
  days: number,
  excessPerKm: number,
): { km: number; amount: number } {
  const roundTripM = kmToMetres(oneWayKm) * 2;
  const allowanceM = Math.round(card.mileageAllowanceKmPerDay * 1000) * days;
  const excessM = Math.max(0, roundTripM - allowanceM);
  return { km: excessM / 1000, amount: mulDiv([excessM, excessPerKm], [1000]) };
}

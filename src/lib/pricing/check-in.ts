/**
 * Charges added at check-in (bookings-and-movement.md §5) and extension
 * pricing (Phase 2b). Pure; integer centavos.
 *
 * Return:
 *   1. Excess km   = max(0, actual km − allowance × billed days) × excess ₱/km
 *                    (pricing.md §1), minus excess km already charged on the quote.
 *   2. Fuel short  = tank litres × missing eighths ÷ 8 × fuel price, rounded up
 *                    to ₱1 (PLAN Q6).
 *   3. Late return = more than `graceMinutes` after the planned end: every late
 *                    hour (rounded up) at the hourly extension rate (Self-Drive,
 *                    pricing.md §2.2) or the excess-hour rate (With Driver, §3.2).
 */
import type { PricingBasis } from "./inputs";
import { ceilTo, mulDiv, remarkNumber, remarkPesos } from "./math";
import type { RateCardData } from "./rate-card";
import { selfDriveSchedule } from "./schedule";
import { BODY_TYPE_LABELS, type BodyType, type Service } from "./types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Fuel shortage is rounded up to the whole peso (PLAN Q6). */
const PESO = 100;

export type CheckInChargeKind = "excess_km" | "fuel_shortage" | "extension";

export type CheckInLine = {
  kind: CheckInChargeKind;
  /** Stored as `booking_charges.code`. */
  code: "check_in_excess_km" | "check_in_fuel_shortage" | "check_in_late_return";
  label: string;
  remark: string;
  amount: number;
};

/** Hourly rate for extensions and late returns. */
export function hourlyRateFor(
  card: RateCardData,
  service: Service,
  bodyType: BodyType,
  pricingBasis: PricingBasis | null = null,
): number {
  if (service === "self_drive") return card.selfDrive.hourlyExtension[bodyType];
  const r = card.withDriver.excessHourRates[bodyType];
  return (pricingBasis ?? "all_in") === "all_in" ? r.allIn : r.rentersFuel;
}

/** Whole hours between two instants, rounded up (0 when `to` ≤ `from`). */
export function hoursBetweenCeil(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return ms > 0 ? Math.ceil(ms / HOUR_MS) : 0;
}

/**
 * Billed rental days for the mileage allowance: the quoted days, or the
 * days the (possibly extended) schedule covers, whichever is more.
 * Self-Drive uses the quotation schedule rule (additional-hours blocks are
 * not a day); With Driver counts started 24 h periods.
 */
export function billedDays(service: Service, startAt: Date, endAt: Date, quotedDays: number | null): number {
  let fromSchedule = 1;
  if (endAt > startAt) {
    fromSchedule =
      service === "self_drive"
        ? selfDriveSchedule(startAt, endAt).days
        : Math.max(1, Math.ceil((endAt.getTime() - startAt.getTime()) / DAY_MS));
  }
  return Math.max(fromSchedule, quotedDays ?? 0, 1);
}

export type ReturnChargeInput = {
  service: Service;
  bodyType: BodyType;
  /** With Driver quotes only. */
  pricingBasis?: PricingBasis | null;
  billedDays: number;
  releaseOdometerKm: number;
  returnOdometerKm: number;
  /** Excess-mileage centavos already on the booking from the quotation. */
  quotedExcessCentavos: number;
  /** Null = unknown: no fuel charge, with a warning. */
  tankCapacityL: number | null;
  releaseFuelEighths: number;
  returnFuelEighths: number;
  /** Centavos per litre for the vehicle's fuel type (settings). */
  fuelPricePerLiter: number;
  plannedEndAt: Date;
  actualReturnAt: Date;
  graceMinutes: number;
};

export type ReturnCharges = {
  lines: CheckInLine[];
  total: number;
  actualKm: number;
  allowanceKm: number;
  excessKm: number;
  missingEighths: number;
  lateMinutes: number;
  lateHours: number;
  warnings: string[];
};

export function computeReturnCharges(card: RateCardData, input: ReturnChargeInput): ReturnCharges {
  const lines: CheckInLine[] = [];
  const warnings: string[] = [];
  const cls = card.vehicleClasses[input.bodyType];

  // 1. Excess km
  const actualKm = input.returnOdometerKm - input.releaseOdometerKm;
  if (actualKm < 0) throw new RangeError("Return odometer is below the release odometer.");
  const allowanceKm = card.mileageAllowanceKmPerDay * input.billedDays;
  const excessKm = Math.max(0, actualKm - allowanceKm);
  const gross = mulDiv([Math.round(excessKm * 1000), cls.excessPerKm], [1000]);
  const excessAmount = Math.max(0, gross - input.quotedExcessCentavos);
  if (excessAmount > 0) {
    const quoted = input.quotedExcessCentavos > 0 ? ` − ₱${remarkPesos(input.quotedExcessCentavos)} quoted` : "";
    lines.push({
      kind: "excess_km",
      code: "check_in_excess_km",
      label: "Excess mileage",
      remark: `(${remarkNumber(actualKm)} − ${remarkNumber(allowanceKm)}) km × ₱${remarkPesos(cls.excessPerKm)}${quoted}`,
      amount: excessAmount,
    });
  }

  // 2. Fuel shortage
  const missingEighths = Math.max(0, input.releaseFuelEighths - input.returnFuelEighths);
  if (missingEighths > 0) {
    if (input.tankCapacityL === null || input.tankCapacityL <= 0) {
      warnings.push("The vehicle has no tank capacity on file, so the fuel shortage is not charged. Add it at Fleet, or add a manual charge.");
    } else {
      const amount = ceilTo(mulDiv([input.tankCapacityL, missingEighths, input.fuelPricePerLiter], [8]), PESO);
      lines.push({
        kind: "fuel_shortage",
        code: "check_in_fuel_shortage",
        label: "Fuel shortage",
        remark: `${remarkNumber(input.tankCapacityL)} L × ${missingEighths}/8 × ₱${remarkPesos(input.fuelPricePerLiter)}/L`,
        amount,
      });
    }
  }

  // 3. Late return
  const lateMinutes = Math.max(0, Math.floor((input.actualReturnAt.getTime() - input.plannedEndAt.getTime()) / MINUTE_MS));
  let lateHours = 0;
  if (lateMinutes > input.graceMinutes) {
    lateHours = Math.ceil(lateMinutes / 60);
    const rate = hourlyRateFor(card, input.service, input.bodyType, input.pricingBasis ?? null);
    lines.push({
      kind: "extension",
      code: "check_in_late_return",
      label: "Late return",
      remark: `${lateHours} h × ₱${remarkPesos(rate)} (${BODY_TYPE_LABELS[input.bodyType]})`,
      amount: lateHours * rate,
    });
  }

  return {
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0),
    actualKm,
    allowanceKm,
    excessKm,
    missingEighths,
    lateMinutes,
    lateHours,
    warnings,
  };
}

export type ExtensionPrice = { hours: number; rate: number; amount: number; label: string; remark: string };

/** Extra hours from the current end to the new end, priced per hour (rounded up). */
export function priceExtension(
  card: RateCardData,
  input: { service: Service; bodyType: BodyType; pricingBasis?: PricingBasis | null; currentEndAt: Date; newEndAt: Date },
): ExtensionPrice {
  const hours = hoursBetweenCeil(input.currentEndAt, input.newEndAt);
  const rate = hourlyRateFor(card, input.service, input.bodyType, input.pricingBasis ?? null);
  const amount = hours * rate;
  return {
    hours,
    rate,
    amount,
    label: input.service === "self_drive" ? "Hourly extension" : "Excess hours",
    remark: `(${remarkPesos(rate)} × ${hours}) = ${remarkPesos(amount)}`,
  };
}

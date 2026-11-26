/**
 * With Driver pricing (docs/reference/pricing.md §3). Pure: no DB access.
 */
import { manilaDateKey, manilaToUtc, addDaysToKey } from "@/lib/time";
import {
  excessMileage,
  fuelCost,
  fuelPriceFor,
  fuelRemark,
  line,
  parseInput,
  sum,
  terminalFee,
  timesRemark,
} from "./common";
import { withDriverInputSchema, type WithDriverInput, type WithDriverParsed } from "./inputs";
import { applyBps, ceilTo, mulDiv, remarkNumber, remarkPesos } from "./math";
import type { RateCardData } from "./rate-card";
import { rewardsLines, type RewardsRedemption } from "./rewards";
import {
  BODY_TYPE_LABELS,
  PricingInputError,
  rateKeyFor,
  SERVICE_AREA_LABELS,
  type PriceLine,
  type PricingContext,
} from "./types";

export const WD_HOURS_TIERS = [8, 10, 12, 24] as const;
export type WdHoursTier = (typeof WD_HOURS_TIERS)[number];

const MINUTE_MS = 60_000;

export type WithDriverResult = {
  service: "with_driver";
  inputs: WithDriverParsed;
  contractMinutes: number;
  hoursTier: WdHoursTier;
  isHoliday: boolean;
  /** Days the lines are multiplied by (1 for pick-up/drop-off and airport transfer). */
  billingDays: number;
  /** Per-day driver fee after the holiday multiplier. */
  driverFeePerDay: number;
  lines: PriceLine[];
  subtotal: number;
  discounts: PriceLine[];
  /** Subtotal − discount. */
  total: number;
  terminalFees: { rental: number; reservation: number };
  corporateMarkup: number;
  /** Total + terminal fees + corporate mark-up. */
  grandTotal: number;
  payable: {
    reservationFee: number;
    /** Reservation fee + its terminal fee. */
    dueToday: number;
    balanceOnRelease: number;
  };
  /** Excess-hour rates for the client copy; per hour, not added to the total. */
  supplemental: PriceLine[];
  /** Points redemption (pricing.md §4); deducted when the booking is confirmed. */
  rewards: RewardsRedemption | null;
  warnings: string[];
};

/** Smallest tier ≥ contract hours (fix B8). */
export function hoursTierFor(contractMinutes: number): WdHoursTier {
  const tier = WD_HOURS_TIERS.find((h) => h * 60 >= contractMinutes);
  if (!tier) throw new PricingInputError("Contract is longer than 24 hours for one day; split it into days.");
  return tier;
}

/** Index of the one-way distance band. Above the last bound uses the last band. */
export function distanceBand(card: RateCardData, oneWayKm: number): number {
  const bands = card.withDriver.driverFee.bandMaxKm;
  const i = bands.findIndex((max) => oneWayKm <= max);
  return i === -1 ? bands.length - 1 : i;
}

function bandLabel(card: RateCardData, band: number): string {
  const bands = card.withDriver.driverFee.bandMaxKm;
  const from = band === 0 ? 1 : bands[band - 1] + 1;
  return band === bands.length - 1 ? `${from}+ km` : `${from}–${bands[band]} km`;
}

/**
 * Minutes of [start, end) inside the night window 22:01–06:00 (Asia/Manila).
 * Checks the night before the start date and the night of the start date.
 */
export function nightMinutes(start: Date, end: Date): number {
  const day = manilaDateKey(start);
  let total = 0;
  for (const offset of [-1, 0]) {
    const nightStart = manilaToUtc(addDaysToKey(day, offset), "22:01").getTime();
    const nightEnd = manilaToUtc(addDaysToKey(day, offset + 1), "06:00").getTime();
    const overlap = Math.min(end.getTime(), nightEnd) - Math.max(start.getTime(), nightStart);
    if (overlap > 0) total += overlap;
  }
  return Math.round(total / MINUTE_MS);
}

export function priceWithDriver(
  rawInput: WithDriverInput,
  card: RateCardData,
  ctx: PricingContext = { holidays: [] },
): WithDriverResult {
  const input = parseInput(withDriverInputSchema, rawInput);
  const wd = card.withDriver;
  const cls = card.vehicleClasses[input.bodyType];
  const key = rateKeyFor(input.bodyType, input.category);
  const warnings: string[] = [];
  const lines: PriceLine[] = [];

  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  const contractMinutes = Math.round((end.getTime() - start.getTime()) / MINUTE_MS);
  if (contractMinutes <= 0) throw new PricingInputError("End time must be after start time.");
  const hoursTier = hoursTierFor(contractMinutes);
  const tier = `h${hoursTier}` as const;

  const isTransfer = input.package !== "round_trip";
  const billingDays = isTransfer ? 1 : input.days;
  if (isTransfer && input.days > 1) {
    warnings.push("Pick-up/drop-off and airport transfer are priced as one trip; days set to 1.");
  }

  const startDate = manilaDateKey(start);
  const isHoliday =
    input.event === "holiday" || (input.event === "auto" && ctx.holidays.includes(startDate));

  // 1. Rental rate
  let rate: number;
  let rateLabel = "Rental rate";
  if (billingDays >= wd.longTermFromDays) {
    const lt = wd.longTerm[input.bodyType][input.serviceArea];
    const full = billingDays >= wd.longTermFullFromDays;
    rate = full ? lt.d30 : lt.d15to29;
    rateLabel = `Rental rate (${full ? `${wd.longTermFullFromDays}+` : `${wd.longTermFromDays}–${wd.longTermFullFromDays - 1}`} days, ${SERVICE_AREA_LABELS[input.serviceArea]})`;
  } else {
    rate = wd.daily[key][tier];
  }
  lines.push(line("rental", rateLabel, rate * billingDays, timesRemark(rate, billingDays, rate * billingDays)));

  // 2. Additional hours (car)
  if (input.additionalHoursBlock) {
    const amount = wd.additionalHoursCar[key][`h${input.additionalHoursBlock}`];
    lines.push(
      line("additional_hours", `Additional hours (${input.additionalHoursBlock}h)`, amount, `${input.additionalHoursBlock}h block = ${remarkPesos(amount)}`),
    );
  }

  // 3. CDW, always included
  const cdw = cls.cdwPerDay * billingDays;
  lines.push(line("cdw", "CDW", cdw, timesRemark(cls.cdwPerDay, billingDays, cdw)));

  // 4. Carwash
  lines.push(line("carwash", "Carwash", cls.carwash, `${BODY_TYPE_LABELS[input.bodyType]} carwash`));

  // 5. Driver's fee (§3.3)
  const band = distanceBand(card, input.oneWayDistanceKm);
  let baseFee: number;
  let feeBasis: string;
  if (input.driverRateMode === "working_hour") {
    if (!isTransfer || input.oneWayDistanceKm >= wd.workingHourMaxKm) {
      throw new PricingInputError(
        `Working-hour driver rate is only for pick-up/drop-off or airport transfer under ${remarkNumber(wd.workingHourMaxKm)} km one way.`,
      );
    }
    baseFee = wd.workingHourFee;
    feeBasis = "working hour";
  } else {
    baseFee = wd.driverFee[tier][band];
    feeBasis = `${hoursTier}h, ${bandLabel(card, band)}`;
  }
  const fee = isHoliday ? baseFee * wd.holidayMultiplier : baseFee;
  if (isHoliday) feeBasis += `, holiday ×${wd.holidayMultiplier}`;

  if (input.drivingTerm === "back_and_forth") {
    lines.push(line("driver_fee", "Driver's fee", fee * billingDays, `${timesRemark(fee, billingDays, fee * billingDays)} · ${feeBasis}`));
  } else {
    // Long-term parking (fix B6): lines only when the days exist.
    lines.push(line("driver_first_day", "Driver's fee (first day)", fee, feeBasis));
    if (billingDays >= 3) {
      const standby = Math.max(0, fee - wd.standbyDeduction);
      const standbyDays = billingDays - 2;
      lines.push(
        line("driver_standby", "Driver standby", standby * standbyDays, `(${remarkPesos(fee)} − ${remarkPesos(wd.standbyDeduction)}) × ${standbyDays} = ${remarkPesos(standby * standbyDays)}`),
      );
    }
    if (billingDays >= 2) {
      lines.push(line("driver_last_day", "Driver's fee (last day)", fee, feeBasis));
    }
  }

  // 6. Additional hours (driver), same band
  if (input.additionalHoursBlock) {
    const amount = wd.driverFee[`h${input.additionalHoursBlock}`][band];
    lines.push(
      line("additional_hours_driver", `Additional hours, driver (${input.additionalHoursBlock}h)`, amount, bandLabel(card, band)),
    );
  }

  // 7–8. Accommodation, meal
  if (input.accommodationPerDay > 0) {
    const amount = input.accommodationPerDay * billingDays;
    lines.push(line("accommodation", "Accommodation", amount, timesRemark(input.accommodationPerDay, billingDays, amount)));
  }
  if (input.mealPerDay > 0) {
    const amount = input.mealPerDay * billingDays;
    lines.push(line("meal", "Meal", amount, timesRemark(input.mealPerDay, billingDays, amount)));
  }

  // 9. Fuel (all-in only)
  if (input.pricingBasis === "all_in" && input.oneWayDistanceKm > 0) {
    const { price } = fuelPriceFor(input.bodyType, input.fuelType, input.fuelPrices);
    const amount = fuelCost(input.oneWayDistanceKm, wd.fuelFactorTenths, cls.kmPerLiter, price);
    if (amount > 0) {
      lines.push(line("fuel", "Fuel", amount, fuelRemark(input.oneWayDistanceKm, wd.fuelFactorTenths, cls.kmPerLiter, price)));
    }
  }

  // 10. Excess mileage
  const excess = excessMileage(card, input.oneWayDistanceKm, billingDays, cls.excessPerKm);
  if (excess.amount > 0) {
    lines.push(
      line("excess_km", "Excess mileage", excess.amount, `${remarkNumber(excess.km)} km × ₱${remarkPesos(cls.excessPerKm)}`),
    );
  }

  // 11. Night differential. The 24h tier already pays the driver for the
  // whole day, so it has none (decision 2026-11-23; matches golden WD-2).
  if (hoursTier !== 24) {
    const night = nightMinutes(start, end);
    if (night > 0) {
      const amount = mulDiv([fee, wd.nightDiffBps, night, billingDays], [10_000, contractMinutes]);
      if (amount > 0) {
        lines.push(
          line("night_diff", "Night differential", amount, `${wd.nightDiffBps / 100}% × ${remarkNumber(night / 60)}h night ÷ ${remarkNumber(contractMinutes / 60)}h × ${billingDays} day(s)`),
        );
      }
    }
  }

  // 12. Rounding adjustment (PLAN Q1, fix B7)
  const beforeRounding = sum(lines);
  const rounding = ceilTo(beforeRounding, wd.roundingStep) - beforeRounding;
  if (rounding > 0) {
    lines.push(line("rounding", "Rounding adjustment", rounding, `Up to the next ₱${remarkPesos(wd.roundingStep)}`));
  }

  // 13. Service fee (fix B7)
  lines.push(line("service_fee", "Service fee", wd.serviceFee));

  const subtotal = sum(lines);
  const discounts: PriceLine[] = [];
  if (input.discount > 0) discounts.push(line("discount", "Less discount", -input.discount));
  let total = subtotal + sum(discounts);
  if (total < 0) {
    warnings.push("Discount exceeds the subtotal; total set to ₱0.00.");
    total = 0;
  }

  // Rewards (pricing.md §4): never below ₱0. Free hours use the Self-Drive hourly table.
  const rw = rewardsLines(card, input.bodyType, input, total);
  if (rw.line) lines.push(rw.line);
  if (rw.discount) {
    discounts.push(rw.discount);
    total += rw.discount.amount;
  }
  warnings.push(...rw.warnings);

  const terminalFees = {
    rental: terminalFee(card, total, input.paymentMethods.rental),
    reservation: terminalFee(card, input.reservationFee, input.paymentMethods.reservation),
  };
  const withFees = total + terminalFees.rental + terminalFees.reservation;
  const corporateMarkup =
    input.clientType === "corporate" ? applyBps(withFees, input.corporateMarkupBps) : 0;
  if (input.clientType !== "corporate" && input.corporateMarkupBps > 0) {
    warnings.push("Corporate mark-up ignored for an individual client.");
  }
  const grandTotal = withFees + corporateMarkup;
  const dueToday = input.reservationFee + terminalFees.reservation;

  const ehr = wd.excessHourRates[input.bodyType];
  const perHour = input.pricingBasis === "all_in" ? ehr.allIn : ehr.rentersFuel;
  const supplemental = [line("excess_hour", "Excess hour (per hour)", perHour, input.pricingBasis === "all_in" ? "All-in" : "Renter's fuel")];

  return {
    service: "with_driver",
    inputs: input,
    contractMinutes,
    hoursTier,
    isHoliday,
    billingDays,
    driverFeePerDay: fee,
    lines,
    subtotal,
    discounts,
    total,
    terminalFees,
    corporateMarkup,
    grandTotal,
    payable: {
      reservationFee: input.reservationFee,
      dueToday,
      balanceOnRelease: grandTotal - dueToday,
    },
    supplemental,
    rewards: rw.redemption,
    warnings,
  };
}

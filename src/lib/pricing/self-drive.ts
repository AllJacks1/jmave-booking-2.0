/**
 * Self-Drive pricing (docs/reference/pricing.md §2). Pure: no DB access.
 */
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
import { selfDriveInputSchema, type SelfDriveInput, type SelfDriveParsed } from "./inputs";
import { applyBps, remarkNumber, remarkPesos } from "./math";
import type { RateCardData } from "./rate-card";
import { BODY_TYPE_LABELS, rateKeyFor, type PriceLine, type PricingContext } from "./types";

export type SelfDrivePayable = {
  terminalFees: { rental: number; reservation: number; deposit: number };
  reservationFee: number;
  deliveryFee: number;
  deposit: number;
  /** Reservation fee (+ its terminal fee) + delivery fee, collected today. */
  dueToday: number;
  /** Rental total + deposit + terminal fees. */
  totalContractValue: number;
  /** Total contract value − due today. */
  balanceOnRelease: number;
};

export type SelfDriveResult = {
  service: "self_drive";
  inputs: SelfDriveParsed;
  lines: PriceLine[];
  subtotal: number;
  discounts: PriceLine[];
  /** Rental total = subtotal + discounts (discounts are negative). */
  total: number;
  payable: SelfDrivePayable;
  warnings: string[];
};

export function priceSelfDrive(
  rawInput: SelfDriveInput,
  card: RateCardData,
  // Self-Drive has no holiday rule yet; ctx is part of the shared signature (PLAN §6.3).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _ctx: PricingContext = { holidays: [] },
): SelfDriveResult {
  const input = parseInput(selfDriveInputSchema, rawInput);
  const sd = card.selfDrive;
  const cls = card.vehicleClasses[input.bodyType];
  const key = rateKeyFor(input.bodyType, input.category);
  const days = input.days;
  const warnings: string[] = [];
  const lines: PriceLine[] = [];
  const tier = `h${input.hoursTier}` as const;

  // 1. Rental rate
  const baseRate = sd.daily[key][tier];
  if (input.promo === "CITY_SAVER" || input.promo === "CITY_SAVER_PLUS") {
    const flat = input.promo === "CITY_SAVER" ? sd.promos.citySaver : sd.promos.citySaverPlus;
    const name = input.promo === "CITY_SAVER" ? "City Saver" : "City Saver Plus";
    lines.push(line("rental", "Rental rate", flat, `${name} flat rate = ${remarkPesos(flat)}`));
    if (input.sevenDayDiscount) warnings.push(`7-day discount not applied: ${name} is a flat rate.`);
  } else {
    let rate = baseRate;
    if (input.sevenDayDiscount) {
      if (days >= sd.sevenDayMinDays) rate = Math.max(0, baseRate - sd.sevenDayDiscountPerDay);
      else warnings.push(`7-day discount needs ${sd.sevenDayMinDays}+ days; not applied.`);
    }
    lines.push(line("rental", "Rental rate", rate * days, timesRemark(rate, days, rate * days)));
  }
  const rentalLine = lines[0].amount;

  // 2. Additional hours block
  if (input.additionalHoursBlock) {
    const amount = sd.additionalHours[key][`h${input.additionalHoursBlock}`];
    lines.push(
      line("additional_hours", `Additional hours (${input.additionalHoursBlock}h)`, amount, `${input.additionalHoursBlock}h block = ${remarkPesos(amount)}`),
    );
  }

  // 3. CDW: per day, plus one more day for an additional-hours block
  if (input.withCdw) {
    const cdwDays = days + (input.additionalHoursBlock ? 1 : 0);
    const amount = cls.cdwPerDay * cdwDays;
    lines.push(line("cdw", "CDW", amount, timesRemark(cls.cdwPerDay, cdwDays, amount)));
  }

  // 4. Carwash, once
  lines.push(line("carwash", "Carwash", cls.carwash, `${BODY_TYPE_LABELS[input.bodyType]} carwash`));

  // 5. Delivery / pick-up as typed
  if (input.deliveryFee > 0) lines.push(line("delivery_fee", "Delivery fee", input.deliveryFee));
  if (input.pickupFee > 0) lines.push(line("pickup_fee", "Pick-up fee", input.pickupFee));

  // 6. OT premium, once (PLAN Q10)
  if (input.otPremiumSlot !== "none") {
    const amount = input.otPremiumSlot === "evening" ? sd.otPremium.evening : sd.otPremium.overnight;
    const slot = input.otPremiumSlot === "evening" ? "7:01 PM – 1:00 AM" : "1:01 AM – 6:00 AM";
    lines.push(line("ot_premium", "OT premium", amount, slot));
  }

  // 7. Beyond operating hours
  if (input.beyondOperatingHours) {
    const amount = sd.beyondOperatingHoursPerDay * days;
    lines.push(
      line("beyond_hours", "Beyond operating hours", amount, timesRemark(sd.beyondOperatingHoursPerDay, days, amount)),
    );
  }

  // 8. Hourly extension
  if (input.extensionHours > 0) {
    const rate = sd.hourlyExtension[input.bodyType];
    const amount = rate * input.extensionHours;
    lines.push(line("extension", "Hourly extension", amount, timesRemark(rate, input.extensionHours, amount)));
  }

  // 9. Fuel (PLAN Q2: behind includeFuel)
  if (input.includeFuel && input.oneWayDistanceKm > 0) {
    const { price } = fuelPriceFor(input.bodyType, input.fuelType, input.fuelPrices);
    const amount = fuelCost(input.oneWayDistanceKm, 20, cls.kmPerLiter, price);
    if (amount > 0) {
      lines.push(line("fuel", "Fuel", amount, fuelRemark(input.oneWayDistanceKm, 20, cls.kmPerLiter, price)));
    }
  }

  // 10. Excess mileage (fix B3: allowance × days)
  const excess = excessMileage(card, input.oneWayDistanceKm, days, cls.excessPerKm);
  if (excess.amount > 0) {
    lines.push(
      line(
        "excess_km",
        "Excess mileage",
        excess.amount,
        `${remarkNumber(excess.km)} km × ₱${remarkPesos(cls.excessPerKm)}`,
      ),
    );
  }

  const subtotal = sum(lines);

  // Discounts (negative lines)
  const discounts: PriceLine[] = [];
  if (input.promo === "APRIL_TIERED") {
    const p = sd.promos.aprilTiered;
    const bps = days >= p.longFromDays ? p.longBps : p.shortBps;
    const amount = applyBps(rentalLine, bps);
    discounts.push(line("promo_april", "April promo", -amount, `${bps / 100}% of ${remarkPesos(rentalLine)}`));
  }
  if (!input.clientIsRepeat) {
    const amount = applyBps(rentalLine, sd.newClientDiscountBps);
    discounts.push(
      line("new_client", "New client discount", -amount, `${sd.newClientDiscountBps / 100}% of ${remarkPesos(rentalLine)}`),
    );
  }

  let total = subtotal + sum(discounts);
  if (total < 0) {
    warnings.push("Discounts exceed the subtotal; total set to ₱0.00.");
    total = 0;
  }

  // Payable block
  const m = input.paymentMethods;
  const terminalFees = {
    rental: terminalFee(card, total, m.rental),
    reservation: terminalFee(card, input.reservationFee, m.reservation),
    deposit: terminalFee(card, input.deposit, m.deposit),
  };
  const totalContractValue =
    total + input.deposit + terminalFees.rental + terminalFees.reservation + terminalFees.deposit;
  const dueToday = input.reservationFee + terminalFees.reservation + input.deliveryFee;

  return {
    service: "self_drive",
    inputs: input,
    lines,
    subtotal,
    discounts,
    total,
    payable: {
      terminalFees,
      reservationFee: input.reservationFee,
      deliveryFee: input.deliveryFee,
      deposit: input.deposit,
      dueToday,
      totalContractValue,
      balanceOnRelease: totalContractValue - dueToday,
    },
    warnings,
  };
}

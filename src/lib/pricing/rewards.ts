/**
 * Rewards (docs/reference/pricing.md §4). Pure: no DB access.
 *
 * - Earn 50 points per rental day when a booking is returned.
 * - 50 points = ₱1.
 * - Redeem as a peso discount (`pesos = floor(points ÷ 50)`, negative line
 *   "Rewards redemption") or as free hours (`points = hours × hourly
 *   extension rate × 50`, a ₱0 line "Free hours (rewards)").
 * - A redemption never makes the rental total negative.
 */
import { z } from "zod";
import { line } from "./common";
import { remarkNumber, remarkPesos } from "./math";
import type { RateCardData } from "./rate-card";
import { BODY_TYPE_LABELS, PricingInputError, type BodyType, type PriceLine } from "./types";

export const POINTS_PER_PESO = 50;
export const POINTS_PER_RENTAL_DAY = 50;

export const REWARDS_MODES = ["none", "discount", "free_hours"] as const;
export type RewardsMode = (typeof REWARDS_MODES)[number];
export const REWARDS_MODE_LABELS: Record<RewardsMode, string> = {
  none: "None",
  discount: "Peso discount",
  free_hours: "Free hours",
};

/** Engine input fields (both services). */
export const rewardsInputShape = {
  rewardsMode: z.enum(REWARDS_MODES).default("none"),
  /** Discount: points to spend (whole pesos only are used). */
  rewardsPoints: z.number().int("Whole points").min(0, "Cannot be negative").max(100_000_000).default(0),
  /** Free hours: hours to give. */
  rewardsHours: z.number().int("Whole hours").min(0, "Cannot be negative").max(240).default(0),
};

/** What a priced quotation redeems. `points` is what confirming the booking deducts. */
export type RewardsRedemption =
  | { mode: "discount"; points: number; amount: number }
  | { mode: "free_hours"; points: number; hours: number; ratePerHour: number };

/** Points earned for a returned booking. */
export function pointsForRentalDays(days: number): number {
  if (!Number.isInteger(days) || days < 0) throw new RangeError("Rental days must be a whole number ≥ 0.");
  return days * POINTS_PER_RENTAL_DAY;
}

/** Peso value of a points balance, centavos (whole pesos; a negative balance is worth 0). */
export function pointsValueCentavos(points: number): number {
  return Math.max(0, Math.floor(points / POINTS_PER_PESO)) * 100;
}

/** Points a number of free hours costs for a body type. */
export function freeHoursPoints(card: RateCardData, bodyType: BodyType, hours: number): number {
  const rate = card.selfDrive.hourlyExtension[bodyType];
  // rate is centavos: ₱300/h = 30,000 → 300 × 50 = 15,000 points.
  return Math.ceil((hours * rate * POINTS_PER_PESO) / 100);
}

type RewardsFields = { rewardsMode: RewardsMode; rewardsPoints: number; rewardsHours: number };

export type RewardsLines = {
  /** ₱0 free-hours line (goes with the other lines). */
  line: PriceLine | null;
  /** Negative discount line (goes with the discounts). */
  discount: PriceLine | null;
  redemption: RewardsRedemption | null;
  warnings: string[];
};

/**
 * Lines for a redemption. `room` = the total before the redemption
 * (centavos); the discount is capped to whole pesos within it.
 */
export function rewardsLines(card: RateCardData, bodyType: BodyType, input: RewardsFields, room: number): RewardsLines {
  const warnings: string[] = [];
  if (input.rewardsMode === "free_hours") {
    if (input.rewardsHours < 1) throw new PricingInputError("Free hours: enter at least 1 hour.");
    const ratePerHour = card.selfDrive.hourlyExtension[bodyType];
    const points = freeHoursPoints(card, bodyType, input.rewardsHours);
    return {
      line: line(
        "rewards_free_hours",
        "Free hours (rewards)",
        0,
        `${remarkNumber(input.rewardsHours)}h × ₱${remarkPesos(ratePerHour)} (${BODY_TYPE_LABELS[bodyType]}) = ${remarkNumber(points)} points`,
      ),
      discount: null,
      redemption: { mode: "free_hours", points, hours: input.rewardsHours, ratePerHour },
      warnings,
    };
  }
  if (input.rewardsMode === "discount") {
    const wanted = Math.floor(input.rewardsPoints / POINTS_PER_PESO);
    if (wanted < 1) throw new PricingInputError(`Rewards discount: enter at least ${POINTS_PER_PESO} points (₱1).`);
    const cap = Math.max(0, Math.floor(room / 100));
    const pesos = Math.min(wanted, cap);
    if (pesos < wanted) warnings.push(`Rewards discount limited to ₱${remarkNumber(pesos)} so the total does not go below ₱0.`);
    if (input.rewardsPoints % POINTS_PER_PESO !== 0 && pesos === wanted) {
      warnings.push(`Only whole pesos are redeemed: ${remarkNumber(pesos * POINTS_PER_PESO)} points are used.`);
    }
    if (pesos === 0) return { line: null, discount: null, redemption: null, warnings };
    const amount = pesos * 100;
    const points = pesos * POINTS_PER_PESO;
    return {
      line: null,
      discount: line("rewards_discount", "Rewards redemption", -amount, `${remarkNumber(points)} points`),
      redemption: { mode: "discount", points, amount },
      warnings,
    };
  }
  return { line: null, discount: null, redemption: null, warnings };
}

/**
 * Shared pricing types and enums (docs/reference/pricing.md §1).
 * Pure module: no DB, no server-only imports. Money is integer centavos.
 */

export const BODY_TYPES = ["compact", "sedan", "wagon", "mpv", "suv", "pickup", "van"] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const CATEGORIES = ["budgetmile", "primo", "premium"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Which categories each body type has. Empty = one standard rate. */
export const BODY_CATEGORIES: Record<BodyType, readonly Category[]> = {
  compact: [],
  sedan: ["budgetmile", "primo", "premium"],
  wagon: [],
  mpv: ["budgetmile", "primo"],
  suv: ["budgetmile", "primo"],
  pickup: [],
  van: [],
};

/** One rate row: a body type, plus its category when it has categories. */
export const RATE_KEYS = [
  "sedan_budgetmile",
  "sedan_primo",
  "sedan_premium",
  "mpv_budgetmile",
  "mpv_primo",
  "suv_budgetmile",
  "suv_primo",
  "compact",
  "wagon",
  "pickup",
  "van",
] as const;
export type RateKey = (typeof RATE_KEYS)[number];

export const FUEL_TYPES = ["gasoline", "premium", "diesel"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const PAYMENT_METHODS = ["cash", "gcash", "card", "bank"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SERVICE_AREAS = ["mindanao", "davao_region", "within_davao_city"] as const;
export type ServiceArea = (typeof SERVICE_AREAS)[number];

export const BODY_TYPE_LABELS: Record<BodyType, string> = {
  compact: "Compact",
  sedan: "Sedan",
  wagon: "Wagon",
  mpv: "MPV",
  suv: "SUV",
  pickup: "Pick-up",
  van: "Van",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  budgetmile: "Budgetmile",
  primo: "Primo",
  premium: "Premium",
};

export const RATE_KEY_LABELS: Record<RateKey, string> = {
  sedan_budgetmile: "Sedan Budgetmile",
  sedan_primo: "Sedan Primo",
  sedan_premium: "Sedan Premium",
  mpv_budgetmile: "MPV Budgetmile",
  mpv_primo: "MPV Primo",
  suv_budgetmile: "SUV Budgetmile",
  suv_primo: "SUV Primo",
  compact: "Compact",
  wagon: "Wagon",
  pickup: "Pick-up",
  van: "Van",
};

export const SERVICE_AREA_LABELS: Record<ServiceArea, string> = {
  mindanao: "Mindanao",
  davao_region: "Davao Region",
  within_davao_city: "Within Davao City",
};

/** Resolve the rate row for a body type + category. Throws on a bad combo. */
export function rateKeyFor(bodyType: BodyType, category?: Category | null): RateKey {
  const cats = BODY_CATEGORIES[bodyType];
  if (cats.length === 0) return bodyType as RateKey;
  if (!category || !cats.includes(category)) {
    throw new PricingInputError(
      `${BODY_TYPE_LABELS[bodyType]} needs a category (${cats.map((c) => CATEGORY_LABELS[c]).join(", ")}).`,
    );
  }
  return `${bodyType}_${category}` as RateKey;
}

/** Default fuel by body type when no specific vehicle is chosen (§1). */
export function defaultFuelType(bodyType: BodyType): FuelType {
  return bodyType === "suv" || bodyType === "pickup" || bodyType === "van" ? "diesel" : "gasoline";
}

/** One priced line. `amount` is signed centavos (discounts are negative). */
export type PriceLine = {
  code: string;
  label: string;
  remark: string;
  amount: number;
};

export type PricingContext = {
  /** Holiday dates `YYYY-MM-DD` (Asia/Manila). */
  holidays: readonly string[];
};

/** Invalid input combination (shown to the user, not a crash). */
export class PricingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingInputError";
  }
}

export const SERVICES = ["self_drive", "with_driver"] as const;
export type Service = (typeof SERVICES)[number];
export const SERVICE_LABELS: Record<Service, string> = {
  self_drive: "Self-Drive",
  with_driver: "With Driver",
};

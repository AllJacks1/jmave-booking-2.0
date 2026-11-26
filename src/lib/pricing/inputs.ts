/**
 * Engine inputs (pricing.md §2.1, §3.1). Shared by the engine, the pricing
 * playground form and (Phase 1c) the quotation forms. Money in centavos.
 * Optional inputs have defaults so blank form fields price cleanly.
 */
import { z } from "zod";
import { rewardsInputShape } from "./rewards";
import { BODY_TYPES, CATEGORIES, FUEL_TYPES, PAYMENT_METHODS, SERVICE_AREAS } from "./types";

const centavos = z.number().int("Whole centavos only").min(0, "Cannot be negative").max(1_000_000_000);
const optionalCentavos = centavos.default(0);
const method = z.enum(PAYMENT_METHODS).default("cash");

export const fuelPricesSchema = z.object({
  gasoline: centavos,
  premium: centavos,
  diesel: centavos,
});

const distanceKm = z
  .number()
  .min(0, "Cannot be negative")
  .max(5_000, "Too far")
  .multipleOf(0.001, "At most 3 decimals")
  .default(0);

const blockHours = z.union([z.literal(8), z.literal(12)]).nullable().default(null);

export const SD_PROMOS = ["none", "APRIL_TIERED", "CITY_SAVER", "CITY_SAVER_PLUS"] as const;
export type SdPromo = (typeof SD_PROMOS)[number];
export const SD_PROMO_LABELS: Record<SdPromo, string> = {
  none: "None",
  APRIL_TIERED: "April tiered promo",
  CITY_SAVER: "City Saver",
  CITY_SAVER_PLUS: "City Saver Plus",
};

export const OT_SLOTS = ["none", "evening", "overnight"] as const;
export type OtSlot = (typeof OT_SLOTS)[number];
export const OT_SLOT_LABELS: Record<OtSlot, string> = {
  none: "None",
  evening: "7:01 PM – 1:00 AM",
  overnight: "1:01 AM – 6:00 AM",
};

export const selfDriveInputSchema = z.object({
  bodyType: z.enum(BODY_TYPES),
  category: z.enum(CATEGORIES).nullable().default(null),
  /** Fuel type of the chosen vehicle; null = by body type. */
  fuelType: z.enum(FUEL_TYPES).nullable().default(null),
  hoursTier: z.union([z.literal(8), z.literal(12), z.literal(24)]),
  days: z.number().int("Whole days").min(1, "At least 1 day").max(365),
  additionalHoursBlock: blockHours,
  extensionHours: z.number().int().min(0).max(240).default(0),
  /** 10:01 PM – 5:29 AM slot chosen. */
  beyondOperatingHours: z.boolean().default(false),
  otPremiumSlot: z.enum(OT_SLOTS).default("none"),
  withCdw: z.boolean().default(false),
  sevenDayDiscount: z.boolean().default(false),
  promo: z.enum(SD_PROMOS).default("none"),
  clientIsRepeat: z.boolean().default(true),
  deliveryFee: optionalCentavos,
  pickupFee: optionalCentavos,
  oneWayDistanceKm: distanceKm,
  includeFuel: z.boolean().default(true),
  fuelPrices: fuelPricesSchema,
  reservationFee: optionalCentavos,
  deposit: optionalCentavos,
  paymentMethods: z
    .object({ rental: method, reservation: method, deposit: method })
    .default({ rental: "cash", reservation: "cash", deposit: "cash" }),
  ...rewardsInputShape,
});
export type SelfDriveInput = z.input<typeof selfDriveInputSchema>;
export type SelfDriveParsed = z.output<typeof selfDriveInputSchema>;

export const WD_PACKAGES = ["round_trip", "pickup_dropoff", "airport_transfer"] as const;
export const WD_PACKAGE_LABELS: Record<(typeof WD_PACKAGES)[number], string> = {
  round_trip: "Round trip",
  pickup_dropoff: "Pick-up / drop-off",
  airport_transfer: "Airport transfer",
};
export const DRIVING_TERMS = ["back_and_forth", "long_term_parking"] as const;
export const DRIVING_TERM_LABELS: Record<(typeof DRIVING_TERMS)[number], string> = {
  back_and_forth: "Back and forth",
  long_term_parking: "Long-term parking",
};
export const DRIVER_RATE_MODES = ["contract_rate", "working_hour"] as const;
export const DRIVER_RATE_MODE_LABELS: Record<(typeof DRIVER_RATE_MODES)[number], string> = {
  contract_rate: "Contract rate",
  working_hour: "Working hour",
};
export const WD_EVENTS = ["auto", "regular", "holiday"] as const;
export const PRICING_BASES = ["all_in", "renters_fuel"] as const;
export type PricingBasis = (typeof PRICING_BASES)[number];
export const PRICING_BASIS_LABELS: Record<(typeof PRICING_BASES)[number], string> = {
  all_in: "All-in (we buy fuel)",
  renters_fuel: "Renter's fuel",
};
export const CLIENT_TYPES = ["individual", "corporate"] as const;

export const withDriverInputSchema = z.object({
  bodyType: z.enum(BODY_TYPES),
  category: z.enum(CATEGORIES).nullable().default(null),
  fuelType: z.enum(FUEL_TYPES).nullable().default(null),
  /** First day's contract window, ISO instants. Gives contract hours. */
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  days: z.number().int("Whole days").min(1, "At least 1 day").max(365),
  oneWayDistanceKm: distanceKm,
  pricingBasis: z.enum(PRICING_BASES).default("all_in"),
  additionalHoursBlock: blockHours,
  package: z.enum(WD_PACKAGES).default("round_trip"),
  drivingTerm: z.enum(DRIVING_TERMS).default("back_and_forth"),
  driverRateMode: z.enum(DRIVER_RATE_MODES).default("contract_rate"),
  /** `auto` = holiday if the start date is in the holiday list. */
  event: z.enum(WD_EVENTS).default("auto"),
  clientType: z.enum(CLIENT_TYPES).default("individual"),
  corporateMarkupBps: z.number().int().min(0).max(10_000).default(0),
  serviceArea: z.enum(SERVICE_AREAS).default("davao_region"),
  mealPerDay: optionalCentavos,
  accommodationPerDay: optionalCentavos,
  fuelPrices: fuelPricesSchema,
  reservationFee: optionalCentavos,
  discount: optionalCentavos,
  paymentMethods: z
    .object({ rental: method, reservation: method })
    .default({ rental: "cash", reservation: "cash" }),
  ...rewardsInputShape,
});
export type WithDriverInput = z.input<typeof withDriverInputSchema>;
export type WithDriverParsed = z.output<typeof withDriverInputSchema>;

/**
 * Quotation form (quick + formal), shared by the client forms and the server
 * actions. Stored as `quotations.inputs`. One flat shape for both services so
 * switching service keeps what was typed; `toEngineInput` picks the fields
 * the chosen service needs. Money in centavos.
 */
import { z } from "zod";
import {
  BODY_TYPES,
  CATEGORIES,
  DRIVER_RATE_MODES,
  DRIVING_TERMS,
  OT_SLOTS,
  PAYMENT_METHODS,
  PRICING_BASES,
  REWARDS_MODES,
  SD_PROMOS,
  SERVICE_AREAS,
  SERVICES,
  WD_EVENTS,
  WD_PACKAGES,
} from "@/lib/pricing";
import { isDateKey } from "@/lib/time";

const centavos = z.number().int("Whole centavos only").min(0, "Cannot be negative").max(1_000_000_000);
const text = (max: number) => z.string().trim().max(max).default("");
const dateKey = z.string().refine(isDateKey, "Enter a valid date");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time");
const method = z.enum(PAYMENT_METHODS).default("cash");

export const REPEAT_MODES = ["auto", "repeat", "new"] as const;

export const quoteFormSchema = z.object({
  service: z.enum(SERVICES),
  // Client
  clientId: z.uuid().nullable().default(null),
  /** Quick quotations: optional free-text name. */
  clientName: text(160),
  /** `auto` = from the client's history (no client → new). */
  repeat: z.enum(REPEAT_MODES).default("auto"),
  // Vehicle
  vehicleId: z.uuid().nullable().default(null),
  bodyType: z.enum(BODY_TYPES),
  category: z.enum(CATEGORIES).nullable().default(null),
  // Schedule. Self-Drive: release → return. With Driver: start date/time and
  // the first day's end time; `wdDays` days.
  startDate: dateKey,
  startTime: time,
  endDate: dateKey,
  endTime: time,
  /** Self-Drive authorized area of use. */
  areaFrom: text(200),
  destination: text(200),
  notes: text(4000),

  // Self-Drive
  scheduleMode: z.enum(["auto", "manual"]).default("auto"),
  hoursTier: z.union([z.literal(8), z.literal(12), z.literal(24)]).default(24),
  days: z.number().int().min(1, "At least 1 day").max(365).default(1),
  additionalHoursBlock: z.union([z.literal(8), z.literal(12)]).nullable().default(null),
  extensionHours: z.number().int().min(0).max(240).default(0),
  otPremiumSlot: z.enum(["auto", ...OT_SLOTS]).default("auto"),
  beyondOperatingHours: z.boolean().default(false),
  withCdw: z.boolean().default(false),
  sevenDayDiscount: z.boolean().default(false),
  promo: z.enum(SD_PROMOS).default("none"),
  deliveryFee: centavos.default(0),
  pickupFee: centavos.default(0),
  includeFuel: z.boolean().default(true),
  deposit: centavos.default(200_000),
  depositMethod: method,

  // Shared
  oneWayDistanceKm: z.number().min(0, "Cannot be negative").max(5_000).default(0),
  fuelPrices: z.object({ gasoline: centavos, premium: centavos, diesel: centavos }),
  reservationFee: centavos.default(50_000),
  rentalMethod: method,
  reservationMethod: method,

  // With Driver
  wdDays: z.number().int().min(1, "At least 1 day").max(365).default(1),
  pricingBasis: z.enum(PRICING_BASES).default("all_in"),
  wdAdditionalHoursBlock: z.union([z.literal(8), z.literal(12)]).nullable().default(null),
  package: z.enum(WD_PACKAGES).default("round_trip"),
  drivingTerm: z.enum(DRIVING_TERMS).default("back_and_forth"),
  driverRateMode: z.enum(DRIVER_RATE_MODES).default("contract_rate"),
  event: z.enum(WD_EVENTS).default("auto"),
  /** `auto` = the client's type. */
  clientType: z.enum(["auto", "individual", "corporate"]).default("auto"),
  corporateMarkupPct: z.number().min(0).max(100).default(0),
  serviceArea: z.enum(SERVICE_AREAS).default("davao_region"),
  mealPerDay: centavos.default(0),
  accommodationPerDay: centavos.default(0),
  discount: centavos.default(0),
  pickupPlace: text(300),
  dropoffPlace: text(300),
  itinerary: text(2000),
  driverName: text(160),
  driverContact: text(60),

  // Rewards (formal quotations, pricing.md §4)
  rewardsMode: z.enum(REWARDS_MODES).default("none"),
  rewardsPoints: z.number().int("Whole points").min(0, "Cannot be negative").max(100_000_000).default(0),
  rewardsHours: z.number().int("Whole hours").min(0, "Cannot be negative").max(240).default(0),
});

export type QuoteFormInput = z.input<typeof quoteFormSchema>;
export type QuoteForm = z.output<typeof quoteFormSchema>;

export const quoteIdSchema = z.object({ id: z.uuid() });

export const saveQuickSchema = z.object({ id: z.uuid().nullable().default(null), form: quoteFormSchema });
export const saveDraftSchema = z.object({ id: z.uuid().nullable().default(null), form: quoteFormSchema });
export const issueSchema = z.object({
  id: z.uuid(),
  form: quoteFormSchema,
  overrideReason: z.string().trim().max(1000).default(""),
});
export const markLostSchema = z.object({ id: z.uuid(), reason: z.string().trim().min(1, "Give a reason").max(1000) });
export const fromQuickSchema = z.object({ form: quoteFormSchema, quickId: z.uuid().nullable().default(null) });

export const QUOTE_LIST_STATUSES = ["all", "draft", "issued", "accepted", "expired", "lost", "cancelled"] as const;
export const quoteListSchema = z.object({
  q: z.string().trim().max(100).default(""),
  status: z.enum(QUOTE_LIST_STATUSES).catch("all").default("all"),
  service: z.enum(["all", ...SERVICES]).catch("all").default("all"),
  kind: z.enum(["all", "quick", "formal"]).catch("all").default("all"),
  consultant: z.union([z.uuid(), z.literal("all")]).catch("all").default("all"),
  from: z.string().refine(isDateKey).optional().catch(undefined),
  to: z.string().refine(isDateKey).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).catch(1).default(1),
});
export type QuoteListQuery = z.output<typeof quoteListSchema>;

/** One row of the client picker. */
export type ClientHit = {
  id: string;
  fullName: string;
  fbName: string | null;
  phone: string | null;
  isBlacklisted: boolean;
  isRepeat: boolean;
  clientType: "individual" | "corporate";
};

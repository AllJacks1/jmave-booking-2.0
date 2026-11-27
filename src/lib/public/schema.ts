/**
 * Public booking page (Phase 4): the request a client sends, shared by the
 * browser wizard and the route handlers (same zod schemas on both sides).
 * Pure module; keep imports light (it ships to the public page bundle).
 */
import { z } from "zod";
import { ID_TYPES } from "@/lib/bookings/constants";
import { DRIVING_TERMS, WD_PACKAGES } from "@/lib/pricing/inputs";
import { PAYMENT_METHODS, SERVICE_AREAS, SERVICES } from "@/lib/pricing/types";
import { normalisePhPhone } from "@/lib/phone";
import { DRIVERS_LICENSE_TYPES } from "@/lib/rework/options";
import { attributionSchema } from "@/lib/rework/payload";
import { isDateKey } from "@/lib/time";

const dateKey = z.string().refine(isDateKey, "Choose a date");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time");
const text = (max: number) => z.string().trim().max(max, `At most ${max} characters`).default("");

/** Step 2: service, dates and times (and trip details for With Driver). */
export const searchSchema = z
  .object({
    service: z.enum(SERVICES),
    startDate: dateKey,
    startTime: time,
    /** Self-Drive return. */
    endDate: dateKey.optional(),
    endTime: time.optional(),
    /** With Driver: end time of each day, number of days. */
    wdEndTime: time.optional(),
    wdDays: z.number().int().min(1, "At least 1 day").max(30, "At most 30 days").default(1),
    package: z.enum(WD_PACKAGES).default("round_trip"),
    drivingTerm: z.enum(DRIVING_TERMS).default("back_and_forth"),
    serviceArea: z.enum(SERVICE_AREAS).default("within_davao_city"),
    /** Optional estimate; 0 = not given (priced as a short trip, confirmed on the formal quotation). */
    oneWayKm: z.number().min(0, "Cannot be negative").max(1500, "Too far").default(0),
    destination: text(200),
    /** Card adds the terminal fee; the summary re-prices with the client's choice. */
    paymentMethod: z.enum(PAYMENT_METHODS).default("cash"),
  })
  .superRefine((v, ctx) => {
    if (v.service === "self_drive") {
      if (!v.endDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Choose a return date" });
      if (!v.endTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "Choose a return time" });
    } else {
      if (!v.wdEndTime) ctx.addIssue({ code: "custom", path: ["wdEndTime"], message: "Choose an end time" });
      if (!v.destination) ctx.addIssue({ code: "custom", path: ["destination"], message: "Where are you going?" });
    }
  });
export type SearchInput = z.input<typeof searchSchema>;
export type Search = z.output<typeof searchSchema>;

export const quoteRequestSchema = z.object({
  search: searchSchema,
  /** Price one vehicle (summary step); omitted = list every available vehicle. */
  vehicleId: z.uuid().optional(),
});

const optText = (max: number) => text(max);
const phone = z
  .string()
  .trim()
  .min(1, "Enter your mobile number")
  .refine((v) => normalisePhPhone(v) !== null, "Enter a valid PH number, e.g. 0917 123 4567");
const optPhone = z
  .string()
  .trim()
  .default("")
  .refine((v) => v === "" || normalisePhPhone(v) !== null, "Enter a valid PH number, e.g. 0917 123 4567");

/** Step 4: details (mirrors the booking record and the Rework fields). */
export const detailsSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter your full name").max(160),
    phone,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(200)
      .default("")
      .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email"),
    birthday: z
      .string()
      .trim()
      .default("")
      .refine((v) => v === "" || isDateKey(v), "Enter a valid date"),
    address: optText(500),
    companyName: optText(160),
    altContactName: optText(160),
    altContactPhone: optPhone,
    driversLicenseNo: optText(40),
    driversLicenseType: z.enum(["", ...DRIVERS_LICENSE_TYPES]).default(""),
    idsPresented: z.array(z.enum(ID_TYPES)).max(ID_TYPES.length).default([]),
    /** Self-Drive: where to deliver the car, and where to collect it at return. */
    deliveryAddress: optText(300),
    /** Self-Drive: collect-at-return address. With Driver: pick-up place. */
    pickupAddress: optText(300),
    /** With Driver: drop-off place. */
    dropoffAddress: optText(300),
    passengers: z.number().int().min(0).max(60).default(0),
    luggage: optText(200),
    itinerary: optText(2000),
    specialRequests: optText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.altContactPhone && !v.altContactName) {
      ctx.addIssue({ code: "custom", path: ["altContactName"], message: "Whose number is this?" });
    }
  });
export type DetailsInput = z.input<typeof detailsSchema>;
export type Details = z.output<typeof detailsSchema>;

export const submitSchema = z.object({
  search: searchSchema,
  vehicleId: z.uuid({ error: "Choose a car" }),
  details: detailsSchema,
  consent: z.literal(true, { error: "Please agree to the privacy notice" }),
  /** Cloudflare Turnstile response token. */
  turnstileToken: z.string().max(4096).default(""),
  /** Honeypot: hidden from people; bots fill it. Must stay empty. */
  website: z.string().max(500).default(""),
  attribution: attributionSchema.default({}),
});
export type SubmitInput = z.input<typeof submitSchema>;
export type Submit = z.output<typeof submitSchema>;

/** One car on the public page. */
export type PublicVehicle = {
  id: string;
  name: string;
  bodyType: string;
  category: string | null;
  transmission: string | null;
  seats: number | null;
  /** Centavos: Self-Drive rental total, With Driver grand total. */
  total: number;
};

export type PublicLine = { label: string; remark: string | null; amount: number };

/** Summary step: the full breakdown for one car. */
export type PublicPriceDetail = PublicVehicle & {
  lines: PublicLine[];
  discounts: PublicLine[];
  /** Payable block rows (reservation fee, deposit, terminal fees, totals). */
  payable: PublicLine[];
  warnings: string[];
  startAt: string;
  endAt: string;
};

export type QuoteResponse =
  | { ok: true; vehicles: PublicVehicle[]; detail: PublicPriceDetail | null; startAt: string; endAt: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type SubmitResponse =
  | { ok: true; reference: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Shortest notice for a public request: the start must be at least this far ahead. */
export const MIN_LEAD_MINUTES = 120;
/** Latest start a public request may ask for. */
export const MAX_AHEAD_DAYS = 365;

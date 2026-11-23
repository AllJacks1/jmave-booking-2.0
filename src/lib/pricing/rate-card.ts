/**
 * Rate card data (pricing.md §1–§3), stored as `rate_cards.data` jsonb.
 * Every amount is integer centavos; percentages are basis points
 * (350 = 3.5%). The zod schema is the only gate into the DB.
 */
import { z } from "zod";
import { BODY_TYPES, RATE_KEYS, SERVICE_AREAS } from "./types";

const centavos = z.number().int("Whole centavos only").min(0, "Cannot be negative");
const bps = z.number().int().min(0).max(10_000);
const positive = z.number().positive("Must be more than 0");

const byBody = <T extends z.ZodType>(v: T) => z.record(z.enum(BODY_TYPES), v);
const byRateKey = <T extends z.ZodType>(v: T) => z.record(z.enum(RATE_KEYS), v);

export const vehicleClassSchema = z.object({
  kmPerLiter: positive,
  carwash: centavos,
  cdwPerDay: centavos,
  excessPerKm: centavos,
});

const sdDailySchema = z.object({ h24: centavos, h12: centavos, h8: centavos });
const wdDailySchema = z.object({ h24: centavos, h12: centavos, h10: centavos, h8: centavos });
const blockSchema = z.object({ h8: centavos, h12: centavos });

const DRIVER_BAND_COUNT = 8;
const bandRow = z.array(centavos).length(DRIVER_BAND_COUNT, `Needs ${DRIVER_BAND_COUNT} bands`);

export const rateCardDataSchema = z
  .object({
    /** Shared by both services (FORMULA!H64:M71, FORMULA WDRIVER!C44:H51). */
    vehicleClasses: byBody(vehicleClassSchema),
    mileageAllowanceKmPerDay: positive,
    /** Terminal fee on card payments, basis points. */
    terminalFeeBps: bps,

    selfDrive: z.object({
      daily: byRateKey(sdDailySchema),
      /** Additional hours block (one extra partial day). Categorised rows follow their category's 8h/12h rate. */
      additionalHours: byRateKey(blockSchema),
      hourlyExtension: byBody(centavos),
      /** Taken off the daily rate when the 7-day discount applies (days > 6). */
      sevenDayDiscountPerDay: centavos,
      sevenDayMinDays: z.number().int().min(1),
      otPremium: z.object({ evening: centavos, overnight: centavos }),
      beyondOperatingHoursPerDay: centavos,
      newClientDiscountBps: bps,
      promos: z.object({
        aprilTiered: z.object({
          shortBps: bps,
          longBps: bps,
          /** Days at which the long rate starts (5). */
          longFromDays: z.number().int().min(1),
        }),
        citySaver: centavos,
        citySaverPlus: centavos,
      }),
    }),

    withDriver: z.object({
      /** 1–14 day trips. */
      daily: byRateKey(wdDailySchema),
      /** Per day for 15–29 days and 30+ days, by service area. */
      longTerm: byBody(
        z.record(z.enum(SERVICE_AREAS), z.object({ d30: centavos, d15to29: centavos })),
      ),
      longTermFromDays: z.number().int().min(2),
      longTermFullFromDays: z.number().int().min(2),
      additionalHoursCar: byRateKey(blockSchema),
      driverFee: z.object({
        /** Upper km bound of each one-way distance band, ascending. Above the last uses the last. */
        bandMaxKm: z.array(positive).length(DRIVER_BAND_COUNT),
        h8: bandRow,
        h10: bandRow,
        h12: bandRow,
        h24: bandRow,
      }),
      workingHourFee: centavos,
      workingHourMaxKm: positive,
      holidayMultiplier: z.number().int().min(1).max(5),
      standbyDeduction: centavos,
      serviceFee: centavos,
      /** Round lines 1–11 up to this step (₱100). */
      roundingStep: z.number().int().min(1),
      /** Fuel km factor ×10 (22 = 2.2: round trip + 10%). */
      fuelFactorTenths: z.number().int().min(10).max(50),
      nightDiffBps: bps,
      /** Excess-hour rates printed on the client copy ("Supplemental charges"). */
      excessHourRates: byBody(z.object({ rentersFuel: centavos, allIn: centavos })),
      /** Stored, not used by the engine (PLAN Q4). */
      unused: z.object({
        pickupDropoffRate: byBody(centavos),
        vanDistanceRate: z.object({ upTo150Km: centavos, above150Km: centavos }),
      }),
    }),
  })
  .superRefine((card, ctx) => {
    const bands = card.withDriver.driverFee.bandMaxKm;
    for (let i = 1; i < bands.length; i++) {
      if (bands[i] <= bands[i - 1]) {
        ctx.addIssue({
          code: "custom",
          path: ["withDriver", "driverFee", "bandMaxKm", i],
          message: "Bands must go up",
        });
      }
    }
  });

export type RateCardData = z.infer<typeof rateCardDataSchema>;
export type VehicleClass = z.infer<typeof vehicleClassSchema>;

/** Flatten a rate card into `path → value` pairs (for diffs and self-checks). */
export function flattenRateCard(value: unknown, prefix = ""): Map<string, number | string | boolean> {
  const out = new Map<string, number | string | boolean>();
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    } else if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
      out.set(path, v);
    }
  };
  walk(value, prefix);
  return out;
}

export type RateCardDiff = { path: string; before: unknown; after: unknown };

/** Every leaf that differs between two cards. */
export function diffRateCards(a: unknown, b: unknown): RateCardDiff[] {
  const fa = flattenRateCard(a);
  const fb = flattenRateCard(b);
  const paths = new Set([...fa.keys(), ...fb.keys()]);
  const diffs: RateCardDiff[] = [];
  for (const path of [...paths].sort()) {
    if (fa.get(path) !== fb.get(path)) {
      diffs.push({ path, before: fa.get(path), after: fb.get(path) });
    }
  }
  return diffs;
}

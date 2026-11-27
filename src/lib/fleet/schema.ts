import { z } from "zod";
import { BODY_CATEGORIES, BODY_TYPES, CATEGORIES, FUEL_TYPES } from "@/lib/pricing/types";

export const OWNERSHIPS = ["owned", "operator", "hired"] as const;
export const OWNERSHIP_LABELS: Record<(typeof OWNERSHIPS)[number], string> = {
  owned: "Owned",
  operator: "Operator",
  hired: "Hired",
};
export const FUEL_TYPE_LABELS: Record<(typeof FUEL_TYPES)[number], string> = {
  gasoline: "Gasoline",
  premium: "Premium",
  diesel: "Diesel",
};

const optText = (max = 120) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null);

const optInt = (min: number, max: number, msg: string) =>
  z.number({ error: msg }).int(msg).min(min, msg).max(max, msg).nullable().default(null);

export const vehicleSchema = z
  .object({
    displayName: z.string().trim().min(1, "Required").max(120),
    plate: z
      .string()
      .trim()
      .max(20)
      .transform((v) => (v === "" ? null : v.toUpperCase().replace(/\s+/g, " ")))
      .nullable()
      .default(null),
    make: optText(),
    model: optText(),
    year: optInt(1950, 2100, "Enter a year between 1950 and 2100"),
    color: optText(),
    transmission: optText(40),
    chassisNo: optText(60),
    engineNo: optText(60),
    engine: optText(60),
    bodyType: z.enum(BODY_TYPES).nullable().default(null),
    /** Rate-card category (sedan, MPV, SUV). Needed to show the car with a price on the public booking page. */
    category: z.enum(CATEGORIES).nullable().default(null),
    seats: optInt(1, 60, "Enter seats between 1 and 60"),
    /** Shown on the public booking page (when it can be priced). */
    listedPublicly: z.boolean().default(true),
    fuelType: z.enum(FUEL_TYPES).nullable().default(null),
    tankCapacityL: optInt(1, 500, "Enter litres between 1 and 500"),
    ownership: z.enum(OWNERSHIPS).default("owned"),
    operatorName: optText(),
    /** Centavos. */
    dailyRateDisplay: optInt(0, 100_000_000, "Enter a valid amount"),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
  })
  .refine((v) => v.ownership !== "operator" || !!v.operatorName, {
    path: ["operatorName"],
    message: "Operator name is required for operator-owned vehicles",
  })
  .refine((v) => !v.category || (v.bodyType !== null && BODY_CATEGORIES[v.bodyType].includes(v.category)), {
    path: ["category"],
    message: "This body type has no such category",
  });

export type VehicleInput = z.input<typeof vehicleSchema>;
export const updateVehicleSchema = z.object({ id: z.uuid(), vehicle: vehicleSchema });

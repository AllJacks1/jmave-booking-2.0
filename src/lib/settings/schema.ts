/**
 * System settings: one row per key in `settings` (value jsonb).
 * Shared by the settings form (client) and the server action.
 */
import { z } from "zod";
import { normalisePhPhone } from "@/lib/phone";

const phPhone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const e164 = normalisePhPhone(v);
    if (!e164) {
      ctx.addIssue({ code: "custom", message: "Enter a valid PH number, e.g. 0919 073 7627" });
      return z.NEVER;
    }
    return e164;
  });

const centavos = z
  .number({ error: "Enter an amount" })
  .int("Whole centavos only")
  .min(0, "Cannot be negative")
  .max(100_000, "Too high"); // ₱1,000.00 per litre

export const businessSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  address: z.string().trim().min(1, "Required").max(300),
  mobile: phPhone,
  landline: phPhone,
  email: z.email("Enter a valid email").trim().max(200),
});

export const fuelPricesSchema = z.object({
  gasoline: centavos,
  premium: centavos,
  diesel: centavos,
});

export const SETTINGS_SCHEMAS = {
  business: businessSchema,
  fuel_prices_centavos: fuelPricesSchema,
  quote_validity_hours: z.number().int().min(1, "At least 1 hour").max(720, "At most 720 hours"),
  turnaround_buffer_minutes: z
    .number()
    .int()
    .min(0, "Cannot be negative")
    .max(1440, "At most 1,440 minutes"),
} as const;

export type SettingsKey = keyof typeof SETTINGS_SCHEMAS;
export const SETTINGS_KEYS = Object.keys(SETTINGS_SCHEMAS) as SettingsKey[];
export type Settings = { [K in SettingsKey]: z.output<(typeof SETTINGS_SCHEMAS)[K]> };

export const settingsSchema = z.object(SETTINGS_SCHEMAS);
export type SettingsInput = z.input<typeof settingsSchema>;

/**
 * Defaults. Business details from docs/reference/quote-documents.md.
 * Fuel prices are placeholders (₱/litre) — the owner edits them.
 */
export const DEFAULT_SETTINGS: Settings = {
  business: {
    name: "J-MaVe Cars",
    address: "Door 8, KM 5, JP Laurel Bajada, Davao City",
    mobile: "+639190737627",
    landline: "+63822820843",
    email: "jmavevc@gmail.com",
  },
  fuel_prices_centavos: { gasoline: 9400, premium: 9900, diesel: 9800 },
  quote_validity_hours: 24,
  turnaround_buffer_minutes: 60,
};

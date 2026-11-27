/**
 * Rework dropdown option values (docs/reference/rework.md §4.1).
 *
 * Fields typed "string (option)" in Rework must carry the exact option text
 * configured there. The mapping lives in setting `rework_option_map` (Super
 * Admin edits it on /settings) so it can change without a deploy. An empty
 * value means "do not send this field". Pure module.
 */
import { z } from "zod";
import { ID_TYPES, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, SOURCE_CHANNEL_LABELS, SOURCE_CHANNELS } from "@/lib/bookings/constants";
import { BODY_CATEGORIES, BODY_TYPE_LABELS, BODY_TYPES, CATEGORY_LABELS, SERVICES } from "@/lib/pricing/types";

export const DRIVERS_LICENSE_TYPES = ["professional", "non_professional"] as const;
export type DriversLicenseType = (typeof DRIVERS_LICENSE_TYPES)[number];
export const DRIVERS_LICENSE_LABELS: Record<DriversLicenseType, string> = {
  professional: "Professional",
  non_professional: "Non-professional",
};

/** Deal-source key for the public booking page; staff intakes use their source channel. */
export const WEBSITE_DEAL_SOURCE = "website_booking_page";

/** Car-type keys: each body type, and `body:category` for categorised ones (falls back to the body type). */
export const CAR_TYPE_KEYS: string[] = BODY_TYPES.flatMap((b) => [b, ...BODY_CATEGORIES[b].map((c) => `${b}:${c}`)]);

export const REWORK_OPTION_FIELDS = {
  services: {
    reworkField: "custom_services",
    label: "Services",
    keys: [...SERVICES] as string[],
    defaults: { self_drive: "Self-Drive", with_driver: "With Driver" } as Record<string, string>,
  },
  car_type: {
    reworkField: "custom_car_type",
    label: "Car type",
    keys: CAR_TYPE_KEYS,
    defaults: Object.fromEntries(BODY_TYPES.map((b) => [b, BODY_TYPE_LABELS[b]])) as Record<string, string>,
  },
  mode_of_payment: {
    reworkField: "custom_mode_of_payment",
    label: "Mode of payment",
    keys: [...PAYMENT_METHODS] as string[],
    defaults: { ...PAYMENT_METHOD_LABELS } as Record<string, string>,
  },
  deal_sources: {
    reworkField: "custom_deal_sources",
    label: "Deal source",
    keys: [WEBSITE_DEAL_SOURCE, ...SOURCE_CHANNELS],
    defaults: { [WEBSITE_DEAL_SOURCE]: "Website Booking Page", ...SOURCE_CHANNEL_LABELS } as Record<string, string>,
  },
  government_id: {
    reworkField: "custom_government_id",
    label: "Government ID",
    keys: [...ID_TYPES] as string[],
    defaults: Object.fromEntries(ID_TYPES.map((t) => [t, t])) as Record<string, string>,
  },
  drivers_license: {
    reworkField: "custom_drivers_license",
    label: "Driver's license type",
    keys: [...DRIVERS_LICENSE_TYPES] as string[],
    defaults: { ...DRIVERS_LICENSE_LABELS } as Record<string, string>,
  },
  driver_wait: {
    reworkField: "custom_do_you_need_the_driver_to_waitstandby",
    label: "Driver to wait / standby",
    keys: ["yes", "no"],
    defaults: { yes: "Yes", no: "No" } as Record<string, string>,
  },
} as const;

export type ReworkOptionField = keyof typeof REWORK_OPTION_FIELDS;
export const REWORK_OPTION_FIELD_KEYS = Object.keys(REWORK_OPTION_FIELDS) as ReworkOptionField[];

/** Human label for an option key on the settings page. */
export function optionKeyLabel(field: ReworkOptionField, key: string): string {
  if (field === "car_type") {
    const [b, c] = key.split(":") as [keyof typeof BODY_TYPE_LABELS, keyof typeof CATEGORY_LABELS | undefined];
    return c ? `${BODY_TYPE_LABELS[b]} · ${CATEGORY_LABELS[c]}` : BODY_TYPE_LABELS[b];
  }
  if (field === "deal_sources" && key === WEBSITE_DEAL_SOURCE) return "Public booking page";
  if (field === "deal_sources") return SOURCE_CHANNEL_LABELS[key as keyof typeof SOURCE_CHANNEL_LABELS] ?? key;
  if (field === "mode_of_payment") return PAYMENT_METHOD_LABELS[key as keyof typeof PAYMENT_METHOD_LABELS] ?? key;
  if (field === "services") return key === "self_drive" ? "Self-Drive" : "With Driver";
  if (field === "drivers_license") return DRIVERS_LICENSE_LABELS[key as DriversLicenseType] ?? key;
  if (field === "driver_wait") return key === "yes" ? "Yes (long-term parking)" : "No (back and forth)";
  return key;
}

const optionValue = z.string().trim().max(200);

export const reworkOptionMapSchema = z.object(
  Object.fromEntries(REWORK_OPTION_FIELD_KEYS.map((f) => [f, z.record(z.string().max(80), optionValue).default({})])) as {
    [K in ReworkOptionField]: z.ZodDefault<z.ZodRecord<z.ZodString, typeof optionValue>>;
  },
);
export type ReworkOptionMap = z.output<typeof reworkOptionMapSchema>;

export const DEFAULT_REWORK_OPTION_MAP: ReworkOptionMap = Object.fromEntries(
  REWORK_OPTION_FIELD_KEYS.map((f) => [f, { ...REWORK_OPTION_FIELDS[f].defaults }]),
) as ReworkOptionMap;

export const REWORK_DATE_UNITS = ["seconds", "milliseconds"] as const;
export type ReworkDateUnit = (typeof REWORK_DATE_UNITS)[number];

/** Mapped option value, or null (field not sent). Car type falls back from `body:category` to `body`. */
export function optionFor(map: ReworkOptionMap, field: ReworkOptionField, key: string | null | undefined): string | null {
  if (!key) return null;
  const values = map[field] ?? {};
  const direct = values[key]?.trim();
  if (direct) return direct;
  if (field === "car_type" && key.includes(":")) {
    const body = values[key.split(":")[0]]?.trim();
    if (body) return body;
  }
  return null;
}

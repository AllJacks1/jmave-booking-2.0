/**
 * Rework lead payload mapper (docs/reference/rework.md §3). Pure: the caller
 * gathers the facts (client, trip, attribution) into a `LeadFacts`; this
 * module turns them into Rework's field names and option values. Only
 * non-empty values are sent.
 */
import { z } from "zod";
import type { BodyType, Category, Service } from "@/lib/pricing/types";
import { manilaToUtc } from "@/lib/time";
import { optionFor, type ReworkDateUnit, type ReworkOptionMap } from "./options";

export const SERVICE_LABELS: Record<Service, string> = { self_drive: "Self-Drive", with_driver: "With Driver" };

/** Ad-id URL parameters passed through under the same name (rework.md §3, last row). Extend as needed. */
export const AD_ID_PARAMS = [
  "gbraid",
  "wbraid",
  "msclkid",
  "li_fat_id",
  "ttp",
  "ad_id",
  "adset_id",
  "campaign_id",
  "adgroup_id",
  "creative_id",
  "placement",
] as const;

export const UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
export const CLICK_ID_PARAMS = ["fbclid", "gclid", "ttclid"] as const;
export const ATTRIBUTION_PARAMS = [...UTM_PARAMS, ...CLICK_ID_PARAMS, ...AD_ID_PARAMS] as const;

const attrValue = z.string().trim().max(500);
/** Attribution captured on the first visit (sessionStorage) and sent with the request. */
export const attributionSchema = z
  .object({
    ...Object.fromEntries(ATTRIBUTION_PARAMS.map((k) => [k, attrValue.optional()])),
    fbp: attrValue.optional(),
    referral_url: z.string().trim().max(2000).optional(),
    referral_domain: attrValue.optional(),
    landing_url: z.string().trim().max(2000).optional(),
  } as Record<(typeof ATTRIBUTION_PARAMS)[number] | "fbp" | "referral_url" | "referral_domain" | "landing_url", z.ZodOptional<z.ZodString>>)
  .strip();
export type Attribution = z.output<typeof attributionSchema>;

export type LeadFacts = {
  client: {
    fullName: string;
    email: string | null;
    /** E.164. */
    phone: string | null;
    /** `YYYY-MM-DD`. */
    birthday: string | null;
    altContactName: string | null;
    altContactPhone: string | null;
    driversLicenseNo: string | null;
    companyName: string | null;
  };
  service: Service | null;
  startAt: Date | null;
  endAt: Date | null;
  bodyType: BodyType | null;
  category: Category | null;
  destination?: string | null;
  itinerary?: string | null;
  deliveryAddress?: string | null;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  driversLicenseType?: string | null;
  idsPresented?: readonly string[];
  passengers?: number | null;
  luggage?: string | null;
  drivingTerm?: "back_and_forth" | "long_term_parking" | null;
  specialRequests?: string | null;
  paymentMethod?: string | null;
  /** Option key: `website_booking_page` or a booking source channel. */
  dealSource?: string | null;
  /** Staff URL of the inquiry or quotation in our system. */
  link?: string | null;
  /** Consultant's `user.rework_owner_id`. */
  ownerId?: string | null;
  quotationNumber?: string | null;
  extraLabels?: readonly string[];
  attribution?: Attribution;
  geoIp?: string | null;
  userAgent?: string | null;
};

export type ReworkLead = Record<string, string | number | string[]>;

export type MapOptions = { optionMap: ReworkOptionMap; dateUnit: ReworkDateUnit };

function unix(d: Date, unit: ReworkDateUnit): number {
  const ms = d.getTime();
  return unit === "milliseconds" ? ms : Math.floor(ms / 1000);
}

function clean(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/** Facts → Rework fields. Empty values are left out. */
export function mapReworkLead(facts: LeadFacts, opts: MapOptions): ReworkLead {
  const out: ReworkLead = {};
  const put = (key: string, value: string | number | string[] | null | undefined) => {
    if (value === null || value === undefined) return;
    if (typeof value === "string" && !value.trim()) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === "number" && !Number.isFinite(value)) return;
    out[key] = typeof value === "string" ? value.trim() : value;
  };
  const c = facts.client;

  put("name", clean(c.fullName));
  put("email", clean(c.email));
  put("phone", clean(c.phone));
  put("owner_id", clean(facts.ownerId));
  const labels = [
    ...(facts.service ? [SERVICE_LABELS[facts.service]] : []),
    ...(clean(facts.quotationNumber) ? [facts.quotationNumber!.trim()] : []),
    ...(facts.extraLabels ?? []),
  ];
  put("labels", labels);

  put("custom_full_name", clean(c.fullName));
  put("custom_email_address", clean(c.email));
  put("custom_phone_number", clean(c.phone));
  if (c.birthday) put("custom_birthday", unix(manilaToUtc(c.birthday), opts.dateUnit));
  if (facts.startAt) put("custom_start_time", unix(facts.startAt, opts.dateUnit));
  if (facts.endAt) put("custom_expected_return_date_time", unix(facts.endAt, opts.dateUnit));
  put("custom_services", optionFor(opts.optionMap, "services", facts.service));
  const carKey = facts.bodyType ? (facts.category ? `${facts.bodyType}:${facts.category}` : facts.bodyType) : null;
  put("custom_car_type", optionFor(opts.optionMap, "car_type", carKey));
  put("custom_destination", clean(facts.destination));
  if (facts.service === "with_driver") put("custom_full_itinerary_route_plan", clean(facts.itinerary));
  put("custom_delivery_address", clean(facts.deliveryAddress));
  put("custom_pick_up_address", clean(facts.pickupAddress));
  if (facts.service === "with_driver") put("custom_drop_off_address", clean(facts.dropoffAddress));
  const alt = [clean(c.altContactName), clean(c.altContactPhone)].filter(Boolean).join(" – ");
  put("custom_alternative_contact_person", alt);
  put("custom_drivers_license_no_", clean(c.driversLicenseNo));
  put("custom_drivers_license", optionFor(opts.optionMap, "drivers_license", facts.driversLicenseType));
  // A single option field: the first ID presented that has a mapped value.
  const id = (facts.idsPresented ?? []).map((t) => optionFor(opts.optionMap, "government_id", t)).find(Boolean) ?? null;
  put("custom_government_id", id);
  if (facts.service === "with_driver") {
    if (facts.passengers !== null && facts.passengers !== undefined && facts.passengers > 0) put("custom_number_of_passengers", facts.passengers);
    put("custom_number_of_luggages_if_any", clean(facts.luggage));
    if (facts.drivingTerm) {
      put("custom_do_you_need_the_driver_to_waitstandby", optionFor(opts.optionMap, "driver_wait", facts.drivingTerm === "long_term_parking" ? "yes" : "no"));
    }
  }
  put("custom_company_name_if_applicable", clean(c.companyName));
  put("custom_special_requests", clean(facts.specialRequests));
  put("custom_mode_of_payment", optionFor(opts.optionMap, "mode_of_payment", facts.paymentMethod));
  put("custom_deal_sources", optionFor(opts.optionMap, "deal_sources", facts.dealSource));
  put("custom_form_submission_link", clean(facts.link));

  const a = facts.attribution ?? {};
  for (const k of [...ATTRIBUTION_PARAMS, "fbp", "referral_url", "referral_domain"] as const) put(k, clean(a[k]));
  put("geo_ip", clean(facts.geoIp));
  put("user_agent", clean(facts.userAgent));
  return out;
}

/** Outbox `rework_lead` payload: the mapped lead, ready to post. */
export const reworkOutboxPayloadSchema = z.object({
  lead: z.record(z.string(), z.union([z.string(), z.number(), z.array(z.string())])),
  /** What the lead is about, for the settings delivery list. */
  source: z.enum(["inquiry", "quotation", "client", "test"]),
  reference: z.string().max(100).nullable().default(null),
});
export type ReworkOutboxPayload = z.output<typeof reworkOutboxPayloadSchema>;

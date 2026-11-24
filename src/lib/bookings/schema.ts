/**
 * Booking, payment, block and driver inputs. Shared by client forms and
 * server actions. Money in centavos; dates as Manila `YYYY-MM-DD` + `HH:MM`.
 */
import { z } from "zod";
import { normalisePhPhone } from "@/lib/phone";
import { isDateKey } from "@/lib/time";
import {
  BLOCK_KINDS,
  CHARGE_KINDS,
  ID_TYPES,
  PAYMENT_DIRECTIONS,
  PAYMENT_METHODS,
  PAYMENT_TYPE_DIRECTION,
  PAYMENT_TYPES,
  SOURCE_CHANNELS,
} from "./constants";

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .default("")
    .transform((v) => (v === "" ? null : v));
const requiredText = (max: number, message = "Required") => z.string().trim().min(1, message).max(max);
export const dateKeySchema = z.string().refine(isDateKey, "Enter a valid date");
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time");
const positiveCentavos = z
  .number({ error: "Enter an amount" })
  .int("Whole centavos only")
  .min(1, "Must be more than zero")
  .max(1_000_000_000, "Too high");

export const bookingIdSchema = z.object({ id: z.uuid() });

export const convertSchema = z.object({ quotationId: z.uuid() });

export const bookingDetailsSchema = z.object({
  id: z.uuid(),
  destination: nullableText(200),
  deliveryAddress: nullableText(500),
  pickupAddress: nullableText(500),
  driverNameOnLicense: nullableText(160),
  driversLicenseNo: nullableText(60),
  idsPresented: z.array(z.enum(ID_TYPES)).max(ID_TYPES.length).default([]),
  passengers: z.number().int().min(0).max(100).nullable().default(null),
  luggage: nullableText(200),
  itinerary: nullableText(2000),
  sourceChannel: z.enum(SOURCE_CHANNELS).nullable().default(null),
  contactHandle: nullableText(200),
  reworkLink: z
    .string()
    .trim()
    .max(500)
    .default("")
    .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Enter a full link (https://…)")
    .transform((v) => (v === "" ? null : v)),
  orIssued: z.boolean().default(false),
  notes: nullableText(4000),
});
export type BookingDetailsInput = z.input<typeof bookingDetailsSchema>;

const scheduleFields = {
  startDate: dateKeySchema,
  startTime: timeSchema,
  endDate: dateKeySchema,
  endTime: timeSchema,
};

export const bookingScheduleSchema = z.object({
  id: z.uuid(),
  vehicleId: z.uuid({ error: "Choose a vehicle" }),
  ...scheduleFields,
});
export type BookingScheduleInput = z.input<typeof bookingScheduleSchema>;

export const confirmSchema = z.object({
  id: z.uuid(),
  /** Admin+: confirm without a reservation fee payment. */
  withoutRf: z.boolean().default(false),
  withoutRfReason: z.string().trim().max(500).default(""),
});

export const reasonSchema = z.object({ id: z.uuid(), reason: requiredText(500, "Give a reason") });
export const optionalReasonSchema = z.object({ id: z.uuid(), reason: z.string().trim().max(500).default("") });

export const paymentSchema = z
  .object({
    bookingId: z.uuid(),
    type: z.enum(PAYMENT_TYPES),
    /** Only read for `other`; fixed for every other type. */
    direction: z.enum(PAYMENT_DIRECTIONS).default("in"),
    amountCentavos: positiveCentavos,
    method: z.enum(PAYMENT_METHODS),
    reference: nullableText(120),
    collectedByUserId: z.uuid().nullable().default(null),
    collectedByName: nullableText(120),
    paidDate: dateKeySchema,
    paidTime: timeSchema,
    note: nullableText(500),
  })
  .superRefine((v, ctx) => {
    if (!v.collectedByUserId && !v.collectedByName) {
      ctx.addIssue({ code: "custom", path: ["collectedByName"], message: "Pick a staff member or type a name" });
    }
    if (v.type === "other" && !v.note) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Describe what this entry is for" });
    }
  })
  .transform((v) => ({ ...v, direction: PAYMENT_TYPE_DIRECTION[v.type] ?? v.direction }));
export type PaymentInput = z.input<typeof paymentSchema>;

export const applyDepositSchema = z.object({ bookingId: z.uuid(), amountCentavos: positiveCentavos });

export const chargeSchema = z.object({
  bookingId: z.uuid(),
  kind: z.enum(CHARGE_KINDS).refine((k) => k !== "quoted", "Quoted lines come from the quotation"),
  label: requiredText(200),
  /** May be negative (a manual credit). */
  amountCentavos: z.number().int().min(-1_000_000_000).max(1_000_000_000).refine((v) => v !== 0, "Cannot be zero"),
});

export const assignDriverSchema = z.object({
  id: z.uuid(),
  driverId: z.uuid().nullable(),
  overrideReason: z.string().trim().max(500).default(""),
});

export const availabilitySchema = z.object({
  vehicleId: z.uuid(),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  excludeBookingId: z.uuid().nullable().default(null),
});

export const blockSchema = z.object({
  id: z.uuid().nullable().default(null),
  vehicleId: z.uuid({ error: "Choose a vehicle" }),
  kind: z.enum(BLOCK_KINDS),
  ...scheduleFields,
  reason: requiredText(500, "Give a reason"),
});
export type BlockInput = z.input<typeof blockSchema>;

const phone = z
  .string()
  .trim()
  .default("")
  .transform((v, ctx) => {
    if (v === "") return null;
    const e164 = normalisePhPhone(v);
    if (!e164) {
      ctx.addIssue({ code: "custom", message: "Enter a valid PH number, e.g. 0919 073 7627" });
      return z.NEVER;
    }
    return e164;
  });

export const driverSchema = z.object({
  id: z.uuid().nullable().default(null),
  name: requiredText(120),
  phone,
  active: z.boolean().default(true),
  notes: nullableText(1000),
});
export type DriverInput = z.input<typeof driverSchema>;

export const BOOKING_LIST_STATUSES = ["all", "open", "pending_reservation", "confirmed", "released", "returned", "closed", "cancelled", "no_show"] as const;
export const bookingListSchema = z.object({
  status: z.enum(BOOKING_LIST_STATUSES).catch("open"),
  service: z.enum(["all", "self_drive", "with_driver"]).catch("all"),
  q: z.string().trim().max(100).catch(""),
  from: z.string().refine(isDateKey).optional().catch(undefined),
  to: z.string().refine(isDateKey).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type BookingListQuery = z.output<typeof bookingListSchema>;

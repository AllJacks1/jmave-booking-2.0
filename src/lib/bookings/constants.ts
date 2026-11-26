/**
 * Booking vocabularies (docs/reference/bookings-and-movement.md §1–§3, §7).
 * Pure: shared by the DB schema, server code and client components.
 */

export const BOOKING_STATUSES = [
  "pending_reservation",
  "confirmed",
  "released",
  "returned",
  "closed",
  "cancelled",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending_reservation: "Pending reservation",
  confirmed: "Confirmed",
  released: "Released",
  returned: "Returned",
  closed: "Closed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export const HOLD_KINDS = ["booking", "block"] as const;
export type HoldKind = (typeof HOLD_KINDS)[number];

export const BLOCK_KINDS = ["owner_use", "maintenance", "hired_out", "reserved", "other"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  owner_use: "Owner use",
  maintenance: "Maintenance",
  hired_out: "Hired out",
  reserved: "Reserved (manual hold)",
  other: "Other",
};

export const CHARGE_KINDS = [
  "quoted",
  "excess_km",
  "fuel_shortage",
  "extension",
  "ot",
  "damage",
  "other",
] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];
export const CHARGE_KIND_LABELS: Record<ChargeKind, string> = {
  quoted: "Quoted",
  excess_km: "Excess km",
  fuel_shortage: "Fuel shortage",
  extension: "Extension",
  ot: "OT premium",
  damage: "Damage",
  other: "Other",
};

export const CHARGE_SOURCES = ["quote", "check_in", "manual"] as const;
export type ChargeSource = (typeof CHARGE_SOURCES)[number];

export const PAYMENT_TYPES = [
  "reservation_fee",
  "delivery_fee",
  "rental",
  "deposit",
  "deposit_refund",
  "change_given",
  "other",
] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];
export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  reservation_fee: "Reservation fee",
  delivery_fee: "Delivery fee",
  rental: "Rental",
  deposit: "Deposit",
  deposit_refund: "Deposit refund",
  change_given: "Change given",
  other: "Other",
};

export const PAYMENT_DIRECTIONS = ["in", "out"] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

/** Fixed direction per type; `other` may go either way. */
export const PAYMENT_TYPE_DIRECTION: Record<PaymentType, PaymentDirection | null> = {
  reservation_fee: "in",
  delivery_fee: "in",
  rental: "in",
  deposit: "in",
  deposit_refund: "out",
  change_given: "out",
  other: null,
};

export const PAYMENT_METHODS = ["cash", "gcash", "card", "bank", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  gcash: "GCash",
  card: "Card",
  bank: "Bank",
  other: "Other",
};

export const SOURCE_CHANNELS = [
  "facebook",
  "whatsapp",
  "viber",
  "phone",
  "walk_in",
  "website",
  "referral",
  "other",
] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];
export const SOURCE_CHANNEL_LABELS: Record<SourceChannel, string> = {
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  viber: "Viber",
  phone: "Phone",
  walk_in: "Walk-in",
  website: "Website",
  referral: "Referral",
  other: "Other",
};

export const ID_TYPES = [
  "Driver's License",
  "Passport",
  "UMID",
  "PhilSys",
  "Senior Citizen",
  "PRC",
  "Postal",
  "Voter's",
  "Company ID",
  "Other",
] as const;
export type IdType = (typeof ID_TYPES)[number];

/** `movement_events.kind` (Phase 2b). */
export const MOVEMENT_KINDS = ["release", "return", "extension"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** Shift roster duty (bookings-and-movement.md §9). */
export const DUTIES = ["operations", "sales"] as const;
export type Duty = (typeof DUTIES)[number];
export const DUTY_LABELS: Record<Duty, string> = { operations: "Ops", sales: "Sales" };

/** Fuel gauge in eighths (0 = empty, 8 = full). */
export const FUEL_EIGHTHS_MAX = 8;

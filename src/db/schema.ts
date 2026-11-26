import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Relative import: drizzle-kit does not resolve the `@/` alias.
import { BODY_TYPES, FUEL_TYPES, SERVICES, type Service } from "../lib/pricing/types";
import {
  BLOCK_KINDS,
  BOOKING_STATUSES,
  CHARGE_KINDS,
  CHARGE_SOURCES,
  DUTIES,
  HOLD_KINDS,
  MOVEMENT_KINDS,
  PAYMENT_DIRECTIONS,
  PAYMENT_METHODS,
  PAYMENT_TYPES,
  SOURCE_CHANNELS,
} from "../lib/bookings/constants";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const ROLES = ["super_admin", "admin", "sales", "operations"] as const;
export type Role = (typeof ROLES)[number];
export const roleEnum = pgEnum("role", ROLES);

// ---------------------------------------------------------------------------
// Better Auth tables. TS keys must match Better Auth field names; columns are
// snake_case. IDs are UUIDs (advanced.database.generateId = "uuid").
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  role: roleEnum("role").notNull().default("sales"),
  active: boolean("active").notNull().default(true),
  displayName: text("display_name").notNull(),
  reworkOwnerId: text("rework_owner_id"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
});

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// Better Auth rate-limit storage ("database"), shared across app instances.
export const rateLimit = pgTable("rate_limit", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// ---------------------------------------------------------------------------
// App tables (Phase 1a)
// ---------------------------------------------------------------------------

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
  updatedBy: uuid("updated_by").references(() => user.id, {
    onDelete: "set null",
  }),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    at: timestamp("at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entity, t.entityId),
    index("audit_log_actor_idx").on(t.actorId),
    index("audit_log_at_idx").on(t.at),
  ],
);

// ---------------------------------------------------------------------------
// Phase 1b: fleet, rate cards, holidays, clients, numbering, imports
// ---------------------------------------------------------------------------

export { BODY_TYPES, FUEL_TYPES };
export const bodyTypeEnum = pgEnum("body_type", BODY_TYPES);
export const fuelTypeEnum = pgEnum("fuel_type", FUEL_TYPES);
export const OWNERSHIPS = ["owned", "operator", "hired"] as const;
export const ownershipEnum = pgEnum("ownership", OWNERSHIPS);

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name").notNull(),
    /** Normalised: uppercase, single spaces. */
    plate: text("plate").unique(),
    make: text("make"),
    model: text("model"),
    year: integer("year"),
    color: text("color"),
    transmission: text("transmission"),
    chassisNo: text("chassis_no"),
    engineNo: text("engine_no"),
    engine: text("engine"),
    bodyType: bodyTypeEnum("body_type"),
    fuelType: fuelTypeEnum("fuel_type"),
    tankCapacityL: integer("tank_capacity_l"),
    ownership: ownershipEnum("ownership").notNull().default("owned"),
    operatorName: text("operator_name"),
    /** Centavos; shown on lists only, never used for pricing. */
    dailyRateDisplay: integer("daily_rate_display"),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("vehicles_display_name_idx").on(t.displayName)],
);

export const RATE_CARD_STATUSES = ["draft", "active", "archived"] as const;
export const rateCardStatusEnum = pgEnum("rate_card_status", RATE_CARD_STATUSES);

export const rateCards = pgTable(
  "rate_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: integer("version").notNull().unique(),
    name: text("name").notNull(),
    status: rateCardStatusEnum("status").notNull().default("draft"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    /** Validated by zod `RateCardData` (src/lib/pricing/rate-card.ts). */
    data: jsonb("data").notNull(),
    /** e.g. `import:FORMULA+FORMULA WDRIVER`, `copy:v1`, `manual`. */
    source: text("source"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Exactly one active card (at most one by index; activation keeps one).
    uniqueIndex("rate_cards_one_active_idx").on(t.status).where(sql`${t.status} = 'active'`),
  ],
);

export const holidays = pgTable("holidays", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date", { mode: "string" }).notNull().unique(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const CLIENT_TYPES = ["individual", "corporate"] as const;
export const clientTypeEnum = pgEnum("client_type", CLIENT_TYPES);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    fbName: text("fb_name"),
    /** E.164 (`+639…`). */
    phone: text("phone"),
    email: text("email"),
    birthday: date("birthday", { mode: "string" }),
    address: text("address"),
    altContactName: text("alt_contact_name"),
    altContactPhone: text("alt_contact_phone"),
    driversLicenseNo: text("drivers_license_no"),
    companyName: text("company_name"),
    clientType: clientTypeEnum("client_type").notNull().default("individual"),
    isBlacklisted: boolean("is_blacklisted").notNull().default(false),
    blacklistReason: text("blacklist_reason"),
    /** First BOOKED/COMPLETED rental; null = new client (drives the new-client discount). */
    firstRentalAt: timestamp("first_rental_at", { withTimezone: true }),
    /** `manual`, `import`, `blacklist_import`. */
    source: text("source").notNull().default("manual"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("clients_phone_idx").on(t.phone),
    index("clients_email_lower_idx").on(sql`lower(${t.email})`),
    index("clients_full_name_trgm_idx").using("gin", t.fullName.op("gin_trgm_ops")),
    index("clients_fb_name_trgm_idx").using("gin", t.fbName.op("gin_trgm_ops")),
  ],
);

export const numberSequences = pgTable("number_sequences", {
  /** e.g. `QTN-2026`, `QTN-WD2026`, `JMV`. */
  key: text("key").primaryKey(),
  lastValue: integer("last_value").notNull().default(0),
  updatedAt: updatedAt(),
});

export const IMPORT_STATUSES = ["previewed", "committed", "failed"] as const;
export const importStatusEnum = pgEnum("import_status", IMPORT_STATUSES);

export const importRuns = pgTable(
  "import_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileName: text("file_name").notNull(),
    fileSha256: text("file_sha256").notNull(),
    fileSize: integer("file_size").notNull(),
    /** `booking_workbook` or `dms_workbook`. */
    kind: text("kind").notNull(),
    status: importStatusEnum("status").notNull().default("previewed"),
    /** Counts and warnings per section (no full client rows). */
    summary: jsonb("summary").notNull(),
    /** Parsed rows kept between Preview and Commit; cleared on commit. */
    payload: jsonb("payload"),
    error: text("error"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    committedBy: uuid("committed_by").references(() => user.id, { onDelete: "set null" }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
  },
  (t) => [index("import_runs_created_at_idx").on(t.createdAt)],
);

// ---------------------------------------------------------------------------
// Phase 1c: quotations
// ---------------------------------------------------------------------------

export const QUOTATION_KINDS = ["quick", "formal"] as const;
export const quotationKindEnum = pgEnum("quotation_kind", QUOTATION_KINDS);
export { SERVICES, type Service };
export const serviceEnum = pgEnum("service", SERVICES);
/** `expired` is also computed on read (issued + valid_until < now). */
export const QUOTATION_STATUSES = ["draft", "issued", "accepted", "expired", "lost", "cancelled"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
export const quotationStatusEnum = pgEnum("quotation_status", QUOTATION_STATUSES);

export const quotations = pgTable(
  "quotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `QTN-2026-929` / `QTN-WD2026-119`; null for quick quotations and drafts. */
    number: text("number").unique(),
    kind: quotationKindEnum("kind").notNull(),
    service: serviceEnum("service").notNull(),
    status: quotationStatusEnum("status").notNull().default("draft"),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "restrict" }),
    /** Client name as quoted (optional free text on quick quotations; snapshot on formal). */
    clientName: text("client_name"),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    bodyType: bodyTypeEnum("body_type"),
    category: text("category"),
    startAt: timestamp("start_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
    /** Form inputs (src/lib/quotes/schema.ts `QuoteForm`), incl. the engine inputs. */
    inputs: jsonb("inputs").notNull(),
    /** Engine result snapshot (lines, totals, payable); null while a draft does not price. */
    result: jsonb("result"),
    /** Names frozen at issue: client, vehicle, consultant (display only). */
    snapshot: jsonb("snapshot"),
    rateCardId: uuid("rate_card_id").references(() => rateCards.id, { onDelete: "restrict" }),
    totalCentavos: integer("total_centavos"),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    consultantId: uuid("consultant_id").references(() => user.id, { onDelete: "set null" }),
    /** Random 32 bytes (base64url) for `/q/[token]`; set on issue. */
    shareToken: text("share_token").unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    revisedFromId: uuid("revised_from_id").references((): AnyPgColumn => quotations.id, { onDelete: "set null" }),
    /** Lost reason, or "Revised by QTN-…" on a cancelled quotation. */
    statusNote: text("status_note"),
    blacklistOverrideReason: text("blacklist_override_reason"),
    blacklistOverrideBy: uuid("blacklist_override_by").references(() => user.id, { onDelete: "set null" }),
    /** Internal; never on the client copy. */
    notes: text("notes"),
    /** Phase 2a history import: read-only, no engine inputs/result. */
    imported: boolean("imported").notNull().default(false),
    /** Logged lines and fields from the old Rental Log (`ImportedQuotationData`). */
    importedData: jsonb("imported_data"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("quotations_status_idx").on(t.status, t.validUntil),
    index("quotations_consultant_idx").on(t.consultantId, t.createdAt),
    index("quotations_created_at_idx").on(t.createdAt),
    index("quotations_client_idx").on(t.clientId),
    index("quotations_revised_from_idx").on(t.revisedFromId),
    index("quotations_client_name_trgm_idx").using("gin", t.clientName.op("gin_trgm_ops")),
  ],
);

// ---------------------------------------------------------------------------
// Phase 2a: bookings, holds, blocks, charges, payments, drivers
// ---------------------------------------------------------------------------

export {
  BOOKING_STATUSES,
  HOLD_KINDS,
  BLOCK_KINDS,
  CHARGE_KINDS,
  CHARGE_SOURCES,
  PAYMENT_TYPES,
  PAYMENT_DIRECTIONS,
  PAYMENT_METHODS,
  SOURCE_CHANNELS,
};
export const bookingStatusEnum = pgEnum("booking_status", BOOKING_STATUSES);
export const holdKindEnum = pgEnum("hold_kind", HOLD_KINDS);
export const blockKindEnum = pgEnum("block_kind", BLOCK_KINDS);
export const chargeKindEnum = pgEnum("charge_kind", CHARGE_KINDS);
export const chargeSourceEnum = pgEnum("charge_source", CHARGE_SOURCES);
export const paymentTypeEnum = pgEnum("payment_type", PAYMENT_TYPES);
export const paymentDirectionEnum = pgEnum("payment_direction", PAYMENT_DIRECTIONS);
export const paymentMethodEnum = pgEnum("payment_method", PAYMENT_METHODS);
export const sourceChannelEnum = pgEnum("source_channel", SOURCE_CHANNELS);

/** Postgres `tstzrange`, read and written as its text form (`["…","…")`). */
const tstzrange = customType<{ data: string; driverData: string }>({
  dataType: () => "tstzrange",
});

export const drivers = pgTable(
  "drivers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** E.164 (`+639…`). */
    phone: text("phone"),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    /** `manual` or `import`. */
    source: text("source").notNull().default("manual"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("drivers_name_lower_idx").on(sql`lower(${t.name})`)],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** = quotation number (`QTN-2026-929`). */
    number: text("number").notNull().unique(),
    quotationId: uuid("quotation_id")
      .unique()
      .references(() => quotations.id, { onDelete: "restrict" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "restrict" }),
    /** Client name as booked (also the label when no client row matched on import). */
    clientName: text("client_name"),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "restrict" }),
    /** Vehicle text from the old log when no vehicle matched on import. */
    vehicleLabel: text("vehicle_label"),
    service: serviceEnum("service").notNull(),
    status: bookingStatusEnum("status").notNull().default("pending_reservation"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    destination: text("destination"),
    deliveryAddress: text("delivery_address"),
    pickupAddress: text("pickup_address"),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    /** Admin+ override when the assigned driver has an overlapping trip. */
    driverOverlapReason: text("driver_overlap_reason"),
    driverNameOnLicense: text("driver_name_on_license"),
    driversLicenseNo: text("drivers_license_no"),
    idsPresented: text("ids_presented").array().notNull().default(sql`'{}'::text[]`),
    passengers: integer("passengers"),
    luggage: text("luggage"),
    itinerary: text("itinerary"),
    sourceChannel: sourceChannelEnum("source_channel"),
    contactHandle: text("contact_handle"),
    reworkLink: text("rework_link"),
    orIssued: boolean("or_issued").notNull().default(false),
    notes: text("notes"),
    /** Show `notes` under "Special instructions" on the movement board (Phase 2b). */
    showNotesOnBoard: boolean("show_notes_on_board").notNull().default(false),
    /** Cancel / no-show reason, import conflict note. */
    statusNote: text("status_note"),
    confirmWithoutRfReason: text("confirm_without_rf_reason"),
    imported: boolean("imported").notNull().default(false),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    confirmedBy: uuid("confirmed_by").references(() => user.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("bookings_vehicle_start_idx").on(t.vehicleId, t.startAt),
    index("bookings_status_idx").on(t.status),
    index("bookings_client_idx").on(t.clientId),
    index("bookings_start_idx").on(t.startAt),
    index("bookings_driver_idx").on(t.driverId),
  ],
);

export const vehicleBlocks = pgTable(
  "vehicle_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    kind: blockKindEnum("kind").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    /** Set when the block was removed before it started (its hold is inactive). */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("vehicle_blocks_vehicle_start_idx").on(t.vehicleId, t.startAt)],
);

/**
 * One row per confirmed/released booking and per block (PLAN §6.2).
 * `period = [start, end + turnaround buffer)`. The exclusion constraint
 * `vehicle_holds_no_overlap` (raw SQL in 0003) makes double booking impossible.
 */
export const vehicleHolds = pgTable(
  "vehicle_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    kind: holdKindEnum("kind").notNull(),
    bookingId: uuid("booking_id")
      .unique()
      .references(() => bookings.id, { onDelete: "cascade" }),
    blockId: uuid("block_id")
      .unique()
      .references(() => vehicleBlocks.id, { onDelete: "cascade" }),
    period: tstzrange("period").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "vehicle_holds_owner_check",
      sql`(${t.kind} = 'booking' and ${t.bookingId} is not null and ${t.blockId} is null) or (${t.kind} = 'block' and ${t.blockId} is not null and ${t.bookingId} is null)`,
    ),
  ],
);

export const bookingCharges = pgTable(
  "booking_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    kind: chargeKindEnum("kind").notNull(),
    /** Engine line code when copied from a quotation. */
    code: text("code"),
    label: text("label").notNull(),
    amountCentavos: integer("amount_centavos").notNull(),
    source: chargeSourceEnum("source").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("booking_charges_booking_idx").on(t.bookingId, t.sortOrder)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    type: paymentTypeEnum("type").notNull(),
    direction: paymentDirectionEnum("direction").notNull(),
    amountCentavos: integer("amount_centavos").notNull(),
    method: paymentMethodEnum("method").notNull(),
    reference: text("reference"),
    collectedByUserId: uuid("collected_by_user_id").references(() => user.id, { onDelete: "set null" }),
    /** Free-text collector (e.g. a driver) when not a staff user. */
    collectedByName: text("collected_by_name"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    note: text("note"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => user.id, { onDelete: "set null" }),
    voidReason: text("void_reason"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_booking_idx").on(t.bookingId, t.paidAt),
    check("payments_amount_positive", sql`${t.amountCentavos} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Phase 2b: movement events, shift roster
// ---------------------------------------------------------------------------

export const movementKindEnum = pgEnum("movement_kind", MOVEMENT_KINDS);
export const dutyEnum = pgEnum("duty", DUTIES);

/**
 * Release / return check-ins and extensions (bookings-and-movement.md §5).
 * `planned_at` = the booking's start (release), end (return) or new end
 * (extension) at the time of recording; `actual_at` = when it happened.
 */
export const movementEvents = pgTable(
  "movement_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "restrict" }),
    kind: movementKindEnum("kind").notNull(),
    plannedAt: timestamp("planned_at", { withTimezone: true }),
    actualAt: timestamp("actual_at", { withTimezone: true }).notNull(),
    odometerKm: integer("odometer_km"),
    /** 0–8 eighths of a tank. */
    fuelLevelEighths: integer("fuel_level_eighths"),
    /** Release: delivery done (FD). Return: pick-up done (PU). */
    delivery: boolean("delivery").notNull().default(false),
    /** Extension: end before / after. */
    previousEndAt: timestamp("previous_end_at", { withTimezone: true }),
    newEndAt: timestamp("new_end_at", { withTimezone: true }),
    recordedBy: uuid("recorded_by").references(() => user.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("movement_events_booking_idx").on(t.bookingId, t.actualAt),
    index("movement_events_vehicle_idx").on(t.vehicleId, t.actualAt),
    check("movement_events_fuel_range", sql`${t.fuelLevelEighths} is null or ${t.fuelLevelEighths} between 0 and 8`),
    check("movement_events_odometer_positive", sql`${t.odometerKm} is null or ${t.odometerKm} >= 0`),
  ],
);

/** Shift templates (seeded: 5AM–2PM, 8AM–5PM, 10AM–7PM, 1PM–10PM, 9PM–6AM). `end_time` ≤ `start_time` crosses midnight. */
export const shiftTemplates = pgTable("shift_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** One shift per person per day. */
export const shiftAssignments = pgTable(
  "shift_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date", { mode: "string" }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => shiftTemplates.id, { onDelete: "restrict" }),
    duty: dutyEnum("duty").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("shift_assignments_date_user_idx").on(t.date, t.userId)],
);

// ---------------------------------------------------------------------------
// Phase 3: loyalty, outbox
// ---------------------------------------------------------------------------

export const LOYALTY_STATUSES = ["active", "expired"] as const;
export type LoyaltyStatus = (typeof LOYALTY_STATUSES)[number];
export const loyaltyStatusEnum = pgEnum("loyalty_status", LOYALTY_STATUSES);

/**
 * `earn` / `reversal` (a reverted return), `redeem` / `refund` (a cancelled
 * booking), `adjust` (manual, Admin+), `import` (Loyalty Log). Points signed.
 */
export const POINTS_KINDS = ["earn", "reversal", "redeem", "refund", "adjust", "import"] as const;
export type PointsKind = (typeof POINTS_KINDS)[number];
export const pointsKindEnum = pgEnum("points_kind", POINTS_KINDS);

/**
 * One loyalty card per client. `client_id` is null only for imported cards
 * that matched no client (linked later on /rewards).
 */
export const loyaltyAccounts = pgTable(
  "loyalty_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .unique()
      .references(() => clients.id, { onDelete: "restrict" }),
    /** `JMV-0001`. */
    cardNo: text("card_no").notNull().unique(),
    /** Manila dates. */
    memberSince: date("member_since", { mode: "string" }).notNull(),
    expiresAt: date("expires_at", { mode: "string" }).notNull(),
    tier: integer("tier"),
    status: loyaltyStatusEnum("status").notNull().default("active"),
    /** Imported cards: the client name seen in the workbook (shown until linked). */
    importedName: text("imported_name"),
    imported: boolean("imported").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("loyalty_accounts_tier_range", sql`${t.tier} is null or ${t.tier} between 0 and 99`)],
);

export const pointsLedger = pgTable(
  "points_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    quotationId: uuid("quotation_id").references(() => quotations.id, { onDelete: "set null" }),
    kind: pointsKindEnum("kind").notNull(),
    points: integer("points").notNull(),
    note: text("note"),
    /** Imports: stable row key so a re-run adds nothing. */
    importKey: text("import_key").unique(),
    /** When it happened (imports: the rental date). */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("points_ledger_account_idx").on(t.accountId, t.occurredAt),
    index("points_ledger_booking_idx").on(t.bookingId),
    check("points_ledger_nonzero", sql`${t.points} <> 0`),
  ],
);

export const OUTBOX_KINDS = ["rework_lead", "email"] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];
export const outboxKindEnum = pgEnum("outbox_kind", OUTBOX_KINDS);
export const OUTBOX_STATUSES = ["pending", "sent", "failed"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];
export const outboxStatusEnum = pgEnum("outbox_status", OUTBOX_STATUSES);

/**
 * External calls (PLAN §6.6). A request writes a row inside its transaction;
 * the worker sends it with retries (exponential backoff, max 8 attempts).
 */
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: outboxKindEnum("kind").notNull(),
    payload: jsonb("payload").notNull(),
    status: outboxStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    response: jsonb("response"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Not before this time (backoff). */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    /** What the row is about, e.g. `quotation` + id (delivery status on the page). */
    entity: text("entity"),
    entityId: uuid("entity_id"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("outbox_due_idx").on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
    index("outbox_entity_idx").on(t.entity, t.entityId),
  ],
);

export type UserRow = typeof user.$inferSelect;
export type QuotationRow = typeof quotations.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type VehicleRow = typeof vehicles.$inferSelect;
export type RateCardRow = typeof rateCards.$inferSelect;
export type HolidayRow = typeof holidays.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;
export type ImportRunRow = typeof importRuns.$inferSelect;
export type BookingRow = typeof bookings.$inferSelect;
export type VehicleHoldRow = typeof vehicleHolds.$inferSelect;
export type VehicleBlockRow = typeof vehicleBlocks.$inferSelect;
export type BookingChargeRow = typeof bookingCharges.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type DriverRow = typeof drivers.$inferSelect;
export type MovementEventRow = typeof movementEvents.$inferSelect;
export type ShiftTemplateRow = typeof shiftTemplates.$inferSelect;
export type ShiftAssignmentRow = typeof shiftAssignments.$inferSelect;
export type LoyaltyAccountRow = typeof loyaltyAccounts.$inferSelect;
export type PointsLedgerRow = typeof pointsLedger.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;

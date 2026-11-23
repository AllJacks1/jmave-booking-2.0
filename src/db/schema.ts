import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Relative import: drizzle-kit does not resolve the `@/` alias.
import { BODY_TYPES, FUEL_TYPES } from "../lib/pricing/types";

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

export type UserRow = typeof user.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type VehicleRow = typeof vehicles.$inferSelect;
export type RateCardRow = typeof rateCards.$inferSelect;
export type HolidayRow = typeof holidays.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;
export type ImportRunRow = typeof importRuns.$inferSelect;

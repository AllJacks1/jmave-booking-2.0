/**
 * Parsed import payloads. Stored in `import_runs.payload` between Preview
 * and Commit, so every field is plain JSON.
 */
import type { RateCardData } from "@/lib/pricing/rate-card";
import type { BodyType, FuelType } from "@/lib/pricing/types";
import type { WorkbookKind } from "./workbook";

export const SECTIONS = ["fleet", "rate_cards", "clients", "blacklist", "sequences", "drivers", "history"] as const;
export type SectionKey = (typeof SECTIONS)[number];

export const SECTION_LABELS: Record<SectionKey, string> = {
  fleet: "Fleet",
  rate_cards: "Rate cards",
  clients: "Clients",
  blacklist: "Blacklist",
  sequences: "Number sequences",
  drivers: "Drivers",
  history: "Booking history (quotations and bookings)",
};

/**
 * `warning`: a row problem the owner should review.
 * `mismatch`: a rate-card value differs from pricing.md (self-check).
 * `info`: a note (e.g. a value taken from pricing.md because the sheet has no cell for it).
 */
export type WarningLevel = "warning" | "mismatch" | "info";

export type ImportWarning = {
  section: SectionKey;
  level: WarningLevel;
  message: string;
  tab?: string;
  row?: number;
};

export type VehicleImport = {
  /** Match key: normalised plate, else `name:<display name>`. */
  key: string;
  displayName: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  transmission: string | null;
  chassisNo: string | null;
  engineNo: string | null;
  engine: string | null;
  bodyType: BodyType | null;
  fuelType: FuelType | null;
  tankCapacityL: number | null;
  /** From `Back bone` column L. Sets ownership = operator when present. */
  operatorName: string | null;
  sortOrder: number;
  source: { tab: string; row: number };
};

export type RateCardImport = {
  version: number;
  name: string;
  status: "active" | "draft";
  source: string;
  data: RateCardData;
};

export type ClientImport = {
  /** Match key: `phone:+63…`, `email:…`, or `name:<full name>|<fb name>`. */
  key: string;
  fullName: string;
  fbName: string | null;
  phone: string | null;
  /** Every phone seen for this client (first = `phone`). */
  phones: string[];
  email: string | null;
  emails: string[];
  birthday: string | null;
  address: string | null;
  altContactName: string | null;
  altContactPhone: string | null;
  clientType: "individual" | "corporate";
  /** Contacts that were not valid PH numbers (foreign or mistyped), kept as text. */
  otherContacts: string[];
  /** ISO instant; earliest BOOKED/COMPLETED travel date. */
  firstRentalAt: string | null;
  rowCount: number;
  rows: { tab: string; row: number }[];
};

export type BlacklistImport = {
  row: number;
  /** First name in column B; the rest are aliases. */
  fullName: string;
  aliases: string[];
  fbName: string | null;
  phone: string | null;
  reason: string;
};

export type SequenceImport = { key: string; value: number; source: string };

/** `Back bone WDRIVER` M/N. Match key: lower-cased name. */
export type DriverImport = { row: number; name: string; phone: string | null };

export type HistoryLine = { label: string; amount: number };

/** One `Rental Log` / `WD Rental Log` row (Phase 2a). Match key: `number`. */
export type HistoryImport = {
  tab: string;
  row: number;
  number: string;
  service: "self_drive" | "with_driver";
  /** `Rental Log!AM`; always null for With Driver. */
  status: "QUOTED" | "BOOKED" | "COMPLETED" | null;
  bookedOn: string | null;
  /** ISO instants. */
  startAt: string | null;
  endAt: string | null;
  clientName: string | null;
  vehicleText: string | null;
  categoryText: string | null;
  destination: string | null;
  sales: string | null;
  lines: HistoryLine[];
  total: number | null;
  reservationFee: number;
  deposit: number;
  paymentMethod: "cash" | "gcash" | "card" | "bank" | "other";
};

export type BookingWorkbookPayload = {
  kind: "booking_workbook";
  fleet: VehicleImport[];
  rateCards: RateCardImport[];
  clients: ClientImport[];
  sequences: SequenceImport[];
  /** Phase 2a (absent in runs previewed before 2a). */
  drivers?: DriverImport[];
  history?: HistoryImport[];
  warnings: ImportWarning[];
};

export type DmsWorkbookPayload = {
  kind: "dms_workbook";
  blacklist: BlacklistImport[];
  warnings: ImportWarning[];
};

export type ImportPayload = BookingWorkbookPayload | DmsWorkbookPayload;

/** One row in the preview: what will happen to one record. */
export type PreviewItem = {
  action: "new" | "changed" | "unchanged" | "skipped";
  label: string;
  /** Field → [before, after] for `changed`; field values for `new`. */
  changes?: Record<string, [unknown, unknown]>;
  detail?: string;
};

export type SectionSummary = {
  section: SectionKey;
  counts: { new: number; changed: number; unchanged: number; skipped: number };
  warnings: ImportWarning[];
  items: PreviewItem[];
};

export type ImportSummary = {
  kind: WorkbookKind;
  sections: SectionSummary[];
  totals: { new: number; changed: number; unchanged: number; skipped: number; warnings: number };
};

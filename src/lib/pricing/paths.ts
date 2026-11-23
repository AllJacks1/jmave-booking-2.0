/**
 * Path helpers for rate-card values (`selfDrive.daily.compact.h24`,
 * `withDriver.driverFee.h8[0]`): read, immutable write, unit and label.
 */
import { BODY_TYPE_LABELS, RATE_KEY_LABELS, SERVICE_AREA_LABELS } from "./types";

function tokens(path: string): (string | number)[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((t) => (/^\d+$/.test(t) ? Number(t) : t));
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const t of tokens(path)) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string | number, unknown>)[t];
  }
  return cur;
}

export function setPath<T>(obj: T, path: string, value: unknown): T {
  const ts = tokens(path);
  const walk = (node: unknown, i: number): unknown => {
    if (i === ts.length) return value;
    const t = ts[i];
    const copy = Array.isArray(node) ? [...node] : { ...(node as Record<string, unknown>) };
    (copy as Record<string | number, unknown>)[t] = walk((node as Record<string | number, unknown>)?.[t], i + 1);
    return copy;
  };
  return walk(obj, 0) as T;
}

/** `withDriver.driverFee.h8[0]` → `withDriver.driverFee.h8.0` (zod issue path form). */
export function toDotPath(path: string): string {
  return path.replace(/\[(\d+)\]/g, ".$1");
}

export type ValueUnit = "money" | "number" | "percent" | "tenths";

export function unitOf(path: string): ValueUnit {
  if (/Bps$/.test(path) || /\.(shortBps|longBps)$/.test(path)) return "percent";
  if (/fuelFactorTenths$/.test(path)) return "tenths";
  if (/(kmPerLiter|bandMaxKm|mileageAllowanceKmPerDay|MinDays|FromDays|holidayMultiplier|workingHourMaxKm|longFromDays)/.test(path)) {
    return "number";
  }
  return "money";
}

const plain = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Display a stored value: money `1,580`, percent `3.5%`, tenths `2.2`. */
export function formatValue(path: string, v: unknown): string {
  if (typeof v !== "number") return v === undefined || v === null ? "—" : String(v);
  switch (unitOf(path)) {
    case "money":
      return money.format(v / 100);
    case "percent":
      return `${plain.format(v / 100)}%`;
    case "tenths":
      return plain.format(v / 10);
    default:
      return plain.format(v);
  }
}

/** Input text (no grouping) ↔ stored value. */
export function toInput(path: string, v: unknown): string {
  if (typeof v !== "number") return "";
  switch (unitOf(path)) {
    case "money":
    case "percent":
      return String(v / 100);
    case "tenths":
      return String(v / 10);
    default:
      return String(v);
  }
}

export function fromInput(path: string, s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  switch (unitOf(path)) {
    case "money":
    case "percent":
      return Math.round(n * 100);
    case "tenths":
      return Math.round(n * 10);
    default:
      return n;
  }
}

const WORDS: Record<string, string> = {
  selfDrive: "Self-Drive",
  withDriver: "With Driver",
  vehicleClasses: "Vehicle class",
  daily: "Daily rate",
  additionalHours: "Additional hours",
  additionalHoursCar: "Additional hours (car)",
  hourlyExtension: "Hourly extension",
  longTerm: "Long-term",
  driverFee: "Driver fee",
  bandMaxKm: "Band upper km",
  excessHourRates: "Excess-hour rate",
  unused: "Stored (unused)",
  pickupDropoffRate: "Pick-up/drop-off rate",
  vanDistanceRate: "Van distance rate",
  kmPerLiter: "km per liter",
  carwash: "Carwash",
  cdwPerDay: "CDW per day",
  excessPerKm: "Excess ₱/km",
  d30: "30+ days",
  d15to29: "15–29 days",
  h24: "24h",
  h12: "12h",
  h10: "10h",
  h8: "8h",
  rentersFuel: "Renter's fuel",
  allIn: "All-in",
  promos: "Promos",
  aprilTiered: "April tiered",
  ...RATE_KEY_LABELS,
  ...BODY_TYPE_LABELS,
  ...SERVICE_AREA_LABELS,
};

/** `selfDrive.daily.compact.h24` → `Self-Drive · Daily rate · Compact · 24h`. */
export function describePath(path: string): string {
  return tokens(path)
    .map((t) => (typeof t === "number" ? `band ${t + 1}` : (WORDS[t] ?? t.replace(/([A-Z])/g, " $1").toLowerCase())))
    .join(" · ");
}

/**
 * Time helpers. Store UTC instants (`timestamptz`); show and accept
 * Asia/Manila. Never use the server's local time zone.
 *
 * The Philippines has no daylight saving time (UTC+08:00 all year), so
 * conversions use a fixed offset; display goes through Intl with the zone.
 */

export const MANILA_TZ = "Asia/Manila";
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` calendar date. */
export type DateKey = string;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function pad(n: number, w = 2) {
  return String(n).padStart(w, "0");
}

/** Wall-clock fields of an instant in Manila. */
export function manilaParts(d: Date) {
  const local = new Date(d.getTime() + MANILA_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
  };
}

/** Manila calendar date of an instant: `2026-11-23`. */
export function manilaDateKey(d: Date): DateKey {
  const p = manilaParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Manila wall-clock time of an instant: `08:30`. */
export function manilaTime(d: Date): string {
  const p = manilaParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function isDateKey(s: string): boolean {
  const m = DATE_KEY_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Manila date + `HH:mm` → UTC instant. Throws on bad input. */
export function manilaToUtc(dateKey: DateKey, time = "00:00"): Date {
  const m = DATE_KEY_RE.exec(dateKey);
  const t = TIME_RE.exec(time);
  if (!m || !isDateKey(dateKey)) throw new Error(`Invalid date: ${dateKey}`);
  if (!t) throw new Error(`Invalid time: ${time}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]) - MANILA_OFFSET_MS);
}

/** Start of the Manila day containing `d`, as a UTC instant. */
export function startOfManilaDay(d: Date): Date {
  return manilaToUtc(manilaDateKey(d));
}

export function addDaysToKey(dateKey: DateKey, days: number): DateKey {
  const start = manilaToUtc(dateKey);
  return manilaDateKey(new Date(start.getTime() + days * DAY_MS));
}

/** Manila year of an instant (numbering resets on Manila New Year). */
export function manilaYear(d: Date): number {
  return manilaParts(d).year;
}

// ---------------------------------------------------------------------------
// Excel serials (import). Day 0 = 1899-12-30; fraction = time of day.
// Workbook values are Manila wall-clock.
// ---------------------------------------------------------------------------

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/** `46349` → `2026-11-23`. Returns null for non-finite or out-of-range input. */
export function excelSerialToDateKey(serial: number): DateKey | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const d = new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Fraction of a day → `HH:mm` (rounded to the minute). `0.3541666` → `08:30`. */
export function excelFractionToTime(fraction: number): string | null {
  if (!Number.isFinite(fraction)) return null;
  const frac = fraction - Math.floor(fraction);
  const minutes = Math.round(frac * 24 * 60) % (24 * 60);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Excel serial with optional time fraction (Manila wall-clock) → UTC instant. */
export function excelSerialToUtc(serial: number): Date | null {
  const key = excelSerialToDateKey(serial);
  const time = excelFractionToTime(serial);
  if (!key || !time) return null;
  return manilaToUtc(key, time);
}

/**
 * A JS Date that exceljs produced from a date cell. exceljs builds these as
 * if the wall-clock were UTC, so read the UTC fields as Manila wall-clock.
 */
export function excelDateToDateKey(d: Date): DateKey | null {
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: MANILA_TZ,
  year: "numeric",
  month: "short",
  day: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: MANILA_TZ,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** `Nov 23, 2026` */
export function formatManilaDate(d: Date | DateKey): string {
  return dateFmt.format(typeof d === "string" ? manilaToUtc(d, "12:00") : d);
}

/** `Nov 23, 2026, 8:30 AM` */
export function formatManilaDateTime(d: Date): string {
  return dateTimeFmt.format(d);
}

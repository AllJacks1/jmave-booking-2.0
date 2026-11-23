/**
 * Workbook reading helpers (import-map.md "General rules").
 * Reads cached values only (`cell.result` for formulas); never evaluates.
 */
import ExcelJS from "exceljs";
import { excelDateToDateKey, excelSerialToDateKey, isDateKey, type DateKey } from "@/lib/time";
import { BODY_TYPES, type BodyType, type FuelType } from "@/lib/pricing/types";

export type Workbook = ExcelJS.Workbook;
export type Worksheet = ExcelJS.Worksheet;
export type CellValue = string | number | boolean | Date | null;

export const BOOKING_WORKBOOK = "booking_workbook";
export const DMS_WORKBOOK = "dms_workbook";
export type WorkbookKind = typeof BOOKING_WORKBOOK | typeof DMS_WORKBOOK;

export const BOOKING_TABS = {
  specs: "SPECS",
  backbone: "Back bone",
  backboneWd: "Back bone WDRIVER",
  formula: "FORMULA",
  formulaWd: "FORMULA WDRIVER",
  qpFormula: "QP FORMULA",
  rentalLog: "Rental Log",
  wdRentalLog: "WD Rental Log",
} as const;
export const DMS_TABS = { blacklist: "Blacklisted Client " } as const;

/** Parse an .xlsx buffer. Skips drawings and images (the booking workbook carries ~30 MB of them). */
export async function loadWorkbook(buffer: ArrayBuffer | Buffer): Promise<Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer, {
    ignoreNodes: [
      "dataValidations",
      "conditionalFormatting",
      "hyperlinks",
      "drawing",
      "picture",
      "legacyDrawing",
      "extLst",
    ],
  } as never);
  return wb;
}

/** Which workbook this is, from its tab names. */
export function detectKind(wb: Workbook): WorkbookKind | null {
  if (wb.getWorksheet(BOOKING_TABS.rentalLog) && wb.getWorksheet(BOOKING_TABS.formula)) return BOOKING_WORKBOOK;
  if (wb.getWorksheet(DMS_TABS.blacklist)) return DMS_WORKBOOK;
  return null;
}

/** Cached value of a cell: formula result, rich text joined, errors → null. */
export function cellValue(ws: Worksheet, address: string | [number, number]): CellValue {
  const cell = typeof address === "string" ? ws.getCell(address) : ws.getCell(address[0], address[1]);
  return normaliseValue(cell.value);
}

export function normaliseValue(v: ExcelJS.CellValue): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v || "formula" in v || "sharedFormula" in v) {
      const r = (v as { result?: unknown }).result;
      if (r === undefined || r === null) return null;
      if (typeof r === "object" && !(r instanceof Date)) return null; // { error: '#N/A' }
      return normaliseValue(r as ExcelJS.CellValue);
    }
    if ("richText" in v) return normaliseValue((v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join(""));
    if ("text" in v) return normaliseValue((v as ExcelJS.CellHyperlinkValue).text as string);
    if ("error" in v) return null;
  }
  return null;
}

/** Trimmed text with single spaces, or null. Numbers become their plain string. */
export function text(v: CellValue): string | null {
  if (v === null) return null;
  if (v instanceof Date) return excelDateToDateKey(v);
  const s = (typeof v === "number" ? String(v) : String(v)).replace(/[​-‏‪-‮]/g, "").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/** A number from a numeric or numeric-text cell (commas, ₱ stripped). */
export function num(v: CellValue): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.replace(/[₱,\s]/g, "");
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  }
  return null;
}

/** Pesos cell → centavos (rounded). */
export function centavos(v: CellValue): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n * 100);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function key(y: number, m: number, d: number): DateKey | null {
  const k = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isDateKey(k) ? k : null;
}

function fullYear(y: number): number {
  if (y >= 100) return y;
  return y + (y > 40 ? 1900 : 2000);
}

/**
 * Date from a cell: exceljs Date, Excel serial, or text such as
 * `3/14/1990`, `14-03-1990`, `March 14, 1990`, `Mar.14,1990`, `2026-11-23`.
 * Numeric text is read month-first (PH usage) unless the first part is > 12.
 * Returns null when it cannot be read.
 */
export function dateFromCell(v: CellValue): DateKey | null {
  if (v === null || typeof v === "boolean") return null;
  if (v instanceof Date) return excelDateToDateKey(v);
  if (typeof v === "number") return excelSerialToDateKey(v);
  const s = v.trim().toLowerCase();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return key(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\s*[/\-. ]\s*(\d{1,2})\s*[/\-. ]\s*(\d{2,4})$/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = fullYear(+m[3]);
    return a > 12 ? key(y, b, a) : key(y, a, b);
  }
  m = /^([a-z]{3,9})\.?\s*(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})$/.exec(s);
  if (m && MONTHS[m[1].slice(0, m[1] === "sept" ? 4 : 3)]) {
    return key(+m[3], MONTHS[m[1].slice(0, m[1] === "sept" ? 4 : 3)], +m[2]);
  }
  m = /^(\d{1,2})\s+([a-z]{3,9})\.?,?\s*(\d{4})$/.exec(s);
  if (m && MONTHS[m[2].slice(0, 3)]) return key(+m[3], MONTHS[m[2].slice(0, 3)], +m[1]);
  return null;
}

/** Excel time-of-day from a cell (fraction or Date). */
export function timeFraction(v: CellValue): number | null {
  if (typeof v === "number" && v >= 0 && v < 1) return v;
  if (v instanceof Date) {
    return (v.getUTCHours() * 60 + v.getUTCMinutes()) / (24 * 60);
  }
  return null;
}

/** Plate: uppercase, single spaces. */
export function normalisePlate(v: string | null): string | null {
  if (!v) return null;
  const p = v.toUpperCase().replace(/\s+/g, " ").trim();
  return p === "" ? null : p;
}

const BODY_TYPE_MAP: Record<string, BodyType> = {
  compact: "compact",
  hatchback: "compact",
  sedan: "sedan",
  wagon: "wagon",
  wagpn: "wagon",
  mpv: "mpv",
  suv: "suv",
  pickup: "pickup",
  van: "van",
};

/** One mapping table for every body-type spelling. Unknown → null (caller warns). */
export function normaliseBodyType(v: string | null): BodyType | null {
  if (!v) return null;
  const k = v.toLowerCase().replace(/[\s\-_.]/g, "");
  if ((BODY_TYPES as readonly string[]).includes(k)) return k as BodyType;
  return BODY_TYPE_MAP[k] ?? null;
}

export function normaliseFuelType(v: string | null): FuelType | null {
  if (!v) return null;
  const k = v.toLowerCase().trim();
  if (k.startsWith("unleaded") || k === "gasoline" || k === "regular") return "gasoline";
  if (k.startsWith("premium")) return "premium";
  if (k.startsWith("diesel")) return "diesel";
  return null;
}

/** First number in text: `42 Liters` → 42. */
export function leadingNumber(v: string | null): number | null {
  if (!v) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(v);
  return m ? Number(m[1]) : null;
}

/** Column letter → number (A → 1). */
export function col(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Last row that has any value (exceljs rowCount includes formatted blanks). */
export function lastDataRow(ws: Worksheet): number {
  let last = 0;
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    let any = false;
    row.eachCell({ includeEmpty: false }, (c) => {
      if (normaliseValue(c.value) !== null) any = true;
    });
    if (any) last = r;
  });
  return last;
}

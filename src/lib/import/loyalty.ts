/**
 * Phase 3 import (import-map.md "Phase 3 import"): `Loyalty Log` →
 * `loyalty_accounts` + `points_ledger`. Pure parsing (no DB).
 *
 * Loyalty Log (header row 1): A rental date(s) (text such as "Aug 1-2, 2025"
 * or a date), B card `JMV-0001`, C VRA number, D number of rent, E days,
 * F points earned, G tier (a number or a sentence such as "…Tier 2 Client…").
 *
 * Client link: C (VRA number) → `VRA series Log` A → D quotation number
 * (the imported quotation's client). Fallback: `VRA series Log` C client
 * name. Each row becomes one `import` ledger entry worth F points.
 */
import { isDateKey, type DateKey } from "@/lib/time";
import type { ImportWarning, LoyaltyCardImport, LoyaltyRowImport } from "./types";
import { cellValue, dateFromCell, lastDataRow, num, text, type CellValue, type Workbook } from "./workbook";

export const LOYALTY_TABS = { log: "Loyalty Log", vra: "VRA series Log" } as const;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function dateKey(y: number, m: number, d: number): DateKey | null {
  const k = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isDateKey(k) ? k : null;
}

/**
 * First day of a rental-date cell: a date, or text like "Aug 1-2, 2025",
 * "Sep 13 - 15, 2025", "Aug 30 - Sep 2, 2025", "Dec 30 - Jan 2, 2026"
 * (the year belongs to the end, so a December start is the year before).
 */
export function rentalStartFromCell(v: CellValue): DateKey | null {
  const direct = dateFromCell(v);
  if (direct) return direct;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/\s+/g, " ");
  const m = /^([a-z]{3,9})\.?\s*(\d{1,2})(?:st|nd|rd|th)?\b(.*)$/.exec(s);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3)];
  if (!month) return null;
  const rest = m[3];
  const years = [...rest.matchAll(/\b(\d{4})\b/g)].map((x) => Number(x[1]));
  if (years.length === 0) return null;
  const firstYearAt = rest.search(/\b\d{4}\b/);
  const before = rest.slice(0, firstYearAt);
  // A year right after the start day (", 2025 - …") is the start's year.
  if (/^\s*,?\s*$/.test(before)) return dateKey(years[0], month, Number(m[2]));
  // Otherwise the year belongs to the end date; a later end month in a
  // smaller number means the range crossed New Year.
  const endMonth = /([a-z]{3,9})\.?\s*\d{1,2}/.exec(before);
  const em = endMonth ? MONTHS[endMonth[1].slice(0, 3)] : undefined;
  const year = em !== undefined && em < month ? years[0] - 1 : years[0];
  return dateKey(year, month, Number(m[2]));
}

/** `JMV-0001`, `jmv 1`, `JMV0001` → `JMV-0001`; else null. */
export function normaliseCardNo(v: string | null): string | null {
  if (!v) return null;
  const m = /^jmv\s*-?\s*(\d{1,9})$/i.exec(v.trim());
  return m ? `JMV-${String(Number(m[1])).padStart(4, "0")}` : null;
}

/** 2, "2", "Tier 2", "…You are now a Tier 2 Client…" → 2; else null. */
export function tierFromCell(v: CellValue): number | null {
  const n = num(v);
  if (n !== null && Number.isInteger(n) && n >= 0 && n <= 99) return n;
  const t = text(v);
  const m = t ? /tier\s*(\d{1,2})/i.exec(t) : null;
  return m ? Number(m[1]) : null;
}

export function parseLoyalty(wb: Workbook): { loyalty: LoyaltyCardImport[]; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const warn = (message: string, tab?: string, row?: number) => warnings.push({ section: "loyalty", level: "warning", message, tab, row });
  const log = wb.getWorksheet(LOYALTY_TABS.log);
  if (!log) {
    warnings.push({ section: "loyalty", level: "info", message: `Tab “${LOYALTY_TABS.log}” not found; no loyalty cards imported.` });
    return { loyalty: [], warnings };
  }

  // VRA number → quotation number, client name, generated date.
  const vra = new Map<string, { quotationNumber: string | null; clientName: string | null; date: DateKey | null }>();
  const vraWs = wb.getWorksheet(LOYALTY_TABS.vra);
  if (!vraWs) warn(`Tab “${LOYALTY_TABS.vra}” not found; cards are matched to clients by nothing.`);
  else {
    const last = lastDataRow(vraWs);
    for (let r = 2; r <= last; r++) {
      const series = text(cellValue(vraWs, [r, 1]));
      if (!series) continue;
      const k = series.toUpperCase().replace(/\s+/g, "");
      if (!vra.has(k)) {
        const q = text(cellValue(vraWs, [r, 4]));
        vra.set(k, {
          quotationNumber: q && /^QTN-(WD)?\d{4}-\d+$/i.test(q) ? q.toUpperCase() : null,
          clientName: text(cellValue(vraWs, [r, 3])),
          date: dateFromCell(cellValue(vraWs, [r, 2])),
        });
      }
    }
  }

  const cards = new Map<string, LoyaltyCardImport>();
  const seenKeys = new Map<string, number>();
  const last = lastDataRow(log);
  for (let r = 2; r <= last; r++) {
    const rawCard = text(cellValue(log, [r, 2]));
    const pointsCell = cellValue(log, [r, 6]);
    if (!rawCard && pointsCell === null) continue;
    const cardNo = normaliseCardNo(rawCard);
    if (!cardNo) {
      warn(`Row ${r}: “${rawCard ?? "(blank)"}” is not a loyalty number (JMV-0001); row skipped.`, LOYALTY_TABS.log, r);
      continue;
    }
    const points = num(pointsCell);
    if (points === null || !Number.isInteger(points)) {
      warn(`Row ${r} (${cardNo}): points “${text(pointsCell) ?? "(blank)"}” are not a whole number; row skipped.`, LOYALTY_TABS.log, r);
      continue;
    }
    if (points === 0) {
      warn(`Row ${r} (${cardNo}): 0 points; row skipped.`, LOYALTY_TABS.log, r);
      continue;
    }
    const vraNo = text(cellValue(log, [r, 3]))?.toUpperCase().replace(/\s+/g, "") ?? null;
    const link = vraNo ? vra.get(vraNo) : undefined;
    if (vraNo && !link) warn(`Row ${r} (${cardNo}): VRA number ${vraNo} is not in “${LOYALTY_TABS.vra}”.`, LOYALTY_TABS.log, r);
    const dateCell = cellValue(log, [r, 1]);
    let date = rentalStartFromCell(dateCell);
    if (!date && link?.date) date = link.date;
    if (!date) warn(`Row ${r} (${cardNo}): rental date “${text(dateCell) ?? "(blank)"}” could not be read.`, LOYALTY_TABS.log, r);
    const days = num(cellValue(log, [r, 5]));
    if (days !== null && Number.isInteger(days) && days > 0 && days * 50 !== points) {
      warnings.push({ section: "loyalty", level: "info", message: `Row ${r} (${cardNo}): ${days} day(s) but ${points} points; the logged points are imported.`, tab: LOYALTY_TABS.log, row: r });
    }

    const base = `loyalty:${cardNo}:${vraNo ?? `row${r}`}`;
    const n = (seenKeys.get(base) ?? 0) + 1;
    seenKeys.set(base, n);
    const row: LoyaltyRowImport = {
      row: r,
      importKey: n === 1 ? base : `${base}#${n}`,
      date,
      dateText: text(dateCell),
      vra: vraNo,
      points,
      quotationNumber: link?.quotationNumber ?? null,
      clientName: link?.clientName ?? null,
      tier: tierFromCell(cellValue(log, [r, 7])),
    };
    const card = cards.get(cardNo) ?? { cardNo, rows: [], memberSince: null, tier: null, points: 0 };
    card.rows.push(row);
    card.points += points;
    if (row.tier !== null) card.tier = row.tier;
    if (date && (!card.memberSince || date < card.memberSince)) card.memberSince = date;
    cards.set(cardNo, card);
  }
  for (const c of cards.values()) {
    if (!c.memberSince) {
      warn(`${c.cardNo}: no readable rental date; member since is left as the import date.`);
    }
  }
  return { loyalty: [...cards.values()].sort((a, b) => a.cardNo.localeCompare(b.cardNo)), warnings };
}

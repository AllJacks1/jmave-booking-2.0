/**
 * Phase 2a imports from the booking workbook (import-map.md "Phase 2a imports"):
 *
 * - Booking history: every `Rental Log` / `WD Rental Log` row with a
 *   quotation number becomes an imported quotation; `BOOKED` / `COMPLETED`
 *   Self-Drive rows also become bookings with their logged charges and the
 *   reservation fee payment.
 * - Drivers: `Back bone WDRIVER` M (name) and N (contact).
 *
 * Pure parsing (no DB). Money in centavos.
 */
import { phonesFromCell } from "@/lib/phone";
import type { PaymentMethod } from "@/lib/bookings/constants";
import type { Service } from "@/lib/pricing/types";
import { excelFractionToTime, manilaToUtc, type DateKey } from "@/lib/time";
import type { DriverImport, HistoryImport, HistoryLine, ImportWarning } from "./types";
import { BOOKING_TABS, cellValue, centavos, dateFromCell, lastDataRow, num, text, timeFraction, type Workbook } from "./workbook";

const SD_NUMBER = /^QTN-\d{4}-\d+$/;
const WD_NUMBER = /^QTN-WD\d{4}-\d+$/;

/** Logged amount columns → charge lines. `neg`: a discount (always subtracted). */
const SD_LINES: { col: string; label: string; neg?: boolean }[] = [
  { col: "M", label: "Rental rate" },
  { col: "N", label: "Additional hours" },
  { col: "O", label: "CDW" },
  { col: "P", label: "Carwash" },
  { col: "Q", label: "Delivery fee" },
  { col: "R", label: "Pick-up fee" },
  { col: "S", label: "OT premium" },
  { col: "T", label: "Beyond operating hours" },
  { col: "U", label: "Hourly extension" },
  { col: "W", label: "April promo", neg: true },
  { col: "X", label: "Less discount", neg: true },
];

const WD_LINES: { col: string; label: string; neg?: boolean }[] = [
  { col: "U", label: "Rental rate" },
  { col: "V", label: "Additional hours" },
  { col: "W", label: "CDW" },
  { col: "X", label: "Carwash" },
  { col: "Y", label: "Driver's fee (first day)" },
  { col: "Z", label: "Driver standby" },
  { col: "AA", label: "Driver's fee (last day)" },
  { col: "AB", label: "Accommodation" },
  { col: "AC", label: "Meal" },
  { col: "AD", label: "Fuel" },
  { col: "AE", label: "Excess mileage" },
  { col: "AH", label: "Less discount", neg: true },
  { col: "AJ", label: "Terminal fee" },
  { col: "AK", label: "Terminal fee (reservation)" },
  { col: "AN", label: "Corporate mark-up" },
];

/** Free-text payment mode → method. */
export function paymentMethodFromText(v: string | null): PaymentMethod {
  const s = (v ?? "").toLowerCase();
  if (/g-?cash/.test(s)) return "gcash";
  if (/card|credit|debit/.test(s)) return "card";
  if (/bank|bpi|bdo|metrobank|unionbank|landbank|transfer/.test(s)) return "bank";
  if (/cash/.test(s)) return "cash";
  return "other";
}

/** Dates outside 2000–2099 are typos in the log (e.g. year 25025). */
export function saneDate(key: DateKey | null): DateKey | null {
  if (!key) return null;
  const y = Number(key.slice(0, 4));
  return key.length === 10 && y >= 2000 && y <= 2099 ? key : null;
}

function instant(dateKey: DateKey | null, timeCell: ReturnType<typeof cellValue>): Date | null {
  if (!dateKey) return null;
  const frac = timeFraction(timeCell);
  return manilaToUtc(dateKey, frac === null ? "00:00" : (excelFractionToTime(frac) ?? "00:00"));
}

export function parseHistory(wb: Workbook): { history: HistoryImport[]; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const history: HistoryImport[] = [];
  const seen = new Map<string, string>();

  const readTab = (tab: string, service: Service) => {
    const ws = wb.getWorksheet(tab);
    if (!ws) {
      warnings.push({ section: "history", level: "warning", tab, message: "Tab not found; skipped." });
      return;
    }
    const sd = service === "self_drive";
    const last = lastDataRow(ws);
    for (let r = 2; r <= last; r++) {
      const c = (col: string) => cellValue(ws, `${col}${r}`);
      const warn = (message: string) => warnings.push({ section: "history", level: "warning", tab, row: r, message });
      const raw = text(c("A"));
      if (!raw) continue;
      const number = raw.replace(/\s+/g, "").toUpperCase();
      if (!(sd ? SD_NUMBER : WD_NUMBER).test(number)) {
        warn(`Quotation number "${raw}" not in the expected format; row skipped.`);
        continue;
      }
      const dup = seen.get(number);
      if (dup) {
        warn(`${number} appears again (first at ${dup}); this row is skipped.`);
        continue;
      }
      seen.set(number, `${tab}!A${r}`);

      const travelRaw = dateFromCell(c("C"));
      const travel = saneDate(travelRaw);
      if (travelRaw && !travel) warn(`${number}: travel date ${travelRaw} is out of range; ignored.`);
      const bookedRaw = dateFromCell(c("B"));
      const bookedOn = saneDate(bookedRaw);
      if (bookedRaw && !bookedOn) warn(`${number}: booking date ${bookedRaw} is out of range; ignored.`);
      const startAt = instant(travel, sd ? c("E") : c("D"));
      let endAt: Date | null = null;
      if (startAt) {
        if (sd) {
          let days = num(c("D"));
          if (days === null || days <= 0) {
            warn(`${number}: no day count; 1 day assumed.`);
            days = 1;
          }
          endAt = new Date(startAt.getTime() + days * 86_400_000);
        } else {
          let hours = num(c("E"));
          if (hours === null || hours <= 0) {
            warn(`${number}: no hours; 24 hours assumed.`);
            hours = 24;
          }
          endAt = new Date(startAt.getTime() + hours * 3_600_000);
        }
      } else {
        warn(`${number}: travel date not readable; imported without a schedule.`);
      }

      const lines: HistoryLine[] = [];
      for (const l of sd ? SD_LINES : WD_LINES) {
        const v = centavos(c(l.col));
        if (v) lines.push({ label: l.label, amount: l.neg ? -Math.abs(v) : v });
      }
      const total = sd ? (centavos(c("Z")) ?? centavos(c("V"))) : (centavos(c("AO")) ?? centavos(c("AL")) ?? centavos(c("AI")));
      const rawStatus = sd ? (text(c("AM"))?.toUpperCase() ?? null) : null;
      const status = rawStatus === "QUOTED" || rawStatus === "BOOKED" || rawStatus === "COMPLETED" ? rawStatus : null;
      if (rawStatus && !status) warn(`${number}: status "${rawStatus}" not recognised; treated as blank.`);

      history.push({
        tab,
        row: r,
        number,
        service,
        status,
        bookedOn,
        startAt: startAt?.toISOString() ?? null,
        endAt: endAt?.toISOString() ?? null,
        clientName: text(sd ? c("G") : c("H")),
        vehicleText: sd ? text(c("K")) : (text(c("O")) ?? text(c("L"))),
        categoryText: text(sd ? c("L") : c("AP")),
        destination: text(sd ? c("J") : c("K")),
        sales: text(c("F")),
        lines,
        total: total ?? (lines.length ? lines.reduce((s, l) => s + l.amount, 0) : null),
        reservationFee: Math.max(0, (sd ? centavos(c("Y")) : centavos(c("AG"))) ?? 0),
        deposit: sd ? Math.max(0, centavos(c("AB")) ?? 0) : 0,
        paymentMethod: paymentMethodFromText(text(sd ? c("AA") : c("S"))),
      });
    }
  };

  readTab(BOOKING_TABS.rentalLog, "self_drive");
  readTab(BOOKING_TABS.wdRentalLog, "with_driver");
  return { history, warnings };
}

export function parseDrivers(wb: Workbook): { drivers: DriverImport[]; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const drivers: DriverImport[] = [];
  const tab = BOOKING_TABS.backboneWd;
  const ws = wb.getWorksheet(tab);
  if (!ws) {
    warnings.push({ section: "drivers", level: "warning", tab, message: "Tab not found; no drivers imported." });
    return { drivers, warnings };
  }
  const seen = new Set<string>();
  const last = Math.min(lastDataRow(ws), 500);
  for (let r = 2; r <= last; r++) {
    const name = text(cellValue(ws, `M${r}`))?.replace(/\s+/g, " ");
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const contact = cellValue(ws, `N${r}`);
    const phone = phonesFromCell(contact)[0] ?? null;
    if (!phone && text(contact)) warnings.push({ section: "drivers", level: "warning", tab, row: r, message: `${name}: contact number not a valid PH number; left blank.` });
    drivers.push({ row: r, name, phone });
  }
  return { drivers, warnings };
}

/**
 * Rate cards (import-map.md "Rate cards"):
 *   FORMULA + FORMULA WDRIVER → v1 (active)
 *   QP FORMULA (Self-Drive) + v1 With Driver → v2 (draft)
 * Cell ranges: pricing.md §2.2, §3.2. After reading, v1 is compared with
 * pricing.md; every difference is a `mismatch` warning.
 */
import { formatPeso } from "@/lib/money";
import { EXPECTED_RATE_CARD_V1 } from "@/lib/pricing/expected-v1";
import { diffRateCards, rateCardDataSchema, type RateCardData } from "@/lib/pricing/rate-card";
import { BODY_TYPES, type BodyType, type RateKey } from "@/lib/pricing/types";
import type { ImportWarning, RateCardImport } from "./types";
import {
  BOOKING_TABS,
  cellValue,
  normaliseBodyType,
  num,
  text,
  type Workbook,
  type Worksheet,
} from "./workbook";

type Warn = (level: ImportWarning["level"], message: string, tab?: string) => void;

/** Reads numbers from one sheet; empty cells fall back to pricing.md with a warning. */
class SheetReader {
  constructor(
    readonly ws: Worksheet,
    private readonly warn: Warn,
  ) {}

  /** Pesos → centavos. */
  money(address: string, fallback: number, what: string): number {
    const n = num(cellValue(this.ws, address));
    if (n === null) {
      this.warn("warning", `${this.ws.name}!${address} (${what}) is empty or not a number; used pricing.md value ${formatPeso(fallback)}.`, this.ws.name);
      return fallback;
    }
    return Math.round(n * 100);
  }

  number(address: string, fallback: number, what: string): number {
    const n = num(cellValue(this.ws, address));
    if (n === null) {
      this.warn("warning", `${this.ws.name}!${address} (${what}) is empty; used pricing.md value ${fallback}.`, this.ws.name);
      return fallback;
    }
    return n;
  }

  /** Map body type → row number by scanning labels in `labelCol` over rows. */
  labelRows(labelCol: string, from: number, to: number): Map<BodyType, number> {
    const out = new Map<BodyType, number>();
    for (let r = from; r <= to; r++) {
      const label = text(cellValue(this.ws, `${labelCol}${r}`));
      const body = normaliseBodyType(label);
      if (body && !out.has(body)) out.set(body, r);
    }
    return out;
  }

  get name() {
    return this.ws.name;
  }
}

const E = EXPECTED_RATE_CARD_V1;

/** Self-Drive part + vehicle classes from FORMULA or QP FORMULA (same layout). */
function readSelfDrive(r: SheetReader, warn: Warn): Pick<RateCardData, "vehicleClasses" | "selfDrive"> {
  const sd = structuredClone(E.selfDrive);
  const daily = (key: RateKey, row: number) => {
    sd.daily[key] = {
      h24: r.money(`I${row}`, E.selfDrive.daily[key].h24, `${key} 24h`),
      h12: r.money(`J${row}`, E.selfDrive.daily[key].h12, `${key} 12h`),
      h8: r.money(`K${row}`, E.selfDrive.daily[key].h8, `${key} 8h`),
    };
  };
  daily("sedan_budgetmile", 34);
  daily("sedan_primo", 35);
  daily("sedan_premium", 36);
  daily("mpv_budgetmile", 41);
  daily("mpv_primo", 42);
  daily("suv_budgetmile", 48);
  daily("suv_primo", 49);
  // H56:O59, rows 57 = 8h, 58 = 12h, 59 = 24h
  for (const [key, c] of [["compact", "I"], ["wagon", "K"], ["pickup", "N"], ["van", "O"]] as const) {
    sd.daily[key] = {
      h8: r.money(`${c}57`, E.selfDrive.daily[key].h8, `${key} 8h`),
      h12: r.money(`${c}58`, E.selfDrive.daily[key].h12, `${key} 12h`),
      h24: r.money(`${c}59`, E.selfDrive.daily[key].h24, `${key} 24h`),
    };
  }

  // Additional hours. Categorised rows use their category's 8h/12h rate (S58 = K38 …).
  for (const key of ["sedan_budgetmile", "sedan_primo", "sedan_premium", "mpv_budgetmile", "mpv_primo", "suv_budgetmile", "suv_primo"] as const) {
    sd.additionalHours[key] = { h8: sd.daily[key].h8, h12: sd.daily[key].h12 };
  }
  // Q57:X59, rows 58 = 8h, 59 = 12h
  for (const [key, c] of [["compact", "R"], ["wagon", "T"], ["pickup", "W"], ["van", "X"]] as const) {
    sd.additionalHours[key] = {
      h8: r.money(`${c}58`, E.selfDrive.additionalHours[key].h8, `${key} additional 8h`),
      h12: r.money(`${c}59`, E.selfDrive.additionalHours[key].h12, `${key} additional 12h`),
    };
  }

  // Hourly extension J95:K101 (labels in J)
  const extRows = r.labelRows("J", 95, 101);
  for (const body of BODY_TYPES) {
    const row = extRows.get(body);
    if (row) sd.hourlyExtension[body] = r.money(`K${row}`, E.selfDrive.hourlyExtension[body], `${body} hourly extension`);
    else warn("info", `${r.name}: no hourly extension rate for ${body}; used ${formatPeso(E.selfDrive.hourlyExtension[body])} (PLAN Q7).`, r.name);
  }

  // Vehicle classes H65:M71 (labels in H): I km/L, K carwash, L CDW, M excess ₱/km
  const vehicleClasses = structuredClone(E.vehicleClasses);
  const clsRows = r.labelRows("H", 65, 71);
  for (const body of BODY_TYPES) {
    const row = clsRows.get(body);
    if (!row) {
      warn("warning", `${r.name}: vehicle class row for ${body} not found; used pricing.md values.`, r.name);
      continue;
    }
    vehicleClasses[body] = {
      kmPerLiter: r.number(`I${row}`, E.vehicleClasses[body].kmPerLiter, `${body} km/L`),
      carwash: r.money(`K${row}`, E.vehicleClasses[body].carwash, `${body} carwash`),
      cdwPerDay: r.money(`L${row}`, E.vehicleClasses[body].cdwPerDay, `${body} CDW`),
      excessPerKm: r.money(`M${row}`, E.vehicleClasses[body].excessPerKm, `${body} excess/km`),
    };
  }
  return { vehicleClasses, selfDrive: sd };
}

function readWithDriver(wb: Workbook, r: SheetReader, warn: Warn, sdClasses: RateCardData["vehicleClasses"]): RateCardData["withDriver"] {
  const wd = structuredClone(E.withDriver);

  // Category tables: D = 24h, E = 12h, F = 10h, G = 8h
  const daily = (key: RateKey, row: number) => {
    const ex = E.withDriver.daily[key];
    wd.daily[key] = {
      h24: r.money(`D${row}`, ex.h24, `${key} 24h`),
      h12: r.money(`E${row}`, ex.h12, `${key} 12h`),
      h10: r.money(`F${row}`, ex.h10, `${key} 10h`),
      h8: r.money(`G${row}`, ex.h8, `${key} 8h`),
    };
  };
  daily("sedan_budgetmile", 16);
  daily("sedan_primo", 17);
  daily("sedan_premium", 18);
  daily("mpv_budgetmile", 23);
  daily("mpv_primo", 24);
  daily("suv_budgetmile", 29);
  daily("suv_primo", 30);
  // C35:J39, rows 36 = 8h, 37 = 10h, 38 = 12h, 39 = 24h
  for (const [key, c] of [["compact", "D"], ["wagon", "F"], ["pickup", "I"], ["van", "J"]] as const) {
    const ex = E.withDriver.daily[key];
    wd.daily[key] = {
      h8: r.money(`${c}36`, ex.h8, `${key} 8h`),
      h10: r.money(`${c}37`, ex.h10, `${key} 10h`),
      h12: r.money(`${c}38`, ex.h12, `${key} 12h`),
      h24: r.money(`${c}39`, ex.h24, `${key} 24h`),
    };
  }

  // Long-term C3:M13 (labels in C, rows 5–11)
  const ltRows = r.labelRows("C", 5, 11);
  for (const body of BODY_TYPES) {
    const row = ltRows.get(body);
    if (!row) {
      warn("warning", `${r.name}: long-term row for ${body} not found; used pricing.md values.`, r.name);
      continue;
    }
    const ex = E.withDriver.longTerm[body];
    wd.longTerm[body] = {
      mindanao: { d30: r.money(`D${row}`, ex.mindanao.d30, `${body} Mindanao 30d`), d15to29: r.money(`E${row}`, ex.mindanao.d15to29, `${body} Mindanao 15–29d`) },
      davao_region: { d30: r.money(`H${row}`, ex.davao_region.d30, `${body} Davao Region 30d`), d15to29: r.money(`I${row}`, ex.davao_region.d15to29, `${body} Davao Region 15–29d`) },
      within_davao_city: { d30: r.money(`L${row}`, ex.within_davao_city.d30, `${body} Davao City 30d`), d15to29: r.money(`M${row}`, ex.within_davao_city.d15to29, `${body} Davao City 15–29d`) },
    };
  }

  // Additional hours (car) C96:J98: row 97 = 8h, 98 = 12h. Sedan follows the category (E97 = G20).
  for (const key of ["sedan_budgetmile", "sedan_primo", "sedan_premium"] as const) {
    wd.additionalHoursCar[key] = { h8: wd.daily[key].h8, h12: wd.daily[key].h12 };
  }
  const blockCols: [RateKey[], string][] = [
    [["compact"], "D"],
    [["wagon"], "F"],
    [["mpv_budgetmile", "mpv_primo"], "G"],
    [["suv_budgetmile", "suv_primo"], "H"],
    [["pickup"], "I"],
    [["van"], "J"],
  ];
  for (const [keys, c] of blockCols) {
    const h8 = r.money(`${c}97`, E.withDriver.additionalHoursCar[keys[0]].h8, `${keys[0]} additional 8h`);
    const h12 = r.money(`${c}98`, E.withDriver.additionalHoursCar[keys[0]].h12, `${keys[0]} additional 12h`);
    for (const k of keys) wd.additionalHoursCar[k] = { h8, h12 };
  }

  // Driver fee C115:K119: band headers in row 115, rows 116–119 = 8/10/12/24h
  const bandCols = ["D", "E", "F", "G", "H", "I", "J", "K"];
  wd.driverFee.bandMaxKm = bandCols.map((c, i) => {
    const label = text(cellValue(r.ws, `${c}115`));
    const nums = label?.match(/\d+(\.\d+)?/g);
    const max = nums ? Number(nums[nums.length - 1]) : null;
    if (max === null) {
      warn("warning", `${r.name}!${c}115 band header unreadable; used ${E.withDriver.driverFee.bandMaxKm[i]} km.`, r.name);
      return E.withDriver.driverFee.bandMaxKm[i];
    }
    return max;
  });
  for (const [tier, row] of [["h8", 116], ["h10", 117], ["h12", 118], ["h24", 119]] as const) {
    wd.driverFee[tier] = bandCols.map((c, i) => r.money(`${c}${row}`, E.withDriver.driverFee[tier][i], `driver fee ${tier} band ${i + 1}`));
  }
  // Additional hours (driver) C123:K125 must equal the 8h / 12h rows above.
  for (const [tier, row] of [["h8", 124], ["h12", 125]] as const) {
    bandCols.forEach((c, i) => {
      const v = num(cellValue(r.ws, `${c}${row}`));
      if (v !== null && Math.round(v * 100) !== wd.driverFee[tier][i]) {
        warn("mismatch", `${r.name}!${c}${row} additional-hours driver fee ${v} differs from the ${tier} driver fee; the engine uses the driver-fee table.`, r.name);
      }
    });
  }

  wd.workingHourFee = r.money("K154", E.withDriver.workingHourFee, "working-hour driver fee");
  wd.standbyDeduction = r.money("P6", E.withDriver.standbyDeduction, "standby deduction");

  // Stored, unused: pick-up/drop-off rate C76:D82 and van distance rate L268:L269
  const pdRows = r.labelRows("C", 76, 82);
  for (const body of BODY_TYPES) {
    const row = pdRows.get(body);
    if (row) wd.unused.pickupDropoffRate[body] = r.money(`D${row}`, E.withDriver.unused.pickupDropoffRate[body], `${body} pick-up/drop-off rate`);
  }
  wd.unused.vanDistanceRate = {
    upTo150Km: r.money("L268", E.withDriver.unused.vanDistanceRate.upTo150Km, "van 1–150 km"),
    above150Km: r.money("L269", E.withDriver.unused.vanDistanceRate.above150Km, "van 151+ km"),
  };

  // Vehicle class table must match FORMULA's (same table in both sheets).
  const clsRows = r.labelRows("C", 45, 51);
  for (const body of BODY_TYPES) {
    const row = clsRows.get(body);
    if (!row) continue;
    const vals = {
      kmPerLiter: num(cellValue(r.ws, `D${row}`)),
      carwash: num(cellValue(r.ws, `F${row}`)),
      cdwPerDay: num(cellValue(r.ws, `G${row}`)),
      excessPerKm: num(cellValue(r.ws, `H${row}`)),
    };
    const sd = sdClasses[body];
    const same =
      vals.kmPerLiter === sd.kmPerLiter &&
      Math.round((vals.carwash ?? -1) * 100) === sd.carwash &&
      Math.round((vals.cdwPerDay ?? -1) * 100) === sd.cdwPerDay &&
      Math.round((vals.excessPerKm ?? -1) * 100) === sd.excessPerKm;
    if (!same) warn("mismatch", `${r.name}: ${body} vehicle class differs from FORMULA; FORMULA values used.`, r.name);
  }

  // Excess-hour rates: Back bone WDRIVER!Q2:S9 (Q label, R renter's fuel, S all-in)
  const bbw = wb.getWorksheet(BOOKING_TABS.backboneWd);
  if (!bbw) {
    warn("warning", `${BOOKING_TABS.backboneWd} tab not found; excess-hour rates from pricing.md.`);
  } else {
    const br = new SheetReader(bbw, warn);
    const seen = new Set<BodyType>();
    for (let row = 2; row <= 9; row++) {
      const label = text(cellValue(bbw, `Q${row}`));
      const body = normaliseBodyType(label);
      if (!body) {
        if (label) warn("info", `${bbw.name}!Q${row} "${label}" is not a body type; row ignored.`, bbw.name);
        continue;
      }
      seen.add(body);
      wd.excessHourRates[body] = {
        rentersFuel: br.money(`R${row}`, E.withDriver.excessHourRates[body].rentersFuel, `${body} excess hour (renter's fuel)`),
        allIn: br.money(`S${row}`, E.withDriver.excessHourRates[body].allIn, `${body} excess hour (all-in)`),
      };
    }
    for (const body of BODY_TYPES) {
      if (!seen.has(body)) warn("warning", `${bbw.name}: no excess-hour rate for ${body}; used pricing.md value.`, bbw.name);
    }
  }

  return wd;
}

/** Values the sheets keep inside formulas, not in table cells: always from pricing.md. */
const FROM_PRICING_MD =
  "Terminal fee 3.5%, mileage allowance 150 km/day, OT premium, beyond-operating-hours, promos, new-client and 7-day discounts, holiday ×2, service fee, rounding step, fuel factor 2.2 and night differential 10% are not table cells in the workbook; taken from pricing.md.";

export function parseRateCards(wb: Workbook): { rateCards: RateCardImport[]; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const warn: Warn = (level, message, tab) => warnings.push({ section: "rate_cards", level, message, tab });
  const rateCards: RateCardImport[] = [];

  const formula = wb.getWorksheet(BOOKING_TABS.formula);
  const formulaWd = wb.getWorksheet(BOOKING_TABS.formulaWd);
  if (!formula || !formulaWd) {
    warn("warning", "FORMULA or FORMULA WDRIVER tab not found; rate cards not imported.");
    return { rateCards, warnings };
  }
  warn("info", FROM_PRICING_MD);

  const sd1 = readSelfDrive(new SheetReader(formula, warn), warn);
  const v1: RateCardData = {
    ...structuredClone(E),
    vehicleClasses: sd1.vehicleClasses,
    selfDrive: sd1.selfDrive,
    withDriver: readWithDriver(wb, new SheetReader(formulaWd, warn), warn, sd1.vehicleClasses),
  };
  const v1Parsed = rateCardDataSchema.safeParse(v1);
  if (!v1Parsed.success) {
    warn("warning", `Rate card v1 is invalid: ${v1Parsed.error.issues[0]?.path.join(".")} ${v1Parsed.error.issues[0]?.message}. Not imported.`);
  } else {
    // Self-check against pricing.md.
    for (const d of diffRateCards(EXPECTED_RATE_CARD_V1, v1Parsed.data)) {
      warn("mismatch", `v1 ${d.path}: workbook ${fmt(d.path, d.after)}, pricing.md ${fmt(d.path, d.before)}.`);
    }
    rateCards.push({ version: 1, name: "FORMULA (old workbook)", status: "active", source: "import:FORMULA+FORMULA WDRIVER", data: v1Parsed.data });
  }

  const qp = wb.getWorksheet(BOOKING_TABS.qpFormula);
  if (!qp) {
    warn("info", "QP FORMULA tab not found; no draft rate card.");
  } else if (v1Parsed.success) {
    const qpWarn: Warn = (level, message, tab) => warn(level === "info" ? "info" : "warning", message, tab);
    const sd2 = readSelfDrive(new SheetReader(qp, qpWarn), qpWarn);
    const v2 = rateCardDataSchema.safeParse({
      ...structuredClone(v1Parsed.data),
      vehicleClasses: sd2.vehicleClasses,
      selfDrive: sd2.selfDrive,
    });
    if (!v2.success) {
      warn("warning", `Rate card v2 (QP FORMULA) is invalid: ${v2.error.issues[0]?.message}. Not imported.`);
    } else {
      const n = diffRateCards(v1Parsed.data, v2.data).length;
      warn("info", `v2 (QP FORMULA) differs from v1 in ${n} values (PLAN Q3: imported as a draft).`);
      rateCards.push({ version: 2, name: "QP FORMULA (quotation purpose)", status: "draft", source: "import:QP FORMULA", data: v2.data });
    }
  }
  return { rateCards, warnings };
}

function fmt(path: string, v: unknown): string {
  if (typeof v !== "number") return String(v);
  return /kmPerLiter|bandMaxKm|Bps|Days|Multiplier|Tenths|mileageAllowance/i.test(path) ? String(v) : formatPeso(v);
}

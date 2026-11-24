/**
 * Invented workbooks with the same tab and cell layout as the owner's files
 * (import-map.md, pricing.md cell ranges). No real client data.
 */
import ExcelJS from "exceljs";
import { EXPECTED_RATE_CARD_V1 } from "@/lib/pricing/expected-v1";
import type { RateCardData } from "@/lib/pricing/rate-card";

const peso = (c: number) => c / 100;

const LABELS: Record<string, string> = {
  compact: "Compact",
  sedan: "Sedan",
  wagon: "Wagon",
  mpv: "MPV",
  suv: "SUV",
  pickup: "Pick up",
  van: "Van",
};

function writeSelfDrive(ws: ExcelJS.Worksheet, card: RateCardData) {
  const sd = card.selfDrive;
  const row = (r: number, key: keyof typeof sd.daily) => {
    ws.getCell(`I${r}`).value = peso(sd.daily[key].h24);
    ws.getCell(`J${r}`).value = peso(sd.daily[key].h12);
    ws.getCell(`K${r}`).value = peso(sd.daily[key].h8);
  };
  row(34, "sedan_budgetmile");
  row(35, "sedan_primo");
  row(36, "sedan_premium");
  row(41, "mpv_budgetmile");
  row(42, "mpv_primo");
  row(48, "suv_budgetmile");
  row(49, "suv_primo");
  for (const [key, c] of [["compact", "I"], ["wagon", "K"], ["pickup", "N"], ["van", "O"]] as const) {
    // Cached formula results, like the real sheet (=roundup(...)).
    ws.getCell(`${c}57`).value = { formula: "1+1", result: peso(sd.daily[key].h8) };
    ws.getCell(`${c}58`).value = peso(sd.daily[key].h12);
    ws.getCell(`${c}59`).value = peso(sd.daily[key].h24);
  }
  for (const [key, c] of [["compact", "R"], ["wagon", "T"], ["pickup", "W"], ["van", "X"]] as const) {
    ws.getCell(`${c}58`).value = peso(sd.additionalHours[key].h8);
    ws.getCell(`${c}59`).value = peso(sd.additionalHours[key].h12);
  }
  // Hourly extension: van missing, like the real sheet (PLAN Q7).
  const ext = ["compact", "sedan", "wagon", "mpv", "suv", null, "pickup"] as const;
  ext.forEach((b, i) => {
    if (!b) return;
    ws.getCell(`J${95 + i}`).value = LABELS[b];
    ws.getCell(`K${95 + i}`).value = peso(sd.hourlyExtension[b]);
  });
  const cls = ["compact", "sedan", "mpv", "suv", "pickup", "wagon", "van"] as const;
  cls.forEach((b, i) => {
    const r = 65 + i;
    ws.getCell(`H${r}`).value = LABELS[b];
    ws.getCell(`I${r}`).value = card.vehicleClasses[b].kmPerLiter;
    ws.getCell(`K${r}`).value = peso(card.vehicleClasses[b].carwash);
    ws.getCell(`L${r}`).value = peso(card.vehicleClasses[b].cdwPerDay);
    ws.getCell(`M${r}`).value = peso(card.vehicleClasses[b].excessPerKm);
  });
}

function writeWithDriver(ws: ExcelJS.Worksheet, card: RateCardData) {
  const wd = card.withDriver;
  const cat = (r: number, key: keyof typeof wd.daily) => {
    ws.getCell(`D${r}`).value = peso(wd.daily[key].h24);
    ws.getCell(`E${r}`).value = peso(wd.daily[key].h12);
    ws.getCell(`F${r}`).value = peso(wd.daily[key].h10);
    ws.getCell(`G${r}`).value = peso(wd.daily[key].h8);
  };
  cat(16, "sedan_budgetmile");
  cat(17, "sedan_primo");
  cat(18, "sedan_premium");
  cat(23, "mpv_budgetmile");
  cat(24, "mpv_primo");
  cat(29, "suv_budgetmile");
  cat(30, "suv_primo");
  for (const [key, c] of [["compact", "D"], ["wagon", "F"], ["pickup", "I"], ["van", "J"]] as const) {
    ws.getCell(`${c}36`).value = peso(wd.daily[key].h8);
    ws.getCell(`${c}37`).value = peso(wd.daily[key].h10);
    ws.getCell(`${c}38`).value = peso(wd.daily[key].h12);
    ws.getCell(`${c}39`).value = peso(wd.daily[key].h24);
  }
  const lt = ["compact", "sedan", "mpv", "suv", "pickup", "van", "wagon"] as const;
  lt.forEach((b, i) => {
    const r = 5 + i;
    const v = wd.longTerm[b];
    ws.getCell(`C${r}`).value = LABELS[b];
    ws.getCell(`D${r}`).value = peso(v.mindanao.d30);
    ws.getCell(`E${r}`).value = peso(v.mindanao.d15to29);
    ws.getCell(`H${r}`).value = peso(v.davao_region.d30);
    ws.getCell(`I${r}`).value = peso(v.davao_region.d15to29);
    ws.getCell(`L${r}`).value = peso(v.within_davao_city.d30);
    ws.getCell(`M${r}`).value = peso(v.within_davao_city.d15to29);
  });
  for (const [key, c] of [["compact", "D"], ["sedan_premium", "E"], ["wagon", "F"], ["mpv_primo", "G"], ["suv_primo", "H"], ["pickup", "I"], ["van", "J"]] as const) {
    ws.getCell(`${c}97`).value = peso(wd.additionalHoursCar[key].h8);
    ws.getCell(`${c}98`).value = peso(wd.additionalHoursCar[key].h12);
  }
  const bandLabels = ["1km - 70km", "71-110", "111-150", "151-190", "191-230", "231-270", "271-310", "311-500"];
  const cols = ["D", "E", "F", "G", "H", "I", "J", "K"];
  cols.forEach((c, i) => {
    ws.getCell(`${c}115`).value = bandLabels[i];
    ws.getCell(`${c}116`).value = peso(wd.driverFee.h8[i]);
    ws.getCell(`${c}117`).value = peso(wd.driverFee.h10[i]);
    ws.getCell(`${c}118`).value = peso(wd.driverFee.h12[i]);
    ws.getCell(`${c}119`).value = peso(wd.driverFee.h24[i]);
    ws.getCell(`${c}124`).value = peso(wd.driverFee.h8[i]);
    ws.getCell(`${c}125`).value = peso(wd.driverFee.h12[i]);
  });
  ws.getCell("K154").value = peso(wd.workingHourFee);
  ws.getCell("P6").value = peso(wd.standbyDeduction);
  const pd = ["compact", "sedan", "wagon", "mpv", "suv", "pickup", "van"] as const;
  pd.forEach((b, i) => {
    ws.getCell(`C${76 + i}`).value = LABELS[b];
    ws.getCell(`D${76 + i}`).value = peso(wd.unused.pickupDropoffRate[b]);
  });
  ws.getCell("L268").value = peso(wd.unused.vanDistanceRate.upTo150Km);
  ws.getCell("L269").value = peso(wd.unused.vanDistanceRate.above150Km);
  const cls = ["compact", "sedan", "mpv", "suv", "pickup", "wagon", "van"] as const;
  cls.forEach((b, i) => {
    const r = 45 + i;
    ws.getCell(`C${r}`).value = LABELS[b];
    ws.getCell(`D${r}`).value = card.vehicleClasses[b].kmPerLiter;
    ws.getCell(`F${r}`).value = peso(card.vehicleClasses[b].carwash);
    ws.getCell(`G${r}`).value = peso(card.vehicleClasses[b].cdwPerDay);
    ws.getCell(`H${r}`).value = peso(card.vehicleClasses[b].excessPerKm);
  });
}

export type FixtureOptions = {
  /** Change one FORMULA cell to provoke a self-check mismatch. */
  tamperCompact24h?: number;
  /** Extra Rental Log rows appended after the defaults. */
  extraRentalRows?: Partial<Record<string, ExcelJS.CellValue>>[];
};

/** Rental Log columns used by the import (letters per import-map.md). */
const SD_ROWS: Partial<Record<string, ExcelJS.CellValue>>[] = [
  // Same client twice (shared phone), latest row has a new address and is BOOKED.
  { A: "QTN-2026-101", B: new Date(Date.UTC(2026, 0, 5)), C: new Date(Date.UTC(2026, 0, 10)), E: 0.375, G: "Ana Testcase", H: "Ana T.", AF: 9170000001, AG: "ana@example.test", AH: "3/14/1990", AI: "Old Street 1", AM: "QUOTED" },
  { A: "QTN-2026-102", B: new Date(Date.UTC(2026, 1, 1)), C: new Date(Date.UTC(2026, 1, 3)), E: 0.5, G: "Ana Testcase", H: "Ana T.", AF: "0917 000 0001", AI: "New Street 2", AM: "BOOKED" },
  // Phone with a typo (not PH), email only → matched by email.
  { A: "QTN-2026-103", B: new Date(Date.UTC(2026, 1, 2)), C: new Date(Date.UTC(2026, 1, 4)), G: "Ben Sample", AF: "44 20 7946 0000", AG: "Ben@Example.test ", AH: "N/A", AM: "COMPLETED" },
  // No contact at all → name + FB name.
  { A: "QTN-2026-109", B: new Date(Date.UTC(2026, 1, 3)), C: new Date(Date.UTC(2026, 1, 5)), G: "Cora Nocontact", H: "Cora FB", AM: "QUOTED" },
  // No name → skipped with a warning.
  { A: "QTN-2025-777", B: new Date(Date.UTC(2025, 11, 30)), AF: 9170000009 },
  // Bad birthday text.
  { A: "QTN-2026-104", B: new Date(Date.UTC(2026, 1, 4)), G: "Dan Example", AF: "09170000004", AH: "sometime in May" },
];

const WD_ROWS: Partial<Record<string, ExcelJS.CellValue>>[] = [
  { A: "QTN-WD2026-007", B: new Date(Date.UTC(2026, 2, 1)), C: new Date(Date.UTC(2026, 2, 2)), D: 0.354, G: 9170000001, H: "Ana Testcase", I: "Ana T.", R: "Individual" },
  { A: "QTN-WD2026-012", B: new Date(Date.UTC(2026, 2, 3)), C: new Date(Date.UTC(2026, 2, 4)), D: 0.354, G: "0917-000-0005", H: "Eve Corp", R: "Corporate" },
];

export async function bookingWorkbook(opts: FixtureOptions = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const card = structuredClone(EXPECTED_RATE_CARD_V1);

  const specs = wb.addWorksheet("SPECS");
  specs.addRow(["", "", "Make:", "Model:", "Year:", "Color:", "Plate Number:", "Transmission:", "Chassis No.:", "Engine No.:", "Engine", "Body Type:", "Fuel:", "Fuel tank Capacity"]);
  specs.addRow(["Testcar Red AT TST 1001", null, "Toyota", "Testcar", 2024, "Red", "TST 1001", "AT", "CH-1", "EN-1", 1.3, "SEDAN", "Unleaded", "42 Liters"]);
  specs.addRow(["Bigcar White AT", null, "Toyota", "Bigcar", 2023, "White", null, "AT", "CH-2", "EN-2", 2.8, "SUV", "Diesel", " 80 liters"]);
  specs.addRow(["Oddcar", null, "X", "Y", 2020, "Blue", "TST 3003", "MT", null, null, null, "Hovercraft", "Plasma", "10 Liters"]);
  specs.addRow([]);
  specs.addRow(["Helper row after blank", null, "ignored"]);

  const bb = wb.addWorksheet("Back bone");
  bb.getCell("G1").value = "Testcar Red AT";
  bb.getCell("H1").value = "tst  1001";
  bb.getCell("J1").value = "Sedan";
  bb.getCell("L1").value = "Operators Name";
  bb.getCell("G2").value = "Bigcar White AT";
  bb.getCell("H2").value = "TST 2002";
  bb.getCell("J2").value = "SUV";
  bb.getCell("L2").value = "Operator Person";
  bb.getCell("G3").value = "Onlyhere Van";
  bb.getCell("H3").value = "TST 4004";
  bb.getCell("J3").value = "VAN";

  const bbw = wb.addWorksheet("Back bone WDRIVER");
  // Drivers (M name, N contact): invented.
  bbw.getCell("M1").value = "Drivers Name";
  bbw.getCell("N1").value = "Cont Number";
  bbw.getCell("M2").value = "Dario Driverson";
  bbw.getCell("N2").value = 9170001111;
  bbw.getCell("M3").value = "Wendy Wheel";
  bbw.getCell("N3").value = "n/a";
  const ehr = [["Sedan", "sedan"], ["Compact", "compact"], ["MGZ", null], ["MPV", "mpv"], ["SUV", "suv"], ["Pick-up", "pickup"], ["VAN", "van"], ["Wagon", "wagon"]] as const;
  ehr.forEach(([label, b], i) => {
    bbw.getCell(`Q${2 + i}`).value = label;
    bbw.getCell(`R${2 + i}`).value = b ? peso(card.withDriver.excessHourRates[b].rentersFuel) : 450;
    bbw.getCell(`S${2 + i}`).value = b ? peso(card.withDriver.excessHourRates[b].allIn) : 550;
  });

  const formula = wb.addWorksheet("FORMULA");
  writeSelfDrive(formula, card);
  if (opts.tamperCompact24h !== undefined) formula.getCell("I59").value = opts.tamperCompact24h;
  writeWithDriver(wb.addWorksheet("FORMULA WDRIVER"), card);

  const qpCard = structuredClone(card);
  qpCard.selfDrive.daily.compact.h24 = 149900;
  writeSelfDrive(wb.addWorksheet("QP FORMULA"), qpCard);

  const log = wb.addWorksheet("Rental Log");
  log.getCell("A1").value = "f";
  log.getCell("G1").value = "Client";
  for (const [i, row] of [...SD_ROWS, ...(opts.extraRentalRows ?? [])].entries()) {
    for (const [c, v] of Object.entries(row)) log.getCell(`${c}${i + 2}`).value = v ?? null;
  }
  const wdLog = wb.addWorksheet("WD Rental Log");
  wdLog.getCell("H1").value = "Client";
  WD_ROWS.forEach((row, i) => {
    for (const [c, v] of Object.entries(row)) wdLog.getCell(`${c}${i + 2}`).value = v ?? null;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function dmsWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Blacklisted Client ");
  ws.addRow(["", "BLACKLISTED  CLIENTS (NEW)", "Contact No.", "PARTICULAR", ""]);
  // Matches Ana by phone.
  ws.addRow(["", "Ana Testcase", 9170000001, "Unpaid balance", "", ""]);
  // Unmatched: creates a client; aliases and FB name.
  ws.addRow(["", "Zed Unknown / Zed U. / FB: Zed FB", "0917-000-0099", "Damaged car", "Called twice", "No ID"]);
  // Matches Cora by name only (no phone).
  ws.addRow(["", "Cora Nocontact", null, "Fake booking"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Fleet → vehicles (import-map.md "Fleet"). Tab `SPECS` (header row 1),
 * enriched by tab `Back bone` (G car, H plate, J body type, L operator).
 */
import type { ImportWarning, VehicleImport } from "./types";
import {
  BOOKING_TABS,
  cellValue,
  leadingNumber,
  normaliseBodyType,
  normaliseFuelType,
  normalisePlate,
  num,
  text,
  type Workbook,
} from "./workbook";

const SPEC_COLS = ["A", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"] as const;

export function vehicleKey(plate: string | null, displayName: string): string {
  return plate ? plate : `name:${displayName.toLowerCase()}`;
}

export function parseFleet(wb: Workbook): { vehicles: VehicleImport[]; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const warn = (tab: string, row: number | undefined, message: string, level: ImportWarning["level"] = "warning") =>
    warnings.push({ section: "fleet", level, tab, row, message });

  const specs = wb.getWorksheet(BOOKING_TABS.specs);
  const vehicles: VehicleImport[] = [];
  if (!specs) {
    warn(BOOKING_TABS.specs, undefined, "Tab not found; fleet not imported.");
    return { vehicles, warnings };
  }

  const byKey = new Map<string, VehicleImport>();
  for (let r = 2; r <= specs.rowCount; r++) {
    const v = Object.fromEntries(SPEC_COLS.map((c) => [c, cellValue(specs, `${c}${r}`)])) as Record<
      (typeof SPEC_COLS)[number],
      ReturnType<typeof cellValue>
    >;
    // Stop at the first fully blank row (row 27 is a duplicate helper row).
    if (SPEC_COLS.every((c) => v[c] === null)) break;

    const displayName = text(v.A);
    const plate = normalisePlate(text(v.G));
    if (!displayName && !plate) {
      warn(specs.name, r, "Row has neither a name nor a plate; skipped.");
      continue;
    }
    const name = displayName ?? plate!;
    const bodyRaw = text(v.L);
    const bodyType = normaliseBodyType(bodyRaw);
    if (bodyRaw && !bodyType) warn(specs.name, r, `Unknown body type "${bodyRaw}".`);
    const fuelRaw = text(v.M);
    const fuelType = normaliseFuelType(fuelRaw);
    if (fuelRaw && !fuelType) warn(specs.name, r, `Unknown fuel "${fuelRaw}".`);
    const year = num(v.E);
    const tank = leadingNumber(text(v.N));

    const vehicle: VehicleImport = {
      key: vehicleKey(plate, name),
      displayName: name,
      plate,
      make: text(v.C),
      model: text(v.D),
      year: year !== null && Number.isInteger(year) ? year : null,
      color: text(v.F),
      transmission: text(v.H),
      chassisNo: text(v.I),
      engineNo: text(v.J),
      engine: text(v.K),
      bodyType,
      fuelType,
      tankCapacityL: tank !== null ? Math.round(tank) : null,
      operatorName: null,
      sortOrder: vehicles.length * 10 + 10,
      source: { tab: specs.name, row: r },
    };
    if (byKey.has(vehicle.key)) {
      warn(specs.name, r, `Duplicate of an earlier row (${plate ?? name}); skipped.`);
      continue;
    }
    byKey.set(vehicle.key, vehicle);
    vehicles.push(vehicle);
  }

  const bb = wb.getWorksheet(BOOKING_TABS.backbone);
  if (!bb) warn(BOOKING_TABS.backbone, undefined, "Tab not found; operator names not imported.", "info");
  // No header for G–J (row 1 holds a car); column L has the header "Operators Name".
  for (let r = 1; bb && r <= bb.rowCount; r++) {
    const carName = text(cellValue(bb, `G${r}`));
    const plate = normalisePlate(text(cellValue(bb, `H${r}`)));
    if (!carName || !plate) continue;
    let operator = text(cellValue(bb, `L${r}`));
    if (operator && /^operators?'?\s*name$/i.test(operator)) operator = null;
    const bodyRaw = text(cellValue(bb, `J${r}`));
    const existing = byKey.get(plate);
    if (existing) {
      if (operator) existing.operatorName = operator;
      continue;
    }
    // A SPECS row without a plate and the same car name: take the plate from Back bone.
    const plateless = vehicles.find(
      (v) => !v.plate && v.displayName.toLowerCase().startsWith(carName.toLowerCase()),
    );
    if (plateless) {
      byKey.delete(plateless.key);
      plateless.plate = plate;
      plateless.key = plate;
      if (operator) plateless.operatorName = operator;
      byKey.set(plate, plateless);
      warn(bb.name, r, `Plate ${plate} for "${plateless.displayName}" taken from Back bone (SPECS has none).`, "info");
      continue;
    }
    const bodyType = normaliseBodyType(bodyRaw);
    if (bodyRaw && !bodyType) warn(bb.name, r, `Unknown body type "${bodyRaw}".`);
    warn(bb.name, r, `"${carName}" (${plate}) is in Back bone but not in SPECS; added with fewer details.`);
    const vehicle: VehicleImport = {
      key: plate,
      displayName: `${carName} ${plate}`,
      plate,
      make: null,
      model: null,
      year: null,
      color: null,
      transmission: null,
      chassisNo: null,
      engineNo: null,
      engine: null,
      bodyType,
      fuelType: null,
      tankCapacityL: null,
      operatorName: operator,
      sortOrder: vehicles.length * 10 + 10,
      source: { tab: bb.name, row: r },
    };
    byKey.set(plate, vehicle);
    vehicles.push(vehicle);
  }

  for (const v of vehicles) {
    if (!v.plate) warn(v.source.tab, v.source.row, `"${v.displayName}" has no plate; matched by name.`);
  }
  return { vehicles, warnings };
}

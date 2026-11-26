/**
 * Parse an uploaded workbook into an import payload (no DB access).
 */
import { parseBlacklist } from "./blacklist";
import { parseClients } from "./clients";
import { parseFleet } from "./fleet";
import { parseDrivers, parseHistory } from "./history";
import { parseLoyalty } from "./loyalty";
import { parseRateCards } from "./rate-cards";
import type { ImportPayload } from "./types";
import { BOOKING_WORKBOOK, detectKind, loadWorkbook, type Workbook } from "./workbook";

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFileError";
  }
}

export function parseWorkbook(wb: Workbook): ImportPayload {
  const kind = detectKind(wb);
  if (!kind) {
    throw new ImportFileError(
      "This workbook is neither the booking workbook (needs tabs “Rental Log” and “FORMULA”) nor the DMS workbook (needs tab “Blacklisted Client ”).",
    );
  }
  if (kind === BOOKING_WORKBOOK) {
    const fleet = parseFleet(wb);
    const rates = parseRateCards(wb);
    const clients = parseClients(wb);
    const drivers = parseDrivers(wb);
    const history = parseHistory(wb);
    const loyalty = parseLoyalty(wb);
    return {
      kind,
      fleet: fleet.vehicles,
      rateCards: rates.rateCards,
      clients: clients.clients,
      sequences: clients.sequences,
      drivers: drivers.drivers,
      history: history.history,
      loyalty: loyalty.loyalty,
      warnings: [...fleet.warnings, ...rates.warnings, ...clients.warnings, ...drivers.warnings, ...history.warnings, ...loyalty.warnings],
    };
  }
  const bl = parseBlacklist(wb);
  return { kind, blacklist: bl.blacklist, warnings: bl.warnings };
}

/** Open an .xlsx buffer; a corrupt or non-xlsx file becomes ImportFileError. */
export async function parseWorkbookBuffer(buffer: ArrayBuffer | Buffer): Promise<ImportPayload> {
  let wb: Workbook;
  try {
    wb = await loadWorkbook(buffer);
  } catch {
    throw new ImportFileError("The file could not be opened as an Excel workbook (.xlsx).");
  }
  return parseWorkbook(wb);
}

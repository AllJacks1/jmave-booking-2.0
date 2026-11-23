/**
 * Blacklist from the DMS workbook, tab `Blacklisted Client ` (trailing
 * space). B names (several split by `/`, or `FB: …`), C contact no.,
 * D particular (reason), E–F notes.
 */
import { phonesFromCell } from "@/lib/phone";
import type { BlacklistImport, ImportWarning } from "./types";
import { cellValue, DMS_TABS, lastDataRow, text, type Workbook } from "./workbook";

export function parseBlacklist(wb: Workbook): { blacklist: BlacklistImport[]; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const blacklist: BlacklistImport[] = [];
  const ws = wb.getWorksheet(DMS_TABS.blacklist);
  if (!ws) {
    warnings.push({ section: "blacklist", level: "warning", message: `Tab "${DMS_TABS.blacklist}" not found.` });
    return { blacklist, warnings };
  }
  const last = lastDataRow(ws);
  for (let r = 2; r <= last; r++) {
    const namesRaw = text(cellValue(ws, `B${r}`));
    const phoneCell = cellValue(ws, `C${r}`);
    const reason = ["D", "E", "F"]
      .map((c) => text(cellValue(ws, `${c}${r}`)))
      .filter((s): s is string => !!s)
      .join(" — ");
    if (!namesRaw && phoneCell === null) continue;
    if (!namesRaw) {
      warnings.push({ section: "blacklist", level: "warning", tab: ws.name, row: r, message: "No name; row skipped." });
      continue;
    }
    let fbName: string | null = null;
    const names: string[] = [];
    for (const part of namesRaw.split("/").map((s) => s.trim()).filter(Boolean)) {
      const fb = /^fb\s*:\s*(.+)$/i.exec(part);
      if (fb) fbName = fb[1].trim();
      else names.push(part);
    }
    const phones = phonesFromCell(phoneCell);
    if (phoneCell !== null && phones.length === 0) {
      warnings.push({ section: "blacklist", level: "warning", tab: ws.name, row: r, message: `Contact "${text(phoneCell)}" is not a valid PH number.` });
    }
    const fullName = names[0] ?? fbName!;
    blacklist.push({
      row: r,
      fullName,
      aliases: names.slice(1),
      fbName,
      phone: phones[0] ?? null,
      reason: reason || "Blacklisted (imported, no reason given)",
    });
  }
  return { blacklist, warnings };
}

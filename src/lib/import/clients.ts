/**
 * Clients from `Rental Log` and `WD Rental Log` (import-map.md "Clients"),
 * and QTN sequences from their column A.
 *
 * Rows are grouped into one client when they share a phone or an email
 * (match key: phone, else email, else exact name + FB name). For each
 * field the latest non-empty value wins (by booking date, then row order).
 */
import { phonesFromCell } from "@/lib/phone";
import { manilaToUtc, excelFractionToTime, manilaDateKey, type DateKey } from "@/lib/time";
import type { ClientImport, ImportWarning, SequenceImport } from "./types";
import { BOOKING_TABS, cellValue, dateFromCell, lastDataRow, text, timeFraction, type CellValue, type Workbook } from "./workbook";

const BLANKISH = /^(n\/?a|none|na|nil|null|-+|\.+|0|no|wala|x)$/i;
const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

type Row = {
  tab: string;
  tabIndex: number;
  row: number;
  sortKey: string;
  fullName: string | null;
  fbName: string | null;
  phones: string[];
  emails: string[];
  birthday: DateKey | null;
  address: string | null;
  altContactName: string | null;
  altContactPhone: string | null;
  clientType: "individual" | "corporate" | null;
  otherContacts: string[];
  status: string | null;
  travelAt: Date | null;
};

function cleanText(v: CellValue): string | null {
  const t = text(v);
  return t && !BLANKISH.test(t) ? t : null;
}

function emailsFromCell(v: CellValue, warn: (m: string) => void): string[] {
  const t = text(v);
  if (!t || BLANKISH.test(t)) return [];
  const out: string[] = [];
  const joined = t.toLowerCase().replace(/\s*@\s*/g, "@").replace(/\s*\.\s*/g, ".");
  for (const part of joined.split(/[\s/,;]+/)) {
    const e = part.replace(/^mailto:/, "").replace(/\.+$/, "");
    if (!e) continue;
    if (EMAIL_RE.test(e)) {
      if (!out.includes(e)) out.push(e);
    } else if (e.includes("@")) {
      warn(`Email "${e}" is not valid; ignored.`);
    }
  }
  return out;
}

function phonesWithWarning(v: CellValue, warn: (m: string) => void, other?: string[]): string[] {
  const phones = phonesFromCell(v);
  if (phones.length === 0) {
    const t = typeof v === "number" ? v.toFixed(0) : text(v);
    if (t && /\d{5,}/.test(t.replace(/\D/g, ""))) {
      warn(`Phone "${t}" is not a valid PH number; kept in notes.`);
      other?.push(t);
    }
  }
  return phones;
}

function birthdayFromCell(v: CellValue, warn: (m: string) => void): DateKey | null {
  if (v === null) return null;
  const t = text(v);
  if (t && BLANKISH.test(t)) return null;
  const key = dateFromCell(v);
  if (!key) {
    warn(`Birthday "${t}" could not be read; left blank.`);
    return null;
  }
  const year = Number(key.slice(0, 4));
  if (year < 1900 || key >= manilaDateKey(new Date())) {
    warn(`Birthday "${t}" is out of range; left blank.`);
    return null;
  }
  return key;
}

function travelInstant(dateCell: CellValue, timeCell: CellValue): Date | null {
  const key = dateFromCell(dateCell);
  if (!key) return null;
  const frac = timeFraction(timeCell);
  return manilaToUtc(key, frac === null ? "00:00" : (excelFractionToTime(frac) ?? "00:00"));
}

/** Union-find over row indexes. */
class Groups {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

export function parseClients(wb: Workbook): {
  clients: ClientImport[];
  sequences: SequenceImport[];
  warnings: ImportWarning[];
} {
  const warnings: ImportWarning[] = [];
  const rows: Row[] = [];
  const seqMax = new Map<string, { value: number; source: string }>();

  const readTab = (tabName: string, tabIndex: number, layout: "sd" | "wd") => {
    const ws = wb.getWorksheet(tabName);
    if (!ws) {
      warnings.push({ section: "clients", level: "warning", tab: tabName, message: "Tab not found; skipped." });
      return;
    }
    const last = lastDataRow(ws);
    const seqRe = layout === "sd" ? /^QTN-(\d{4})-(\d+)$/i : /^QTN-WD(\d{4})-(\d+)$/i;
    for (let r = 2; r <= last; r++) {
      const warn = (message: string) => warnings.push({ section: "clients", level: "warning", tab: tabName, row: r, message });
      const c = (letter: string) => cellValue(ws, `${letter}${r}`);

      // Sequence (column A)
      const qtn = text(c("A"));
      if (qtn) {
        const m = seqRe.exec(qtn.replace(/\s+/g, ""));
        if (m) {
          const key = layout === "sd" ? `QTN-${m[1]}` : `QTN-WD${m[1]}`;
          const n = Number(m[2]);
          if (n > (seqMax.get(key)?.value ?? 0)) seqMax.set(key, { value: n, source: `${tabName}!A${r}` });
        } else {
          warnings.push({ section: "sequences", level: "warning", tab: tabName, row: r, message: `Quotation number "${qtn}" not in the expected format.` });
        }
      }

      const nameCell = layout === "sd" ? c("G") : c("H");
      const fullName = cleanText(nameCell);
      const fbName = cleanText(layout === "sd" ? c("H") : c("I"));
      const phoneCell = layout === "sd" ? c("AF") : c("G");
      const otherContacts: string[] = [];
      const phones = phonesWithWarning(phoneCell, warn, otherContacts);
      const emails = layout === "sd" ? emailsFromCell(c("AG"), warn) : [];
      if (!fullName && !fbName && phones.length === 0 && emails.length === 0) continue; // no client on this row
      if (!fullName) {
        warn("No client name; row skipped.");
        continue;
      }
      const booking = dateFromCell(c("B"));
      const travelAt = travelInstant(c("C"), layout === "sd" ? c("E") : c("D"));
      const typeRaw = layout === "wd" ? text(c("R"))?.toLowerCase() : null;
      rows.push({
        tab: tabName,
        tabIndex,
        row: r,
        sortKey: `${booking ?? (travelAt ? manilaDateKey(travelAt) : "0000-00-00")}|${tabIndex}|${String(r).padStart(6, "0")}`,
        fullName,
        fbName,
        phones,
        emails,
        birthday: layout === "sd" ? birthdayFromCell(c("AH"), warn) : null,
        address: layout === "sd" ? cleanText(c("AI")) : null,
        altContactName: layout === "sd" ? cleanText(c("AJ")) : null,
        altContactPhone: layout === "sd" ? (phonesWithWarning(c("AK"), warn)[0] ?? null) : null,
        clientType: typeRaw ? (typeRaw.startsWith("corp") ? "corporate" : "individual") : null,
        otherContacts,
        status: layout === "sd" ? (text(c("AM"))?.toUpperCase() ?? null) : null,
        travelAt,
      });
    }
  };

  readTab(BOOKING_TABS.rentalLog, 0, "sd");
  readTab(BOOKING_TABS.wdRentalLog, 1, "wd");

  // Group rows sharing a phone or an email; rows with neither by exact name + FB name.
  const groups = new Groups(rows.length);
  const firstByKey = new Map<string, number>();
  rows.forEach((row, i) => {
    const keys = [
      ...row.phones.map((p) => `phone:${p}`),
      ...row.emails.map((e) => `email:${e}`),
    ];
    if (keys.length === 0) keys.push(`name:${row.fullName!.toLowerCase()}|${(row.fbName ?? "").toLowerCase()}`);
    for (const k of keys) {
      const seen = firstByKey.get(k);
      if (seen === undefined) firstByKey.set(k, i);
      else groups.union(seen, i);
    }
  });

  // A row with no phone or email joins a contact group when exactly one
  // contact group has a row with the same full name + FB name.
  const nameKeyOf = (row: Row) => `${row.fullName!.toLowerCase()}|${(row.fbName ?? "").toLowerCase()}`;
  const contactRootsByName = new Map<string, Set<number>>();
  rows.forEach((row, i) => {
    if (row.phones.length === 0 && row.emails.length === 0) return;
    const k = nameKeyOf(row);
    (contactRootsByName.get(k) ?? contactRootsByName.set(k, new Set()).get(k)!).add(groups.find(i));
  });
  let mergedByName = 0;
  rows.forEach((row, i) => {
    if (row.phones.length || row.emails.length) return;
    const roots = contactRootsByName.get(nameKeyOf(row));
    if (roots && roots.size === 1) {
      const target = [...roots][0];
      if (groups.find(i) !== groups.find(target)) {
        groups.union(i, target);
        mergedByName += 1;
      }
    }
  });
  if (mergedByName) {
    warnings.push({
      section: "clients",
      level: "info",
      message: `${mergedByName} log row(s) without phone or email were joined to the one client with the same name and FB name.`,
    });
  }

  const byRoot = new Map<number, Row[]>();
  rows.forEach((row, i) => {
    const root = groups.find(i);
    (byRoot.get(root) ?? byRoot.set(root, []).get(root)!).push(row);
  });

  const clients: ClientImport[] = [];
  for (const members of byRoot.values()) {
    members.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
    const latest = <K extends keyof Row>(k: K): Row[K] | null => {
      for (let i = members.length - 1; i >= 0; i--) {
        const v = members[i][k];
        if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) return v;
      }
      return null;
    };
    const phones: string[] = [];
    const emails: string[] = [];
    const otherContacts: string[] = [];
    for (let i = members.length - 1; i >= 0; i--) {
      for (const p of members[i].phones) if (!phones.includes(p)) phones.push(p);
      for (const e of members[i].emails) if (!emails.includes(e)) emails.push(e);
      for (const o of members[i].otherContacts) if (!otherContacts.includes(o)) otherContacts.push(o);
    }
    const fullName = latest("fullName")!;
    const fbName = latest("fbName");
    const rented = members
      .filter((m) => (m.status === "BOOKED" || m.status === "COMPLETED") && m.travelAt)
      .map((m) => m.travelAt!.getTime());
    const key = phones[0]
      ? `phone:${phones[0]}`
      : emails[0]
        ? `email:${emails[0]}`
        : `name:${fullName.toLowerCase()}|${(fbName ?? "").toLowerCase()}`;
    if (!phones[0] && !emails[0]) {
      warnings.push({
        section: "clients",
        level: "warning",
        tab: members[0].tab,
        row: members[0].row,
        message: `"${fullName}" has no phone or email; matched by name${fbName ? " + FB name" : ""} only.`,
      });
    }
    clients.push({
      key,
      fullName,
      fbName,
      phone: phones[0] ?? null,
      phones,
      email: emails[0] ?? null,
      emails,
      birthday: latest("birthday"),
      address: latest("address"),
      altContactName: latest("altContactName"),
      altContactPhone: latest("altContactPhone"),
      clientType: latest("clientType") ?? "individual",
      otherContacts,
      firstRentalAt: rented.length ? new Date(Math.min(...rented)).toISOString() : null,
      rowCount: members.length,
      rows: members.map((m) => ({ tab: m.tab, row: m.row })),
    });
  }
  clients.sort((a, b) => a.fullName.localeCompare(b.fullName));

  const sequences: SequenceImport[] = [...seqMax.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({ key, value: v.value, source: v.source }));

  return { clients, sequences, warnings };
}

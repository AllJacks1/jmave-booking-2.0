/**
 * Matching imported client groups to `clients` rows (shared by the client
 * and booking-history imports): phone, else email, else name + FB name.
 */
import type { ClientRow } from "@/db/schema";
import type { ClientImport } from "./types";

export type ClientIndex = {
  byPhone: Map<string, ClientRow>;
  byEmail: Map<string, ClientRow>;
  byName: Map<string, ClientRow[]>;
};

export function indexClients(rows: ClientRow[]): ClientIndex {
  const idx: ClientIndex = { byPhone: new Map(), byEmail: new Map(), byName: new Map() };
  for (const c of rows) addToIndex(idx, c);
  return idx;
}

export function addToIndex(idx: ClientIndex, c: ClientRow) {
  if (c.phone && !idx.byPhone.has(c.phone)) idx.byPhone.set(c.phone, c);
  if (c.email && !idx.byEmail.has(c.email.toLowerCase())) idx.byEmail.set(c.email.toLowerCase(), c);
  const k = c.fullName.toLowerCase();
  idx.byName.set(k, [...(idx.byName.get(k) ?? []), c]);
}

export function nameKey(fullName: string, fbName: string | null) {
  return `${fullName.toLowerCase()}|${(fbName ?? "").toLowerCase()}`;
}

/** Name-only match: prefer a client without phone/email; else the only client with that name + FB name. */
export function matchByName(idx: ClientIndex, c: ClientImport): ClientRow | undefined {
  const same = (idx.byName.get(c.fullName.toLowerCase()) ?? []).filter(
    (x) => nameKey(x.fullName, x.fbName) === nameKey(c.fullName, c.fbName),
  );
  return same.find((x) => !x.phone && !x.email) ?? (same.length === 1 ? same[0] : undefined);
}


/** The existing client an imported group belongs to (same rule as the client import). */
export function matchClient(idx: ClientIndex, c: ClientImport): ClientRow | undefined {
  return (
    c.phones.map((p) => idx.byPhone.get(p)).find(Boolean) ??
    c.emails.map((e) => idx.byEmail.get(e)).find(Boolean) ??
    (!c.phone && !c.email ? matchByName(idx, c) : undefined)
  );
}

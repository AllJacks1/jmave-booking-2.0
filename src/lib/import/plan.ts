/**
 * Turns a parsed payload into a plan against the current DB: what is new,
 * changed or unchanged per section (the Preview), and the writes that make
 * it so (the Commit). The same function runs for both, so the commit
 * re-checks inside its transaction and re-runs report 0 new / 0 changed.
 *
 * Imports never erase: a blank workbook value leaves the DB value alone.
 */
import { eq, isNotNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { clients, drivers, numberSequences, quotations, rateCards, vehicles, type ClientRow, type RateCardRow, type VehicleRow } from "@/db/schema";
import { withAudit } from "@/lib/audit";
import { addToIndex, indexClients, matchClient, type ClientIndex } from "./client-match";
import { activeHoldsByVehicle, bufferMinutesOrDefault, planDrivers, planHistory } from "./history-plan";
import { diffRateCards } from "@/lib/pricing/rate-card";
import type {
  BlacklistImport,
  ClientImport,
  ImportPayload,
  ImportSummary,
  ImportWarning,
  PreviewItem,
  SectionKey,
  SectionSummary,
  SequenceImport,
  VehicleImport,
} from "./types";

type Op = (tx: DbOrTx, actor: { id: string }) => Promise<void>;

export type ImportPlan = { summary: ImportSummary; ops: Op[] };
export type { Op };

/** Preview items kept per section (the counts always cover everything). */
const MAX_ITEMS = 5000;

function newSection(section: SectionKey, warnings: ImportWarning[]): SectionSummary {
  return {
    section,
    counts: { new: 0, changed: 0, unchanged: 0, skipped: 0 },
    warnings: warnings.filter((w) => w.section === section),
    items: [],
  };
}

function push(s: SectionSummary, item: PreviewItem) {
  s.counts[item.action] += 1;
  if (s.items.length < MAX_ITEMS) s.items.push(item);
}

/** Fields where the import value is non-blank and differs from the DB. */
function fieldChanges<T extends Record<string, unknown>>(
  current: T,
  incoming: Partial<T>,
): { changes: Record<string, [unknown, unknown]>; patch: Partial<T> } {
  const changes: Record<string, [unknown, unknown]> = {};
  const patch: Partial<T> = {};
  for (const [k, v] of Object.entries(incoming) as [keyof T & string, unknown][]) {
    if (v === null || v === undefined || v === "") continue;
    const cur = current[k];
    const same = cur instanceof Date && v instanceof Date ? cur.getTime() === v.getTime() : cur === v;
    if (!same) {
      changes[k] = [cur instanceof Date ? cur.toISOString() : cur, v instanceof Date ? v.toISOString() : v];
      (patch as Record<string, unknown>)[k] = v;
    }
  }
  return { changes, patch };
}

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

function planFleet(items: VehicleImport[], existing: VehicleRow[], s: SectionSummary, ops: Op[]) {
  const byPlate = new Map(existing.filter((v) => v.plate).map((v) => [v.plate!, v]));
  const byName = new Map(existing.map((v) => [v.displayName.toLowerCase(), v]));
  const used = new Set<string>();

  for (const v of items) {
    const match =
      (v.plate ? byPlate.get(v.plate) : undefined) ??
      (() => {
        const n = byName.get(v.displayName.toLowerCase());
        return n && (!n.plate || !v.plate || n.plate === v.plate) ? n : undefined;
      })();
    const label = v.plate ? `${v.displayName} (${v.plate})` : v.displayName;
    const incoming: Record<string, unknown> = {
      displayName: v.displayName,
      plate: v.plate,
      make: v.make,
      model: v.model,
      year: v.year,
      color: v.color,
      transmission: v.transmission,
      chassisNo: v.chassisNo,
      engineNo: v.engineNo,
      engine: v.engine,
      bodyType: v.bodyType,
      fuelType: v.fuelType,
      tankCapacityL: v.tankCapacityL,
      operatorName: v.operatorName,
      ownership: v.operatorName ? "operator" : null,
    };
    if (!match) {
      const values = { ...incoming, ownership: v.operatorName ? ("operator" as const) : ("owned" as const), sortOrder: v.sortOrder, displayName: v.displayName };
      push(s, { action: "new", label, changes: Object.fromEntries(Object.entries(values).filter(([, x]) => x !== null).map(([k, x]) => [k, [null, x]])) });
      ops.push(async (tx) => {
        await tx.insert(vehicles).values(values as typeof vehicles.$inferInsert);
      });
      continue;
    }
    if (used.has(match.id)) {
      push(s, { action: "skipped", label, detail: "Matches the same vehicle as an earlier row." });
      continue;
    }
    used.add(match.id);
    const { changes, patch } = fieldChanges(match as unknown as Record<string, unknown>, incoming);
    if (Object.keys(changes).length === 0) {
      push(s, { action: "unchanged", label });
    } else {
      push(s, { action: "changed", label, changes });
      ops.push(async (tx) => {
        await tx.update(vehicles).set(patch as Partial<typeof vehicles.$inferInsert>).where(eq(vehicles.id, match.id));
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Rate cards
// ---------------------------------------------------------------------------

function planRateCards(
  items: Extract<ImportPayload, { kind: "booking_workbook" }>["rateCards"],
  existing: RateCardRow[],
  s: SectionSummary,
  ops: Op[],
) {
  const byVersion = new Map(existing.map((c) => [c.version, c]));
  let activeExists = existing.some((c) => c.status === "active");

  for (const card of items) {
    const label = `v${card.version} — ${card.name.replace(/^v\d+ — /, "")}`;
    const cur = byVersion.get(card.version);
    if (!cur) {
      const status = card.status === "active" && activeExists ? "draft" : card.status;
      if (status !== card.status) {
        s.warnings.push({ section: "rate_cards", level: "warning", message: `${label}: another card is already active, so this one is imported as a draft.` });
      }
      if (status === "active") activeExists = true;
      push(s, { action: "new", label, detail: `Status: ${status}` });
      ops.push(async (tx, actor) => {
        const [row] = await tx
          .insert(rateCards)
          .values({
            version: card.version,
            name: card.name,
            status,
            data: card.data,
            source: card.source,
            effectiveFrom: status === "active" ? new Date() : null,
            createdBy: actor.id,
          })
          .returning();
        await withAudit(actor, status === "active" ? "rate_card.import_activate" : "rate_card.import", "rate_card", row.id, null, { version: row.version, status: row.status, source: row.source }, tx);
      });
      continue;
    }
    const diffs = diffRateCards(cur.data, card.data);
    if (diffs.length === 0) {
      push(s, { action: "unchanged", label });
      continue;
    }
    if (cur.status === "draft" && cur.source === card.source) {
      push(s, {
        action: "changed",
        label,
        changes: Object.fromEntries(diffs.slice(0, 200).map((d) => [d.path, [d.before, d.after]])),
        detail: `${diffs.length} values differ (draft is updated).`,
      });
      ops.push(async (tx, actor) => {
        await tx.update(rateCards).set({ data: card.data }).where(eq(rateCards.id, cur.id));
        await withAudit(actor, "rate_card.import_update", "rate_card", cur.id, { data: cur.data }, { data: card.data }, tx);
      });
    } else {
      push(s, {
        action: "skipped",
        label,
        detail: `v${card.version} already exists (${cur.status}) and differs in ${diffs.length} values; not overwritten. Edit a draft instead.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

function otherContactsNote(c: ClientImport): string | null {
  return c.otherContacts.length ? `Imported contact (not a PH number): ${c.otherContacts.join(" / ")}` : null;
}

function planClients(items: ClientImport[], idx: ClientIndex, s: SectionSummary, ops: Op[]) {
  const used = new Set<string>();
  for (const c of items) {
    const match = matchClient(idx, c);
    const label = c.fullName;
    const note = otherContactsNote(c);
    if (!match) {
      const values = {
        fullName: c.fullName,
        fbName: c.fbName,
        phone: c.phone,
        email: c.email,
        birthday: c.birthday,
        address: c.address,
        altContactName: c.altContactName,
        altContactPhone: c.altContactPhone,
        clientType: c.clientType,
        firstRentalAt: c.firstRentalAt ? new Date(c.firstRentalAt) : null,
        source: "import",
        notes: note,
      };
      push(s, {
        action: "new",
        label,
        changes: Object.fromEntries(Object.entries(values).filter(([, x]) => x !== null).map(([k, x]) => [k, [null, x instanceof Date ? x.toISOString() : x]])),
        detail: `${c.rowCount} log row(s)`,
      });
      ops.push(async (tx) => {
        await tx.insert(clients).values(values);
      });
      continue;
    }
    if (used.has(match.id)) {
      push(s, { action: "skipped", label, detail: "Matches the same client as an earlier group (shared phone or email)." });
      continue;
    }
    used.add(match.id);
    const incoming: Record<string, unknown> = {
      fullName: c.fullName,
      fbName: c.fbName,
      phone: match.phone ? null : c.phone,
      email: match.email ? null : c.email,
      birthday: c.birthday,
      address: c.address,
      altContactName: c.altContactName,
      altContactPhone: c.altContactPhone,
      clientType: c.clientType === "corporate" ? "corporate" : null,
      firstRentalAt:
        c.firstRentalAt && (!match.firstRentalAt || new Date(c.firstRentalAt) < match.firstRentalAt)
          ? new Date(c.firstRentalAt)
          : null,
      notes: note && !(match.notes ?? "").includes(note) ? [match.notes, note].filter(Boolean).join("\n") : null,
    };
    const { changes, patch } = fieldChanges(match as unknown as Record<string, unknown>, incoming);
    if (Object.keys(changes).length === 0) push(s, { action: "unchanged", label });
    else {
      push(s, { action: "changed", label, changes });
      ops.push(async (tx) => {
        await tx.update(clients).set(patch as Partial<typeof clients.$inferInsert>).where(eq(clients.id, match.id));
      });
    }
  }
}

function planBlacklist(items: BlacklistImport[], idx: ClientIndex, s: SectionSummary, ops: Op[]) {
  for (const b of items) {
    const label = b.fullName;
    let match: ClientRow | undefined = b.phone ? idx.byPhone.get(b.phone) : undefined;
    if (!match) {
      const names = [b.fullName, ...b.aliases].map((n) => n.toLowerCase());
      const candidates = new Map<string, ClientRow>();
      for (const n of names) for (const c of idx.byName.get(n) ?? []) candidates.set(c.id, c);
      if (b.fbName) {
        for (const list of idx.byName.values()) {
          for (const c of list) if (c.fbName && c.fbName.toLowerCase() === b.fbName.toLowerCase()) candidates.set(c.id, c);
        }
      }
      if (candidates.size > 1) {
        s.warnings.push({
          section: "blacklist",
          level: "warning",
          row: b.row,
          message: `"${b.fullName}" matches ${candidates.size} clients by name; none changed. Set the blacklist by hand.`,
        });
        push(s, { action: "skipped", label, detail: `${candidates.size} clients share this name.` });
        continue;
      }
      match = [...candidates.values()][0];
    }
    if (!match) {
      const values = {
        fullName: b.fullName,
        fbName: b.fbName,
        phone: b.phone,
        isBlacklisted: true,
        blacklistReason: b.reason,
        source: "blacklist_import",
        notes: b.aliases.length ? `Also known as: ${b.aliases.join(" / ")}` : null,
      };
      push(s, { action: "new", label, detail: "No matching client; a blacklisted client is created.", changes: { isBlacklisted: [null, true], blacklistReason: [null, b.reason] } });
      ops.push(async (tx, actor) => {
        const [row] = await tx.insert(clients).values(values).returning({ id: clients.id });
        await withAudit(actor, "client.blacklist_import", "client", row.id, null, { isBlacklisted: true, blacklistReason: b.reason }, tx);
      });
      // Later rows (and a re-run) match this client.
      addToIndex(idx, { ...values, id: `pending-${b.row}` } as unknown as ClientRow);
      continue;
    }
    if (match.id.startsWith("pending-")) {
      push(s, { action: "skipped", label, detail: "Same person as an earlier blacklist row." });
      continue;
    }
    const { changes, patch } = fieldChanges(
      match as unknown as Record<string, unknown>,
      { isBlacklisted: true, blacklistReason: b.reason } as Record<string, unknown>,
    );
    if (Object.keys(changes).length === 0) push(s, { action: "unchanged", label });
    else {
      push(s, { action: "changed", label, changes });
      ops.push(async (tx, actor) => {
        await tx.update(clients).set(patch).where(eq(clients.id, match.id));
        await withAudit(actor, "client.blacklist_import", "client", match.id, { isBlacklisted: match.isBlacklisted, blacklistReason: match.blacklistReason }, patch, tx);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Sequences: only ever raise.
// ---------------------------------------------------------------------------

function planSequences(items: SequenceImport[], existing: Map<string, number>, s: SectionSummary, ops: Op[]) {
  for (const seq of items) {
    const cur = existing.get(seq.key);
    const label = `${seq.key} → ${seq.value}`;
    if (cur === undefined) {
      push(s, { action: "new", label, detail: `Highest in ${seq.source}` });
    } else if (seq.value > cur) {
      push(s, { action: "changed", label, changes: { lastValue: [cur, seq.value] } });
    } else {
      push(s, { action: "unchanged", label, detail: cur > seq.value ? `Already at ${cur}; never lowered.` : undefined });
      continue;
    }
    ops.push(async (tx) => {
      await tx
        .insert(numberSequences)
        .values({ key: seq.key, lastValue: seq.value })
        .onConflictDoUpdate({
          target: numberSequences.key,
          set: { lastValue: sql`greatest(${numberSequences.lastValue}, ${seq.value})` },
        });
    });
  }
}

// ---------------------------------------------------------------------------

export async function planImport(payload: ImportPayload, db: DbOrTx): Promise<ImportPlan> {
  const ops: Op[] = [];
  const sections: SectionSummary[] = [];

  if (payload.kind === "booking_workbook") {
    const [vehicleRows, cardRows, clientRows, seqRows] = await Promise.all([
      db.select().from(vehicles),
      db.select().from(rateCards),
      db.select().from(clients),
      db.select().from(numberSequences),
    ]);
    const fleet = newSection("fleet", payload.warnings);
    planFleet(payload.fleet, vehicleRows, fleet, ops);
    const cards = newSection("rate_cards", payload.warnings);
    planRateCards(payload.rateCards, cardRows, cards, ops);
    const cl = newSection("clients", payload.warnings);
    planClients(payload.clients, indexClients(clientRows), cl, ops);
    const seq = newSection("sequences", payload.warnings);
    planSequences(payload.sequences, new Map(seqRows.map((r) => [r.key, r.lastValue])), seq, ops);
    sections.push(fleet, cards, cl, seq);
    if (payload.drivers) {
      const dr = newSection("drivers", payload.warnings);
      planDrivers(payload.drivers, await db.select({ name: drivers.name }).from(drivers), dr, ops);
      sections.push(dr);
    }
    if (payload.history) {
      const hist = newSection("history", payload.warnings);
      const [numbers, buffer, holds] = await Promise.all([
        db.select({ number: quotations.number }).from(quotations).where(isNotNull(quotations.number)),
        bufferMinutesOrDefault(db),
        activeHoldsByVehicle(db),
      ]);
      await planHistory(
        {
          history: payload.history,
          clients: payload.clients,
          fleet: payload.fleet,
          existingNumbers: new Set(numbers.map((n) => n.number!)),
          vehicles: vehicleRows,
          buffer,
          holds,
          now: new Date(),
        },
        hist,
        ops,
      );
      sections.push(hist);
    }
  } else {
    const clientRows = await db.select().from(clients);
    const bl = newSection("blacklist", payload.warnings);
    planBlacklist(payload.blacklist, indexClients(clientRows), bl, ops);
    sections.push(bl);
  }

  const totals = { new: 0, changed: 0, unchanged: 0, skipped: 0, warnings: 0 };
  for (const s of sections) {
    totals.new += s.counts.new;
    totals.changed += s.counts.changed;
    totals.unchanged += s.counts.unchanged;
    totals.skipped += s.counts.skipped;
    totals.warnings += s.warnings.filter((w) => w.level !== "info").length;
  }
  return { summary: { kind: payload.kind, sections, totals }, ops };
}

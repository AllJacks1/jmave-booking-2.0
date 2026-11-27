import { hasTestDb } from "./env";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { auditLog, clients, importRuns, numberSequences, rateCards, vehicles } from "@/db/schema";
import { createClient, searchClients, setBlacklist, updateClient } from "@/lib/clients/service";
import { createVehicle, updateVehicle } from "@/lib/fleet/service";
import { commitImport, previewUpload, validateUpload } from "@/lib/import/service";
import { EXPECTED_RATE_CARD_V1 } from "@/lib/pricing/expected-v1";
import { activateRateCard, addHoliday, createDraft, getActiveRateCard, listHolidays, removeHoliday, updateDraft } from "@/lib/rates/service";
import { bookingWorkbook, dmsWorkbook } from "../fixtures/workbooks";
import { makeUser, truncateAll } from "./helpers";

const BOOKING = "Self-Driven and With Driver.xlsx";
const DMS = "2026 Daily Movement Sheet.xlsx";

async function importFile(actor: Awaited<ReturnType<typeof makeUser>>, name: string, buf: Buffer) {
  const preview = await previewUpload(actor, name, new Uint8Array(buf));
  if (!preview.ok) throw new Error(preview.error);
  const commit = await commitImport(actor, { runId: preview.runId });
  if (!commit.ok) throw new Error(commit.error);
  return { preview: preview.summary, totals: commit.data.totals };
}

describe.skipIf(!hasTestDb)("Phase 1b against the database", () => {
  beforeEach(truncateAll);
  afterAll(closeDb);

  describe("import", () => {
    it("booking workbook: preview, commit, and a re-run changes nothing", async () => {
      const sa = await makeUser("super_admin");
      const buf = await bookingWorkbook();
      const first = await importFile(sa, BOOKING, buf);
      const sec = Object.fromEntries(first.preview.sections.map((s) => [s.section, s.counts]));
      expect(sec.fleet).toMatchObject({ new: 4, changed: 0 });
      expect(sec.rate_cards).toMatchObject({ new: 2 });
      expect(sec.clients).toMatchObject({ new: 5 });
      expect(sec.sequences).toMatchObject({ new: 3 });

      const active = await getActiveRateCard();
      expect(active?.version).toBe(1);
      expect(active?.data).toEqual(EXPECTED_RATE_CARD_V1);
      const [v2] = await db.select().from(rateCards).where(eq(rateCards.version, 2));
      expect(v2.status).toBe("draft");

      const seqs = Object.fromEntries((await db.select().from(numberSequences)).map((s) => [s.key, s.lastValue]));
      expect(seqs).toEqual({ "QTN-2025": 777, "QTN-2026": 109, "QTN-WD2026": 12 });

      const [bigcar] = await db.select().from(vehicles).where(eq(vehicles.plate, "TST 2002"));
      expect(bigcar).toMatchObject({ ownership: "operator", operatorName: "Operator Person", bodyType: "suv" });

      const [ana] = await db.select().from(clients).where(eq(clients.phone, "+639170000001"));
      expect(ana).toMatchObject({ fullName: "Ana Testcase", address: "New Street 2", source: "import", birthday: "1990-03-14" });
      expect(ana.firstRentalAt?.toISOString()).toBe("2026-02-03T04:00:00.000Z");
      const [ben] = await db.select().from(clients).where(eq(clients.email, "ben@example.test"));
      expect(ben.notes).toContain("44 20 7946 0000");

      const again = await importFile(sa, BOOKING, buf);
      expect(again.totals).toMatchObject({ new: 0, changed: 0 });

      const runs = await db.select().from(importRuns);
      expect(runs).toHaveLength(2);
      expect(runs.every((r) => r.status === "committed" && r.payload === null)).toBe(true);
      const audits = await db.select().from(auditLog).where(eq(auditLog.action, "import.commit"));
      expect(audits).toHaveLength(2);
    });

    it("sequences are never lowered", async () => {
      const sa = await makeUser("super_admin");
      await db.insert(numberSequences).values({ key: "QTN-2026", lastValue: 2000 });
      await importFile(sa, BOOKING, await bookingWorkbook());
      const [s] = await db.select().from(numberSequences).where(eq(numberSequences.key, "QTN-2026"));
      expect(s.lastValue).toBe(2000);
    });

    it("an active card that differs is not overwritten", async () => {
      const sa = await makeUser("super_admin");
      await importFile(sa, BOOKING, await bookingWorkbook());
      const { preview } = await importFile(sa, BOOKING, await bookingWorkbook({ tamperCompact24h: 1600 }));
      const rc = preview.sections.find((s) => s.section === "rate_cards")!;
      expect(rc.counts.skipped).toBe(1);
      expect(rc.warnings.some((w) => w.level === "mismatch")).toBe(true);
      expect((await getActiveRateCard())?.data.selfDrive.daily.compact.h24).toBe(158000);
    });

    it("DMS blacklist: by phone, by name, unmatched creates a client; re-run changes nothing", async () => {
      const sa = await makeUser("super_admin");
      await importFile(sa, BOOKING, await bookingWorkbook());
      const buf = await dmsWorkbook();
      const first = await importFile(sa, DMS, buf);
      expect(first.totals).toMatchObject({ new: 1, changed: 2 });
      const bl = await db.select().from(clients).where(eq(clients.isBlacklisted, true));
      expect(bl.map((c) => c.fullName).sort()).toEqual(["Ana Testcase", "Cora Nocontact", "Zed Unknown"]);
      const zed = bl.find((c) => c.fullName === "Zed Unknown")!;
      expect(zed).toMatchObject({ source: "blacklist_import", fbName: "Zed FB", phone: "+639170000099" });
      expect(zed.notes).toContain("Zed U.");
      const again = await importFile(sa, DMS, buf);
      expect(again.totals).toMatchObject({ new: 0, changed: 0 });
    });

    it("only Super Admin can upload and commit", async () => {
      const admin = await makeUser("admin");
      const r = await previewUpload(admin, BOOKING, new Uint8Array(await bookingWorkbook()));
      expect(r).toMatchObject({ ok: false, status: 403 });
      const sa = await makeUser("super_admin");
      const p = await previewUpload(sa, DMS, new Uint8Array(await dmsWorkbook()));
      if (!p.ok) throw new Error("preview failed");
      expect(await commitImport(admin, { runId: p.runId })).toMatchObject({ ok: false, status: 403 });
      // A committed run cannot be committed twice.
      expect((await commitImport(sa, { runId: p.runId })).ok).toBe(true);
      expect(await commitImport(sa, { runId: p.runId })).toMatchObject({ ok: false, status: 409 });
    });

    it("rejects wrong files and records unreadable workbooks as failed", async () => {
      expect(validateUpload("a.csv", new Uint8Array([0x50, 0x4b, 3, 4]))).toMatch(/xlsx/);
      expect(validateUpload("a.xlsx", new Uint8Array([1, 2, 3, 4]))).toMatch(/not a valid/);
      expect(validateUpload("a.xlsx", new Uint8Array(41 * 1024 * 1024))).toMatch(/larger/);
      const sa = await makeUser("super_admin");
      // Phase 5: a zip that is not a workbook is refused before parsing (no run stored).
      const notWorkbook = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
      expect(await previewUpload(sa, "broken.xlsx", notWorkbook)).toMatchObject({ ok: false, status: 400 });
      expect(await db.select().from(importRuns)).toHaveLength(0);
      // A workbook whose directory is fine but whose contents are corrupt is stored as failed.
      const corrupt = new Uint8Array(await bookingWorkbook());
      corrupt.fill(0xff, 100, Math.min(corrupt.length - 2000, 6000));
      const r = await previewUpload(sa, "corrupt.xlsx", corrupt);
      expect(r).toMatchObject({ ok: false, status: 400 });
      const [run] = await db.select().from(importRuns);
      expect(run.status).toBe("failed");
    });
  });

  describe("rate cards and holidays", () => {
    it("draft → edit → activate archives the previous card, with audit rows", async () => {
      const sa = await makeUser("super_admin");
      await importFile(sa, BOOKING, await bookingWorkbook());
      const v1 = (await getActiveRateCard())!;
      const draft = await createDraft(sa, { fromId: v1.id, name: "December rates" });
      if (!draft.ok) throw new Error(draft.error);
      expect(draft.data.version).toBe(3);

      const data = structuredClone(v1.data);
      data.selfDrive.daily.compact.h24 = 165000;
      const upd = await updateDraft(sa, { id: draft.data.id, name: "December rates", notes: "", data });
      expect(upd).toMatchObject({ ok: true, data: { changed: 1 } });

      const bad = structuredClone(data) as unknown as { selfDrive: { daily: { compact: { h24: number } } } };
      bad.selfDrive.daily.compact.h24 = -5;
      expect(await updateDraft(sa, { id: draft.data.id, name: "x", notes: "", data: bad as never })).toMatchObject({ ok: false, status: 400 });

      expect(await updateDraft(sa, { id: v1.id, name: "x", notes: "", data })).toMatchObject({ ok: false, status: 409 });

      const act = await activateRateCard(sa, { id: draft.data.id });
      expect(act.ok).toBe(true);
      const cards = Object.fromEntries((await db.select().from(rateCards)).map((c) => [c.version, c.status]));
      expect(cards).toEqual({ 1: "archived", 2: "draft", 3: "active" });
      const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "rate_card.activate"));
      expect(audit.entityId).toBe(draft.data.id);
    });

    it("Admin is read-only on rates and holidays", async () => {
      const sa = await makeUser("super_admin");
      const admin = await makeUser("admin");
      await importFile(sa, BOOKING, await bookingWorkbook());
      const v1 = (await getActiveRateCard())!;
      expect(await createDraft(admin, { fromId: v1.id, name: "x" })).toMatchObject({ ok: false, status: 403 });
      expect(await activateRateCard(admin, { id: v1.id })).toMatchObject({ ok: false, status: 403 });
      expect(await addHoliday(admin, { date: "2026-12-25", name: "Christmas" })).toMatchObject({ ok: false, status: 403 });
    });

    it("holidays: add, duplicate 409, list by year, remove", async () => {
      const sa = await makeUser("super_admin");
      const a = await addHoliday(sa, { date: "2026-12-25", name: "Christmas Day" });
      if (!a.ok) throw new Error(a.error);
      expect(await addHoliday(sa, { date: "2026-12-25", name: "Again" })).toMatchObject({ ok: false, status: 409 });
      expect(await addHoliday(sa, { date: "2026-02-30", name: "Bad" })).toMatchObject({ ok: false, status: 400 });
      await addHoliday(sa, { date: "2027-01-01", name: "New Year" });
      expect((await listHolidays(2026)).map((h) => h.date)).toEqual(["2026-12-25"]);
      expect((await removeHoliday(sa, { id: a.data.id })).ok).toBe(true);
      expect(await listHolidays(2026)).toEqual([]);
    });
  });

  describe("clients", () => {
    const base = { fullName: "Faye Invented", phone: "0917 555 0101", email: "Faye@Example.test" };

    it("Sales creates and edits; duplicate phone is 409; Operations is 403", async () => {
      const sales = await makeUser("sales");
      const ops = await makeUser("operations");
      const r = await createClient(sales, base);
      if (!r.ok) throw new Error(r.error);
      const [row] = await db.select().from(clients).where(eq(clients.id, r.data.id));
      expect(row).toMatchObject({ phone: "+639175550101", email: "faye@example.test", source: "manual" });
      expect(await createClient(sales, { fullName: "Other", phone: "+639175550101" })).toMatchObject({ ok: false, status: 409 });
      expect(await createClient(ops, { fullName: "X" })).toMatchObject({ ok: false, status: 403 });
      expect(await updateClient(sales, { id: r.data.id, client: { ...base, address: "Somewhere 3" } })).toMatchObject({ ok: true });
      expect(await createClient(sales, { fullName: "Bad", phone: "12345" })).toMatchObject({ ok: false, status: 400 });
    });

    it("blacklist: Admin+ only, reason required, search shows the flag", async () => {
      const sales = await makeUser("sales");
      const admin = await makeUser("admin");
      const r = await createClient(sales, base);
      if (!r.ok) throw new Error(r.error);
      expect(await setBlacklist(sales, { id: r.data.id, blacklisted: true, reason: "x" })).toMatchObject({ ok: false, status: 403 });
      expect(await setBlacklist(admin, { id: r.data.id, blacklisted: true, reason: "" })).toMatchObject({ ok: false, status: 400 });
      expect((await setBlacklist(admin, { id: r.data.id, blacklisted: true, reason: "Unpaid" })).ok).toBe(true);

      for (const q of ["faye", "Invented", "0917 555", "+63917555", "5550101", "faye@example"]) {
        const found = await searchClients({ q, page: 1, blacklisted: "all" });
        expect(found.rows.map((x) => x.fullName), q).toEqual(["Faye Invented"]);
        expect(found.rows[0].isBlacklisted).toBe(true);
      }
      expect((await searchClients({ q: "", page: 1, blacklisted: "only" })).total).toBe(1);
      const audit = await db.select().from(auditLog).where(and(eq(auditLog.action, "client.blacklist"), eq(auditLog.entityId, r.data.id)));
      expect(audit).toHaveLength(1);
      expect((await setBlacklist(admin, { id: r.data.id, blacklisted: false })).ok).toBe(true);
    });
  });

  describe("fleet", () => {
    it("Super Admin edits; Admin is 403; plates are unique", async () => {
      const sa = await makeUser("super_admin");
      const admin = await makeUser("admin");
      const v = { displayName: "Test Car", plate: "tst  9009", bodyType: "sedan" as const };
      const r = await createVehicle(sa, v);
      if (!r.ok) throw new Error(r.error);
      const [row] = await db.select().from(vehicles).where(eq(vehicles.id, r.data.id));
      expect(row.plate).toBe("TST 9009");
      expect(await createVehicle(sa, { displayName: "Dup", plate: "TST 9009" })).toMatchObject({ ok: false, status: 409 });
      expect(await createVehicle(admin, { displayName: "X" })).toMatchObject({ ok: false, status: 403 });
      expect(await updateVehicle(admin, { id: r.data.id, vehicle: v })).toMatchObject({ ok: false, status: 403 });
      expect(await updateVehicle(sa, { id: r.data.id, vehicle: { ...v, ownership: "operator" } })).toMatchObject({ ok: false, status: 400 });
      expect(await updateVehicle(sa, { id: r.data.id, vehicle: { ...v, ownership: "hired", active: false } })).toMatchObject({ ok: true });
    });
  });
});

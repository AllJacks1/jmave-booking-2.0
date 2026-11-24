import { hasTestDb } from "./env";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { auditLog, clients, numberSequences, quotations, rateCards } from "@/db/schema";
import { nextNumber, nextQuotationNumber } from "@/lib/numbering";
import { EXPECTED_RATE_CARD_V1 } from "@/lib/pricing";
import { SD2_FORM, WD1_FORM } from "@/lib/quotes/fixtures";
import {
  getByShareToken,
  issueQuotation,
  listQuotations,
  markAccepted,
  markLost,
  previewPrice,
  reviseQuotation,
  saveDraft,
  saveQuick,
} from "@/lib/quotes/service";
import { quoteListSchema, type QuoteFormInput } from "@/lib/quotes/schema";
import { activateRateCard } from "@/lib/rates/service";
import { ensureDefaultSettings } from "@/lib/settings/service";
import { manilaToUtc } from "@/lib/time";
import { makeUser, truncateAll } from "./helpers";

type Actor = Awaited<ReturnType<typeof makeUser>>;

async function seed() {
  await ensureDefaultSettings();
  const [card] = await db
    .insert(rateCards)
    .values({ version: 1, name: "v1", status: "active", data: EXPECTED_RATE_CARD_V1, source: "test" })
    .returning();
  await db.insert(numberSequences).values([
    { key: "QTN-2026", lastValue: 928 },
    { key: "QTN-WD2026", lastValue: 118 },
  ]);
  const [client] = await db.insert(clients).values({ fullName: "Juan Dela Cruz", fbName: "Juan DC" }).returning();
  const [bad] = await db
    .insert(clients)
    .values({ fullName: "Bea Blocked", isBlacklisted: true, blacklistReason: "Unpaid damages" })
    .returning();
  return { card, client, bad };
}

function ok<T>(r: { ok: true; data: T } | { ok: false; error: string; status: number }): T {
  if (!r.ok) throw new Error(`${r.status} ${r.error}`);
  return r.data;
}

async function draftAndIssue(actor: Actor, form: QuoteFormInput, overrideReason = "") {
  const { id } = ok(await saveDraft(actor, { form }));
  return ok(await issueQuotation(actor, { id, form, overrideReason }));
}

describe.skipIf(!hasTestDb)("Phase 1c against the database", () => {
  beforeEach(truncateAll);
  afterAll(closeDb);

  describe("numbering", () => {
    it("20 parallel issues get 20 unique, gap-free numbers", async () => {
      await db.insert(numberSequences).values({ key: "QTN-2026", lastValue: 928 });
      const at = manilaToUtc("2026-11-24", "10:00");
      const numbers = await Promise.all(
        Array.from({ length: 20 }, () => db.transaction((tx) => nextQuotationNumber(tx, "self_drive", at))),
      );
      const values = numbers.map((n) => Number(n.split("-")[2])).sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(20);
      expect(values).toEqual(Array.from({ length: 20 }, (_, i) => 929 + i));
      const [seq] = await db.select().from(numberSequences).where(eq(numberSequences.key, "QTN-2026"));
      expect(seq.lastValue).toBe(948);
    });

    it("a rolled-back issue does not use a number", async () => {
      await expect(
        db.transaction(async (tx) => {
          await nextNumber(tx, "QTN-2026");
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      await db.transaction((tx) => nextNumber(tx, "QTN-2026")).then((n) => expect(n).toBe(1));
    });

    it("formats: With Driver key, Manila year, padding, past 999", async () => {
      const ny = manilaToUtc("2027-01-01", "00:30"); // still 2026 in UTC
      expect(await db.transaction((tx) => nextQuotationNumber(tx, "with_driver", ny))).toBe("QTN-WD2027-001");
      await db.insert(numberSequences).values({ key: "QTN-2028", lastValue: 999 });
      expect(await db.transaction((tx) => nextQuotationNumber(tx, "self_drive", manilaToUtc("2028-05-01")))).toBe("QTN-2028-1000");
    });
  });

  describe("formal quotation", () => {
    it("first issued Self-Drive quotation after import is QTN-2026-929; snapshot is frozen", async () => {
      const { client } = await seed();
      const sales = await makeUser("sales");
      const form = { ...SD2_FORM, clientId: client.id, repeat: "auto" as const };
      const { id, number } = await draftAndIssue(sales, form);
      expect(number).toBe("QTN-2026-929");
      const [row] = await db.select().from(quotations).where(eq(quotations.id, id));
      expect(row).toMatchObject({ status: "issued", totalCentavos: 219100, clientName: "Juan Dela Cruz" });
      expect(row.validUntil!.getTime() - row.issuedAt!.getTime()).toBe(24 * 3_600_000);
      expect(row.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

      // Issued is read-only.
      const again = await saveDraft(sales, { id, form });
      expect(again).toMatchObject({ ok: false, status: 409 });

      // WD sequence is separate.
      const wd = await draftAndIssue(sales, { ...WD1_FORM, clientId: client.id });
      expect(wd.number).toBe("QTN-WD2026-119");

      const audits = await db.select().from(auditLog).where(eq(auditLog.action, "quotation.issue"));
      expect(audits).toHaveLength(2);
    });

    it("changing the active rate card does not change an issued quotation", async () => {
      const { client } = await seed();
      const sa = await makeUser("super_admin");
      const { id } = await draftAndIssue(sa, { ...SD2_FORM, clientId: client.id });
      const before = (await db.select().from(quotations).where(eq(quotations.id, id)))[0];

      const data = structuredClone(EXPECTED_RATE_CARD_V1);
      data.selfDrive.daily.compact.h24 = 199_900;
      const [v2] = await db.insert(rateCards).values({ version: 2, name: "v2", status: "draft", data }).returning();
      ok(await activateRateCard(sa, { id: v2.id }));

      const after = (await db.select().from(quotations).where(eq(quotations.id, id)))[0];
      expect(after.result).toEqual(before.result);
      expect(after.totalCentavos).toBe(219100);
      expect(after.rateCardId).toBe(before.rateCardId);
      const shared = await getByShareToken(after.shareToken!);
      expect(shared?.doc.result.total).toBe(219100);

      // A new draft prices with the new card.
      const preview = ok(await previewPrice(sa, { ...SD2_FORM, clientId: client.id }));
      expect(preview.result?.lines[0].amount).toBe(199_900);
    });

    it("blacklisted client: Sales cannot issue; Admin can with a reason", async () => {
      const { bad } = await seed();
      const sales = await makeUser("sales");
      const admin = await makeUser("admin");
      const form = { ...SD2_FORM, clientId: bad.id };
      const { id } = ok(await saveDraft(sales, { form }));
      expect(await issueQuotation(sales, { id, form, overrideReason: "please" })).toMatchObject({ ok: false, status: 403 });
      expect(await issueQuotation(admin, { id, form })).toMatchObject({ ok: false, status: 400, fieldErrors: { overrideReason: ["Give a reason"] } });
      const r = ok(await issueQuotation(admin, { id, form, overrideReason: "Settled the balance" }));
      expect(r.number).toBe("QTN-2026-929");
      const [row] = await db.select().from(quotations).where(eq(quotations.id, id));
      expect(row).toMatchObject({ blacklistOverrideReason: "Settled the balance", blacklistOverrideBy: admin.id });
      // Sales' failed attempt did not use a number.
      const [seq] = await db.select().from(numberSequences).where(eq(numberSequences.key, "QTN-2026"));
      expect(seq.lastValue).toBe(929);
    });

    it("issuing needs a client", async () => {
      await seed();
      const sales = await makeUser("sales");
      const { id } = ok(await saveDraft(sales, { form: SD2_FORM }));
      expect(await issueQuotation(sales, { id, form: SD2_FORM })).toMatchObject({ ok: false, status: 400 });
    });

    it("revise: new draft, new number on issue, old one cancelled with a note", async () => {
      const { client } = await seed();
      const sales = await makeUser("sales");
      const form = { ...SD2_FORM, clientId: client.id };
      const first = await draftAndIssue(sales, form);
      const { id: draftId } = ok(await reviseQuotation(sales, { id: first.id }));
      // Revising twice returns the same open draft.
      expect(ok(await reviseQuotation(sales, { id: first.id })).id).toBe(draftId);
      const second = ok(await issueQuotation(sales, { id: draftId, form: { ...form, withCdw: true } }));
      expect(second.number).toBe("QTN-2026-930");
      const [old] = await db.select().from(quotations).where(eq(quotations.id, first.id));
      expect(old).toMatchObject({ status: "cancelled", statusNote: "Revised by QTN-2026-930" });
      expect(await getByShareToken(old.shareToken!)).not.toBeNull(); // page shows "contact us"
    });

    it("lost and accepted", async () => {
      const { client } = await seed();
      const sales = await makeUser("sales");
      const a = await draftAndIssue(sales, { ...SD2_FORM, clientId: client.id });
      const b = await draftAndIssue(sales, { ...SD2_FORM, clientId: client.id });
      ok(await markLost(sales, { id: a.id, reason: "Chose another company" }));
      ok(await markAccepted(sales, { id: b.id }));
      expect(await markAccepted(sales, { id: a.id })).toMatchObject({ ok: false, status: 409 });
      const [lost] = await db.select().from(quotations).where(eq(quotations.id, a.id));
      expect(lost).toMatchObject({ status: "lost", statusNote: "Chose another company" });

      // Expired is computed on read and cannot be accepted.
      const c = await draftAndIssue(sales, { ...SD2_FORM, clientId: client.id });
      await db.update(quotations).set({ validUntil: new Date(Date.now() - 1000) }).where(eq(quotations.id, c.id));
      expect(await markAccepted(sales, { id: c.id })).toMatchObject({ ok: false, status: 409 });
      const list = await listQuotations(quoteListSchema.parse({ status: "expired" }));
      expect(list.rows.map((r) => r.id)).toEqual([c.id]);
    });
  });

  describe("quick quotation", () => {
    it("saves as an estimate without a number", async () => {
      await seed();
      const sales = await makeUser("sales");
      const { id } = ok(await saveQuick(sales, { form: { ...SD2_FORM, clientName: "Walk-in" } }));
      const [row] = await db.select().from(quotations).where(eq(quotations.id, id));
      expect(row).toMatchObject({ kind: "quick", status: "issued", number: null, shareToken: null, totalCentavos: 219100, clientName: "Walk-in" });
      // Re-save updates the same row.
      ok(await saveQuick(sales, { id, form: { ...SD2_FORM, deliveryFee: 0 } }));
      const [updated] = await db.select().from(quotations).where(eq(quotations.id, id));
      expect(updated.totalCentavos).toBe(219100 - 49000);
    });

    it("bad input is a message, not a crash", async () => {
      await seed();
      const sales = await makeUser("sales");
      const p = ok(await previewPrice(sales, { ...SD2_FORM, endDate: "2026-11-22", endTime: "10:00" }));
      expect(p.error).toBe("Return must be after release.");
      expect(await saveQuick(sales, { form: { ...SD2_FORM, endDate: "2026-11-22", endTime: "10:00" } })).toMatchObject({ ok: false, status: 400 });
    });
  });

  describe("permissions", () => {
    it("Operations is refused every quotation action", async () => {
      const { client } = await seed();
      const ops = await makeUser("operations");
      const sales = await makeUser("sales");
      const issued = await draftAndIssue(sales, { ...SD2_FORM, clientId: client.id });
      const form = { ...SD2_FORM, clientId: client.id };
      for (const r of [
        await previewPrice(ops, form),
        await saveQuick(ops, { form }),
        await saveDraft(ops, { form }),
        await issueQuotation(ops, { id: issued.id, form }),
        await reviseQuotation(ops, { id: issued.id }),
        await markLost(ops, { id: issued.id, reason: "x" }),
        await markAccepted(ops, { id: issued.id }),
      ]) {
        expect(r).toMatchObject({ ok: false, status: 403 });
      }
    });
  });
});

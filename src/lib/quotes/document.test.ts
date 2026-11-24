import { describe, expect, it } from "vitest";
import { EXPECTED_RATE_CARD_V1 } from "@/lib/pricing";
import { manilaToUtc } from "@/lib/time";
import {
  effectiveStatus,
  fmtAmount,
  fmtDateTime,
  fmtPhone,
  pdfFileName,
  quoteText,
  vehicleLabel,
  type QuoteDoc,
} from "./document";
import { priceQuote } from "./engine";
import { SD2_FORM, WD1_FORM } from "./fixtures";
import { quoteFormSchema } from "./schema";

const BUSINESS = {
  name: "J-MaVe Cars",
  address: "Door 8, KM 5, JP Laurel Bajada, Davao City",
  mobile: "+639190737627",
  landline: "+63822820843",
  email: "jmavevc@gmail.com",
};
const ctx = { card: EXPECTED_RATE_CARD_V1, holidays: [], client: null, vehicle: null };

function doc(formInput: unknown, extra: Partial<QuoteDoc> = {}): QuoteDoc {
  const form = quoteFormSchema.parse(formInput);
  const priced = priceQuote(form, ctx);
  return {
    number: "QTN-2026-929",
    kind: "formal",
    service: form.service,
    status: "issued",
    issuedAt: manilaToUtc("2026-11-23", "11:30"),
    validUntil: manilaToUtc("2026-11-24", "11:30"),
    startAt: priced.startAt,
    endAt: priced.endAt,
    business: BUSINESS,
    consultantName: "Sam",
    clientName: "Juan Dela Cruz",
    clientFbName: null,
    vehicleLabel: vehicleLabel("Wigo", priced.bodyType, priced.category),
    bodyLabel: "Compact",
    categoryLabel: null,
    form,
    result: priced.result,
    ...extra,
  };
}

describe("SD-2 through the quotation form", () => {
  it("prices exactly as pricing.md", () => {
    const r = doc(SD2_FORM).result;
    if (r.service !== "self_drive") throw new Error("wrong service");
    expect(r.lines.map((l) => [l.code, l.amount])).toEqual([
      ["rental", 158000],
      ["carwash", 20000],
      ["delivery_fee", 49000],
    ]);
    expect(r.subtotal).toBe(227000);
    expect(r.discounts.map((l) => l.amount)).toEqual([-7900]);
    expect(r.total).toBe(219100);
    expect(r.payable.totalContractValue).toBe(419100);
    expect(r.payable.dueToday).toBe(99000);
    expect(r.payable.balanceOnRelease).toBe(320100);
  });

  it("copy text matches the brief exactly", () => {
    expect(quoteText(doc(SD2_FORM))).toBe(
      [
        "J-MaVe Cars — QTN-2026-929",
        "Self-Drive · Wigo (Compact) · Nov 22, 11:30 AM – Nov 23, 11:30 AM",
        "1,580.00  Rental rate (1 day)",
        "  200.00  Carwash",
        "  490.00  Delivery fee",
        "  -79.00  New client discount",
        "--------",
        "2,191.00  Rental total",
        "2,000.00  Refundable deposit",
        "Valid until Nov 24, 2026 11:30 AM",
      ].join("\n"),
    );
  });

  it("estimate text has no number", () => {
    const t = quoteText(doc(SD2_FORM, { number: null, kind: "quick" }));
    expect(t.split("\n")[0]).toBe("J-MaVe Cars — ESTIMATE");
    expect(t).toContain("Estimate only.");
  });
});

describe("WD-1 through the quotation form", () => {
  it("grand total 7,100 and the text ends with the total", () => {
    const d = doc(WD1_FORM, { number: "QTN-WD2026-119" });
    expect(d.result.service === "with_driver" && d.result.grandTotal).toBe(710000);
    const t = quoteText(d);
    expect(t).toContain("7,100.00  Total");
    expect(t).toContain("  500.00  Service fee");
    expect(t.split("\n")[1]).toBe("With Driver · Wigo (SUV Primo) · Nov 25, 8:30 AM – Nov 25, 6:30 PM");
  });

  it("corporate client (auto) adds the mark-up (WD-5)", () => {
    const form = quoteFormSchema.parse({ ...WD1_FORM, corporateMarkupPct: 10 });
    const p = priceQuote(form, { ...ctx, client: { firstRentalAt: null, clientType: "corporate" } });
    expect(p.total).toBe(781000);
  });
});

describe("form → engine mapping", () => {
  it("repeat: auto uses the client's history; no client = new", () => {
    const form = quoteFormSchema.parse({ ...SD2_FORM, repeat: "auto" });
    expect(priceQuote(form, ctx).clientIsRepeat).toBe(false);
    expect(priceQuote(form, { ...ctx, client: { firstRentalAt: new Date(), clientType: "individual" } }).clientIsRepeat).toBe(true);
    expect(priceQuote(quoteFormSchema.parse({ ...SD2_FORM, repeat: "repeat" }), ctx).result.discounts).toEqual([]);
  });

  it("vehicle body type and fuel win over the form", () => {
    const form = quoteFormSchema.parse({ ...SD2_FORM, bodyType: "sedan", category: "primo" });
    const p = priceQuote(form, { ...ctx, vehicle: { bodyType: "compact", fuelType: "premium" } });
    expect(p.bodyType).toBe("compact");
    expect(p.category).toBeNull();
    expect(p.result.service === "self_drive" && p.result.inputs.fuelType).toBe("premium");
  });

  it("manual schedule overrides the dates", () => {
    const form = quoteFormSchema.parse({ ...SD2_FORM, scheduleMode: "manual", days: 3, hoursTier: 24 });
    expect(priceQuote(form, ctx).result.lines[0].amount).toBe(158000 * 3);
  });

  it("auto OT slot from an evening release", () => {
    const form = quoteFormSchema.parse({ ...SD2_FORM, startTime: "20:00", endTime: "20:00" });
    expect(priceQuote(form, ctx).result.lines.some((l) => l.code === "ot_premium" && l.amount === 50000)).toBe(true);
  });
});

describe("helpers", () => {
  it("effective status: issued past valid_until is expired", () => {
    const now = new Date("2026-11-24T00:00:00Z");
    expect(effectiveStatus({ status: "issued", validUntil: new Date("2026-11-23T00:00:00Z") }, now)).toBe("expired");
    expect(effectiveStatus({ status: "issued", validUntil: new Date("2026-11-25T00:00:00Z") }, now)).toBe("issued");
    expect(effectiveStatus({ status: "lost", validUntil: new Date("2026-11-23T00:00:00Z") }, now)).toBe("lost");
  });

  it("formats", () => {
    expect(fmtAmount(-7900)).toBe("-79.00");
    expect(fmtAmount(12345678)).toBe("123,456.78");
    expect(fmtDateTime(manilaToUtc("2026-11-24", "00:05"))).toBe("Nov 24, 2026 12:05 AM");
    expect(fmtDateTime(manilaToUtc("2026-11-24", "12:00"))).toBe("Nov 24, 2026 12:00 PM");
    expect(fmtPhone("+639190737627")).toBe("0919 073 7627");
    expect(fmtPhone("+63822820843")).toBe("(082) 282-0843");
  });

  it("PDF file names (quote-documents.md §4)", () => {
    expect(pdfFileName({ number: "QTN-2026-929", clientName: "Juan Dela Cruz", issuedAt: null })).toBe(
      "QTN-2026-929_Juan-Dela-Cruz.pdf",
    );
    expect(pdfFileName({ number: "QTN-2026-929", clientName: "José Peña-Ñoño Jr.", issuedAt: null })).toBe(
      "QTN-2026-929_Jose-Pena-Nono-Jr.pdf",
    );
    expect(pdfFileName({ number: null, clientName: null, issuedAt: manilaToUtc("2026-11-23", "10:30") })).toBe(
      "Estimate_2026-11-23_1030.pdf",
    );
  });
});

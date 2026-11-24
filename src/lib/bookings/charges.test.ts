import { describe, expect, it } from "vitest";
import { EXPECTED_RATE_CARD_V1 } from "@/lib/pricing";
import { priceQuote } from "@/lib/quotes/engine";
import { SD2_FORM, WD1_FORM } from "@/lib/quotes/fixtures";
import { quoteFormSchema } from "@/lib/quotes/schema";
import { chargesFromQuoteResult, quotedDeposit } from "./charges";

const ctx = { card: EXPECTED_RATE_CARD_V1, holidays: [], client: null, vehicle: null };
const sum = (rows: { amountCentavos: number }[]) => rows.reduce((s, r) => s + r.amountCentavos, 0);

describe("charges from a quotation", () => {
  it("Self-Drive: charges = contract value − deposit", () => {
    const r = priceQuote(quoteFormSchema.parse(SD2_FORM), ctx).result;
    if (r.service !== "self_drive") throw new Error("expected self-drive");
    const rows = chargesFromQuoteResult(r);
    expect(sum(rows)).toBe(r.payable.totalContractValue - quotedDeposit(r));
    expect(rows.every((c) => c.kind === "quoted" && c.source === "quote")).toBe(true);
    expect(rows.map((c) => c.sortOrder)).toEqual(rows.map((_, i) => i));
    expect(rows.some((c) => c.amountCentavos === 0)).toBe(false);
  });

  it("Self-Drive by card: terminal fees become their own rows", () => {
    const form = quoteFormSchema.parse({
      ...SD2_FORM,
      rentalMethod: "card",
      reservationMethod: "card",
      depositMethod: "card",
    });
    const r = priceQuote(form, ctx).result;
    if (r.service !== "self_drive") throw new Error("expected self-drive");
    const rows = chargesFromQuoteResult(r);
    expect(rows.filter((c) => c.code?.startsWith("terminal_fee")).length).toBeGreaterThan(0);
    expect(sum(rows)).toBe(r.payable.totalContractValue - r.payable.deposit);
  });

  it("With Driver: charges = grand total (WD-1, and corporate WD-5)", () => {
    const r = priceQuote(quoteFormSchema.parse(WD1_FORM), ctx).result;
    if (r.service !== "with_driver") throw new Error("expected with-driver");
    expect(sum(chargesFromQuoteResult(r))).toBe(r.grandTotal);
    const corp = priceQuote(quoteFormSchema.parse({ ...WD1_FORM, corporateMarkupPct: 10 }), {
      ...ctx,
      client: { firstRentalAt: null, clientType: "corporate" },
    }).result;
    if (corp.service !== "with_driver") throw new Error("expected with-driver");
    const rows = chargesFromQuoteResult(corp);
    expect(rows.some((c) => c.code === "corporate_markup")).toBe(true);
    expect(sum(rows)).toBe(corp.grandTotal);
  });
});

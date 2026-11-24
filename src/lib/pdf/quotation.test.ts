import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_RATE_CARD_V1 } from "@/lib/pricing";
import { vehicleLabel, type QuoteDoc } from "@/lib/quotes/document";
import { priceQuote } from "@/lib/quotes/engine";
import { SD2_FORM, WD1_FORM } from "@/lib/quotes/fixtures";
import { quoteFormSchema } from "@/lib/quotes/schema";
import { manilaToUtc } from "@/lib/time";
import { renderQuotationPdf } from "./quotation";

const BUSINESS = {
  name: "J-MaVe Cars",
  address: "Door 8, KM 5, JP Laurel Bajada, Davao City",
  mobile: "+639190737627",
  landline: "+63822820843",
  email: "jmavevc@gmail.com",
};
const LONG = "Maximiliano Bartolomeo Fernandez-Castellanos de los Santos y Villanueva III";

function doc(formInput: unknown, extra: Partial<QuoteDoc> = {}): QuoteDoc {
  const form = quoteFormSchema.parse(formInput);
  const p = priceQuote(form, { card: EXPECTED_RATE_CARD_V1, holidays: [], client: null, vehicle: null });
  return {
    number: "QTN-2026-929",
    kind: "formal",
    service: form.service,
    status: "issued",
    issuedAt: manilaToUtc("2026-11-23", "11:30"),
    validUntil: manilaToUtc("2026-11-24", "11:30"),
    startAt: p.startAt,
    endAt: p.endAt,
    business: BUSINESS,
    consultantName: "Sam",
    clientName: "Juan Dela Cruz",
    clientFbName: "Juan DC",
    vehicleLabel: vehicleLabel("Wigo", p.bodyType, p.category),
    bodyLabel: "Compact",
    categoryLabel: p.category ? "Primo" : null,
    form,
    result: p.result,
    ...extra,
  };
}

/** Set PDF_OUT=<dir> to keep the files for a visual check. */
function keep(name: string, buf: Buffer) {
  const dir = process.env.PDF_OUT;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), buf);
}

const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === "%PDF-";
const pages = (b: Buffer) => (b.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

describe("quotation PDFs", { timeout: 30_000 }, () => {
  it("Self-Drive formal (SD-2)", async () => {
    const buf = await renderQuotationPdf(doc(SD2_FORM));
    keep("sd2-formal.pdf", buf);
    expect(isPdf(buf)).toBe(true);
  });

  it("estimate", async () => {
    const buf = await renderQuotationPdf(doc(SD2_FORM, { number: null, kind: "quick", clientName: null }));
    keep("sd2-estimate.pdf", buf);
    expect(isPdf(buf)).toBe(true);
    expect(pages(buf)).toBe(1);
  });

  it("With Driver formal, long names and 15+ lines", async () => {
    const form = {
      ...WD1_FORM,
      bodyType: "sedan",
      wdDays: 4,
      oneWayDistanceKm: 180,
      drivingTerm: "long_term_parking",
      startTime: "21:00",
      endTime: "09:00",
      wdAdditionalHoursBlock: 8,
      mealPerDay: 30000,
      accommodationPerDay: 150000,
      discount: 50000,
      rentalMethod: "card",
      reservationFee: 100000,
      reservationMethod: "card",
      clientType: "corporate",
      corporateMarkupPct: 10,
      pickupPlace: `${LONG} Residence, Purok 7, Barangay Mintal, Davao City`,
      dropoffPlace: "Samal Island Resort, Island Garden City of Samal, Davao del Norte",
      itinerary: Array.from({ length: 6 }, (_, i) => `Stop ${i + 1}: a long description of the planned stop and activities`).join("; "),
      driverName: "Ramon Driver",
      driverContact: "0917 000 0000",
    };
    const d = doc(form, { number: "QTN-WD2026-119", clientName: LONG, vehicleLabel: vehicleLabel("Toyota Vios 1.3 XLE CVT (Pearl White, 2024)", "sedan", "primo") });
    expect(d.result.lines.length + d.result.discounts.length).toBeGreaterThanOrEqual(13);
    const buf = await renderQuotationPdf(d);
    keep("wd-long.pdf", buf);
    expect(isPdf(buf)).toBe(true);
  });

  it("Self-Drive with every line (15+)", async () => {
    const form = {
      ...SD2_FORM,
      bodyType: "mpv",
      category: "primo",
      endDate: "2026-11-29",
      endTime: "20:00",
      startTime: "20:00",
      extensionHours: 3,
      beyondOperatingHours: true,
      withCdw: true,
      sevenDayDiscount: true,
      promo: "APRIL_TIERED",
      pickupFee: 49000,
      oneWayDistanceKm: 600,
      rentalMethod: "card",
      depositMethod: "card",
      reservationMethod: "card",
      areaFrom: "Davao City",
      destination: "Cagayan de Oro, Bukidnon, Surigao del Sur and back via Butuan",
    };
    const d = doc(form, { clientName: LONG, clientFbName: LONG });
    const buf = await renderQuotationPdf(d);
    keep("sd-full.pdf", buf);
    expect(isPdf(buf)).toBe(true);
  });
});

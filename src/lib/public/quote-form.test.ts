import { describe, expect, it } from "vitest";
import { EXPECTED_RATE_CARD_V1, priceSelfDrive, priceWithDriver } from "@/lib/pricing";
import { priceQuote } from "@/lib/quotes/engine";
import { FUEL } from "@/lib/quotes/fixtures";
import { bookingFieldsFromRequest, publicBreakdown, publicCategory, publicQuoteForm, publicTotal, publicVehicleName } from "./quote-form";
import { detailsSchema, searchSchema, submitSchema } from "./schema";

const sedan = { id: "00000000-0000-4000-8000-000000000001", bodyType: "sedan" as const, category: "primo" };
const suv = { id: "00000000-0000-4000-8000-000000000002", bodyType: "suv" as const, category: "budgetmile" };

describe("public vehicles", () => {
  it("needs a category only for body types that have one", () => {
    expect(publicCategory({ bodyType: "sedan", category: "primo" })).toEqual({ ok: true, category: "primo" });
    expect(publicCategory({ bodyType: "sedan", category: null })).toEqual({ ok: false, category: null });
    expect(publicCategory({ bodyType: "mpv", category: "premium" })).toEqual({ ok: false, category: null });
    expect(publicCategory({ bodyType: "van", category: null })).toEqual({ ok: true, category: null });
    expect(publicCategory({ bodyType: null, category: null }).ok).toBe(false);
  });

  it("never shows the plate", () => {
    expect(publicVehicleName({ displayName: "Vios Red AT TST 1001", plate: "TST 1001", make: null, model: null, color: null })).toBe("Vios Red AT");
    expect(publicVehicleName({ displayName: "x", plate: "TST 1001", make: "Toyota", model: "Vios", color: "Red" })).toBe("Toyota Vios (Red)");
  });
});

describe("public request → quotation form → engine", () => {
  it("Self-Drive: same price as the engine with the equivalent input, without the new-client discount", () => {
    const search = searchSchema.parse({ service: "self_drive", startDate: "2026-12-20", startTime: "09:00", endDate: "2026-12-22", endTime: "09:00", paymentMethod: "cash" });
    const form = publicQuoteForm(search, sedan, FUEL, "public_price");
    const priced = priceQuote(form, { card: EXPECTED_RATE_CARD_V1, holidays: [], client: null, vehicle: { bodyType: "sedan", fuelType: "gasoline" } });
    const direct = priceSelfDrive(
      {
        bodyType: "sedan",
        category: "primo",
        fuelType: "gasoline",
        hoursTier: 24,
        days: 2,
        additionalHoursBlock: null,
        clientIsRepeat: true,
        fuelPrices: FUEL,
        oneWayDistanceKm: 0,
        reservationFee: 50_000,
        deposit: 200_000,
      },
      EXPECTED_RATE_CARD_V1,
    );
    expect(publicTotal(priced.result)).toBe(direct.total);
    // Sedan primo 24h × 2 days + carwash = ₱3,780 + ₱200.
    expect(direct.total).toBe(398_000);
    expect(priced.result.discounts).toEqual([]);
    const b = publicBreakdown(priced.result);
    expect(b.payable.at(-1)).toEqual({ label: "Total contract value", remark: null, amount: 398_000 + 200_000 });
  });

  it("the staff draft prices with the client's history (new client gets 5% off)", () => {
    const search = searchSchema.parse({ service: "self_drive", startDate: "2026-12-20", startTime: "09:00", endDate: "2026-12-22", endTime: "09:00" });
    const form = publicQuoteForm(search, sedan, FUEL, "draft", { clientId: sedan.id });
    expect(form.repeat).toBe("auto");
    const priced = priceQuote(form, { card: EXPECTED_RATE_CARD_V1, holidays: [], client: { firstRentalAt: null, clientType: "individual" }, vehicle: { bodyType: "sedan", fuelType: "gasoline" } });
    expect(priced.result.discounts.map((d) => d.code)).toContain("new_client");
  });

  it("card payment adds the terminal fee", () => {
    const search = searchSchema.parse({ service: "self_drive", startDate: "2026-12-20", startTime: "09:00", endDate: "2026-12-21", endTime: "09:00", paymentMethod: "card" });
    const priced = priceQuote(publicQuoteForm(search, sedan, FUEL, "public_price"), { card: EXPECTED_RATE_CARD_V1, holidays: [], client: null, vehicle: null });
    expect(publicBreakdown(priced.result).payable.some((l) => l.label.startsWith("Card terminal fee"))).toBe(true);
  });

  it("With Driver: matches the engine for the same window, days and distance", () => {
    const search = searchSchema.parse({
      service: "with_driver",
      startDate: "2026-12-20",
      startTime: "08:00",
      wdEndTime: "18:00",
      wdDays: 2,
      destination: "Tagum City",
      serviceArea: "davao_region",
      oneWayKm: 60,
    });
    const form = publicQuoteForm(search, suv, FUEL, "public_price");
    const priced = priceQuote(form, { card: EXPECTED_RATE_CARD_V1, holidays: [], client: null, vehicle: { bodyType: "suv", fuelType: "diesel" } });
    const direct = priceWithDriver(
      {
        bodyType: "suv",
        category: "budgetmile",
        fuelType: "diesel",
        startAt: "2026-12-20T00:00:00.000Z",
        endAt: "2026-12-20T10:00:00.000Z",
        days: 2,
        oneWayDistanceKm: 60,
        serviceArea: "davao_region",
        fuelPrices: FUEL,
        reservationFee: 50_000,
      },
      EXPECTED_RATE_CARD_V1,
      { holidays: [] },
    );
    expect(publicTotal(priced.result)).toBe(direct.grandTotal);
    expect(priced.endAt.toISOString()).toBe("2026-12-21T10:00:00.000Z");
  });
});

describe("public schemas", () => {
  it("normalises and validates details", () => {
    expect(detailsSchema.safeParse({ fullName: "A", phone: "0917" }).success).toBe(false);
    const d = detailsSchema.parse({ fullName: "Ana Invented", phone: "0917 123 4567", email: "ANA@Example.Test" });
    expect(d.email).toBe("ana@example.test");
    const alt = detailsSchema.safeParse({ fullName: "Ana Invented", phone: "09171234567", altContactPhone: "09179999999" });
    expect(alt.success).toBe(false);
  });

  it("With Driver needs a destination and an end time; consent must be true", () => {
    const wd = searchSchema.safeParse({ service: "with_driver", startDate: "2026-12-20", startTime: "08:00" });
    expect(wd.success).toBe(false);
    const sub = submitSchema.safeParse({
      search: { service: "self_drive", startDate: "2026-12-20", startTime: "09:00", endDate: "2026-12-21", endTime: "09:00" },
      vehicleId: sedan.id,
      details: { fullName: "Ana Invented", phone: "09171234567" },
      consent: false,
    });
    expect(sub.success).toBe(false);
  });

  it("booking fields copied on convert", () => {
    const s = searchSchema.parse({ service: "with_driver", startDate: "2026-12-20", startTime: "08:00", wdEndTime: "18:00", destination: "Tagum" });
    const d = detailsSchema.parse({ fullName: "Ana Invented", phone: "09171234567", pickupAddress: "Home", dropoffAddress: "Hotel", passengers: 3, itinerary: "Loop", idsPresented: ["Passport"] });
    expect(bookingFieldsFromRequest(s, d)).toEqual({
      deliveryAddress: null,
      pickupAddress: "Home",
      passengers: 3,
      luggage: null,
      itinerary: "Drop-off: Hotel\nLoop",
      driversLicenseNo: null,
      idsPresented: ["Passport"],
      sourceChannel: "website",
    });
  });
});

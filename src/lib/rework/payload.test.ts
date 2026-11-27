import { describe, expect, it } from "vitest";
import { DEFAULT_REWORK_OPTION_MAP, optionFor, type ReworkOptionMap } from "./options";
import { mapReworkLead, type LeadFacts } from "./payload";

/** Invented data only. */
const FULL: LeadFacts = {
  client: {
    fullName: "Maria Invented Santos",
    email: "maria.invented@example.test",
    phone: "+639171234567",
    birthday: "1992-03-15",
    altContactName: "Jose Invented",
    altContactPhone: "+639179876543",
    driversLicenseNo: "N01-23-456789",
    companyName: "Invented Trading Co.",
  },
  service: "with_driver",
  startAt: new Date("2026-12-20T01:00:00.000Z"), // 09:00 Manila
  endAt: new Date("2026-12-22T09:00:00.000Z"),
  bodyType: "suv",
  category: "primo",
  destination: "Tagum City",
  itinerary: "Day 1 Tagum, day 2 Panabo, day 3 back",
  deliveryAddress: "Invented delivery address",
  pickupAddress: "Door 1, Invented Street, Davao City",
  dropoffAddress: "Invented Hotel, Tagum City",
  driversLicenseType: "professional",
  idsPresented: ["Passport", "UMID"],
  passengers: 5,
  luggage: "3 big bags",
  drivingTerm: "long_term_parking",
  specialRequests: "Child seat please",
  paymentMethod: "gcash",
  dealSource: "website_booking_page",
  link: "https://app.example.test/inquiries/00000000-0000-4000-8000-000000000001",
  ownerId: "owner-123",
  quotationNumber: null,
  attribution: {
    utm_source: "facebook",
    utm_medium: "cpc",
    utm_campaign: "december-promo",
    utm_term: "car rental davao",
    utm_content: "carousel-a",
    fbclid: "IwAR-invented",
    gclid: "Cj0-invented",
    ttclid: "tt-invented",
    gbraid: "gb-invented",
    fbp: "fb.1.1700000000000.123456789",
    referral_url: "https://www.example.test/promo",
    referral_domain: "www.example.test",
    landing_url: "https://book.example.test/?utm_source=facebook",
  },
  geoIp: "203.0.113.7",
  userAgent: "Mozilla/5.0 (Invented)",
};

const OPTS = { optionMap: DEFAULT_REWORK_OPTION_MAP, dateUnit: "seconds" as const };

describe("Rework payload mapper (rework.md §3)", () => {
  it("maps a full With Driver request (snapshot)", () => {
    expect(mapReworkLead(FULL, OPTS)).toMatchInlineSnapshot(`
      {
        "custom_alternative_contact_person": "Jose Invented – +639179876543",
        "custom_birthday": 700588800,
        "custom_car_type": "SUV",
        "custom_company_name_if_applicable": "Invented Trading Co.",
        "custom_deal_sources": "Website Booking Page",
        "custom_delivery_address": "Invented delivery address",
        "custom_destination": "Tagum City",
        "custom_do_you_need_the_driver_to_waitstandby": "Yes",
        "custom_drivers_license": "Professional",
        "custom_drivers_license_no_": "N01-23-456789",
        "custom_drop_off_address": "Invented Hotel, Tagum City",
        "custom_email_address": "maria.invented@example.test",
        "custom_expected_return_date_time": 1797930000,
        "custom_form_submission_link": "https://app.example.test/inquiries/00000000-0000-4000-8000-000000000001",
        "custom_full_itinerary_route_plan": "Day 1 Tagum, day 2 Panabo, day 3 back",
        "custom_full_name": "Maria Invented Santos",
        "custom_government_id": "Passport",
        "custom_mode_of_payment": "GCash",
        "custom_number_of_luggages_if_any": "3 big bags",
        "custom_number_of_passengers": 5,
        "custom_phone_number": "+639171234567",
        "custom_pick_up_address": "Door 1, Invented Street, Davao City",
        "custom_services": "With Driver",
        "custom_special_requests": "Child seat please",
        "custom_start_time": 1797728400,
        "email": "maria.invented@example.test",
        "fbclid": "IwAR-invented",
        "fbp": "fb.1.1700000000000.123456789",
        "gbraid": "gb-invented",
        "gclid": "Cj0-invented",
        "geo_ip": "203.0.113.7",
        "labels": [
          "With Driver",
        ],
        "name": "Maria Invented Santos",
        "owner_id": "owner-123",
        "phone": "+639171234567",
        "referral_domain": "www.example.test",
        "referral_url": "https://www.example.test/promo",
        "ttclid": "tt-invented",
        "user_agent": "Mozilla/5.0 (Invented)",
        "utm_campaign": "december-promo",
        "utm_content": "carousel-a",
        "utm_medium": "cpc",
        "utm_source": "facebook",
        "utm_term": "car rental davao",
      }
    `);
  });

  it("sends only non-empty values", () => {
    const lead = mapReworkLead(
      {
        client: { fullName: "Ana Invented", email: null, phone: "+639170000001", birthday: null, altContactName: "", altContactPhone: null, driversLicenseNo: "  ", companyName: null },
        service: "self_drive",
        startAt: null,
        endAt: null,
        bodyType: null,
        category: null,
        idsPresented: [],
        specialRequests: "",
      },
      OPTS,
    );
    expect(lead).toEqual({
      name: "Ana Invented",
      phone: "+639170000001",
      labels: ["Self-Drive"],
      custom_full_name: "Ana Invented",
      custom_phone_number: "+639170000001",
      custom_services: "Self-Drive",
    });
  });

  it("uses milliseconds when the date unit says so, and labels the QTN number", () => {
    const lead = mapReworkLead({ ...FULL, service: "self_drive", quotationNumber: "QTN-2026-950" }, { ...OPTS, dateUnit: "milliseconds" });
    expect(lead.custom_start_time).toBe(Date.parse("2026-12-20T01:00:00.000Z"));
    expect(lead.labels).toEqual(["Self-Drive", "QTN-2026-950"]);
    // Self-Drive: delivery address, no With Driver-only fields.
    expect(lead.custom_delivery_address).toBe("Invented delivery address");
    expect(lead).not.toHaveProperty("custom_drop_off_address");
    expect(lead).not.toHaveProperty("custom_number_of_passengers");
  });

  it("leaves out option fields whose mapped value is empty", () => {
    const map: ReworkOptionMap = { ...DEFAULT_REWORK_OPTION_MAP, mode_of_payment: { ...DEFAULT_REWORK_OPTION_MAP.mode_of_payment, gcash: "" } };
    expect(mapReworkLead(FULL, { ...OPTS, optionMap: map })).not.toHaveProperty("custom_mode_of_payment");
  });

  it("car type falls back from body:category to the body type", () => {
    const map: ReworkOptionMap = { ...DEFAULT_REWORK_OPTION_MAP, car_type: { sedan: "Sedan", "sedan:premium": "Premium Sedan" } };
    expect(optionFor(map, "car_type", "sedan:premium")).toBe("Premium Sedan");
    expect(optionFor(map, "car_type", "sedan:primo")).toBe("Sedan");
    expect(optionFor(map, "car_type", "van")).toBeNull();
  });
});

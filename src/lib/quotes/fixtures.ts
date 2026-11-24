/** Invented quotation forms for tests (no client data). */
import type { QuoteFormInput } from "./schema";

export const FUEL = { gasoline: 9400, premium: 9900, diesel: 9800 };

/** Golden SD-2 (pricing.md §7): Compact 24h, 1 day, new client, delivery 490. */
export const SD2_FORM: QuoteFormInput = {
  service: "self_drive",
  bodyType: "compact",
  repeat: "new",
  startDate: "2026-11-22",
  startTime: "11:30",
  endDate: "2026-11-23",
  endTime: "11:30",
  deliveryFee: 49000,
  reservationFee: 50000,
  deposit: 200000,
  fuelPrices: FUEL,
};

/** Golden WD-1: SUV primo 08:30–18:30, 50 km, all-in, meal 100, diesel 98. */
export const WD1_FORM: QuoteFormInput = {
  service: "with_driver",
  bodyType: "suv",
  category: "primo",
  startDate: "2026-11-25",
  startTime: "08:30",
  endDate: "2026-11-25",
  endTime: "18:30",
  wdDays: 1,
  oneWayDistanceKm: 50,
  pricingBasis: "all_in",
  serviceArea: "davao_region",
  event: "regular",
  mealPerDay: 10000,
  reservationFee: 0,
  fuelPrices: FUEL,
};

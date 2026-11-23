/**
 * The v1 rate card exactly as written in docs/reference/pricing.md.
 * Used by the golden tests and by the import self-check (import-map.md:
 * "compare against the expected numbers in pricing.md").
 *
 * Additional-hours rows for categorised body types follow the old sheet:
 * the block price is that category's 8h / 12h daily rate (FORMULA!S58 =K38,
 * FORMULA WDRIVER!E97 =G20). pricing.md lists the snapshot values (primo for
 * Self-Drive, premium sedan for With Driver), which these rows contain.
 */
import type { RateCardData } from "./rate-card";

/** Pesos → centavos for readability. */
const p = (pesos: number) => Math.round(pesos * 100);
const sd = (h24: number, h12: number, h8: number) => ({ h24: p(h24), h12: p(h12), h8: p(h8) });
const wd = (h24: number, h12: number, h10: number, h8: number) => ({
  h24: p(h24),
  h12: p(h12),
  h10: p(h10),
  h8: p(h8),
});
const block = (h8: number, h12: number) => ({ h8: p(h8), h12: p(h12) });
const lt = (m30: number, m15: number, r30: number, r15: number, c30: number, c15: number) => ({
  mindanao: { d30: p(m30), d15to29: p(m15) },
  davao_region: { d30: p(r30), d15to29: p(r15) },
  within_davao_city: { d30: p(c30), d15to29: p(c15) },
});
const ehr = (rentersFuel: number, allIn: number) => ({ rentersFuel: p(rentersFuel), allIn: p(allIn) });

export const EXPECTED_RATE_CARD_V1: RateCardData = {
  vehicleClasses: {
    compact: { kmPerLiter: 10, carwash: p(200), cdwPerDay: p(350), excessPerKm: p(4) },
    sedan: { kmPerLiter: 10, carwash: p(200), cdwPerDay: p(350), excessPerKm: p(4) },
    wagon: { kmPerLiter: 9, carwash: p(250), cdwPerDay: p(500), excessPerKm: p(5) },
    mpv: { kmPerLiter: 9, carwash: p(250), cdwPerDay: p(500), excessPerKm: p(5) },
    suv: { kmPerLiter: 8, carwash: p(300), cdwPerDay: p(500), excessPerKm: p(5) },
    pickup: { kmPerLiter: 8, carwash: p(300), cdwPerDay: p(500), excessPerKm: p(5) },
    van: { kmPerLiter: 7, carwash: p(350), cdwPerDay: p(500), excessPerKm: p(5) },
  },
  mileageAllowanceKmPerDay: 150,
  terminalFeeBps: 350,

  selfDrive: {
    daily: {
      sedan_budgetmile: sd(1790, 1680, 1050),
      sedan_primo: sd(1890, 1700, 1100),
      sedan_premium: sd(2000, 1800, 1200),
      mpv_budgetmile: sd(2420, 2310, 1580),
      mpv_primo: sd(2630, 2520, 1790),
      suv_budgetmile: sd(3470, 3370, 2630),
      suv_primo: sd(3680, 3580, 2840),
      compact: sd(1580, 1470, 950),
      wagon: sd(2310, 2210, 1580),
      pickup: sd(3299, 3199, 2500),
      van: sd(4500, 4500, 3500),
    },
    additionalHours: {
      sedan_budgetmile: block(1050, 1680),
      sedan_primo: block(1100, 1700),
      sedan_premium: block(1200, 1800),
      mpv_budgetmile: block(1580, 2310),
      mpv_primo: block(1790, 2520),
      suv_budgetmile: block(2630, 3370),
      suv_primo: block(2840, 3580),
      compact: block(950, 1470),
      wagon: block(1580, 2210),
      pickup: block(2500, 3199),
      van: block(2500, 3400),
    },
    hourlyExtension: {
      compact: p(300),
      sedan: p(300),
      wagon: p(350),
      mpv: p(350),
      suv: p(400),
      pickup: p(400),
      van: p(500), // missing in the sheet (PLAN Q7)
    },
    sevenDayDiscountPerDay: p(100),
    sevenDayMinDays: 7,
    otPremium: { evening: p(500), overnight: p(300) },
    beyondOperatingHoursPerDay: p(500),
    newClientDiscountBps: 500,
    promos: {
      aprilTiered: { shortBps: 1000, longBps: 1500, longFromDays: 5 },
      citySaver: p(4799),
      citySaverPlus: p(5299),
    },
  },

  withDriver: {
    daily: {
      sedan_budgetmile: wd(1790, 1680, 1580, 1050),
      sedan_primo: wd(1890, 1700, 1600, 1100),
      sedan_premium: wd(2000, 1800, 1700, 1200),
      mpv_budgetmile: wd(2420, 2310, 2310, 1580),
      mpv_primo: wd(2630, 2520, 2520, 1790),
      suv_budgetmile: wd(3470, 3370, 3370, 2630),
      suv_primo: wd(3680, 3580, 3580, 2840),
      compact: wd(1580, 1470, 1370, 950),
      wagon: wd(2310, 2210, 2110, 1580),
      pickup: wd(3299, 3199, 3099, 2500),
      van: wd(4500, 3500, 3500, 3500),
    },
    longTerm: {
      compact: lt(1800, 2160, 1300, 1560, 1000, 1200),
      sedan: lt(2000, 2400, 1500, 1800, 1200, 1440),
      mpv: lt(2350, 2820, 1850, 2220, 1500, 1800),
      suv: lt(2850, 3420, 2350, 2820, 2000, 2400),
      pickup: lt(2850, 3420, 2350, 2820, 2000, 2400),
      van: lt(2850, 3420, 2350, 2820, 2000, 2400),
      wagon: lt(2350, 2820, 1850, 2220, 2200, 2640),
    },
    longTermFromDays: 15,
    longTermFullFromDays: 30,
    additionalHoursCar: {
      sedan_budgetmile: block(1050, 1680),
      sedan_primo: block(1100, 1700),
      sedan_premium: block(1200, 1800),
      mpv_budgetmile: block(1500, 2199),
      mpv_primo: block(1500, 2199),
      suv_budgetmile: block(2500, 3199),
      suv_primo: block(2500, 3199),
      compact: block(899, 1399),
      wagon: block(1500, 2099),
      pickup: block(2500, 3199),
      van: block(2500, 4000),
    },
    driverFee: {
      bandMaxKm: [70, 110, 150, 190, 230, 270, 310, 500],
      h8: [600, 700, 800, 900, 1000, 1100, 1400, 1800].map(p),
      h10: [750, 900, 1000, 1100, 1200, 1300, 1600, 2000].map(p),
      h12: [850, 1100, 1200, 1300, 1400, 1500, 1800, 2200].map(p),
      h24: [1000, 1400, 1500, 1600, 1700, 1800, 1900, 2300].map(p),
    },
    workingHourFee: p(200),
    workingHourMaxKm: 23,
    holidayMultiplier: 2,
    standbyDeduction: p(500),
    serviceFee: p(500),
    roundingStep: p(100),
    fuelFactorTenths: 22,
    nightDiffBps: 1000,
    excessHourRates: {
      compact: ehr(400, 500),
      sedan: ehr(400, 500),
      wagon: ehr(450, 550),
      mpv: ehr(450, 550),
      suv: ehr(500, 600),
      pickup: ehr(500, 600),
      van: ehr(500, 600),
    },
    unused: {
      pickupDropoffRate: {
        compact: p(899),
        sedan: p(999),
        wagon: p(1500),
        mpv: p(1500),
        suv: p(2500),
        pickup: p(2500),
        van: p(2500),
      },
      vanDistanceRate: { upTo150Km: p(3500), above150Km: p(4500) },
    },
  },
};

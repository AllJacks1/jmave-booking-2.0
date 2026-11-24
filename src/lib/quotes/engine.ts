/**
 * Quotation form → pricing engine. Pure (no DB): the caller loads the rate
 * card, holidays, client and vehicle. All price math stays in the engine;
 * this module only maps form fields to engine inputs.
 */
import {
  BODY_CATEGORIES,
  otSlotFor,
  priceSelfDrive,
  priceWithDriver,
  selfDriveSchedule,
  withDriverWindow,
  type BodyType,
  type Category,
  type FuelType,
  type OtSlot,
  type RateCardData,
  type SelfDriveInput,
  type SelfDriveResult,
  type WithDriverInput,
  type WithDriverResult,
} from "@/lib/pricing";
import { manilaToUtc } from "@/lib/time";
import type { QuoteForm } from "./schema";

export type QuoteContext = {
  card: RateCardData;
  holidays: readonly string[];
  client: { firstRentalAt: Date | string | null; clientType: "individual" | "corporate" } | null;
  vehicle: { bodyType: BodyType | null; fuelType: FuelType | null } | null;
};

export type QuoteResult = SelfDriveResult | WithDriverResult;

export type PricedQuote = {
  result: QuoteResult;
  startAt: Date;
  endAt: Date;
  bodyType: BodyType;
  category: Category | null;
  /** Self-Drive schedule actually priced (auto or manual). */
  schedule: { days: number; hoursTier: number; additionalHoursBlock: 8 | 12 | null; otSlot: OtSlot } | null;
  clientIsRepeat: boolean;
  /** Self-Drive rental total; With Driver grand total. Stored as `total_centavos`. */
  total: number;
};

export function resolveIsRepeat(form: Pick<QuoteForm, "repeat">, client: QuoteContext["client"]): boolean {
  if (form.repeat === "repeat") return true;
  if (form.repeat === "new") return false;
  return client ? client.firstRentalAt !== null : false;
}

export function resolveBody(form: Pick<QuoteForm, "bodyType" | "category">, vehicle: QuoteContext["vehicle"]) {
  const bodyType = vehicle?.bodyType ?? form.bodyType;
  const cats = BODY_CATEGORIES[bodyType];
  const category = cats.length === 0 ? null : form.category;
  return { bodyType, category };
}

/** Price a form. Throws `PricingInputError` for input the engine rejects. */
export function priceQuote(form: QuoteForm, ctx: QuoteContext): PricedQuote {
  const { bodyType, category } = resolveBody(form, ctx.vehicle);
  const fuelType = ctx.vehicle?.fuelType ?? null;
  const clientIsRepeat = resolveIsRepeat(form, ctx.client);
  const pricingCtx = { holidays: ctx.holidays };

  if (form.service === "self_drive") {
    const startAt = manilaToUtc(form.startDate, form.startTime);
    const endAt = manilaToUtc(form.endDate, form.endTime);
    const auto = selfDriveSchedule(startAt, endAt);
    const sched =
      form.scheduleMode === "auto"
        ? auto
        : { days: form.days, hoursTier: form.hoursTier, additionalHoursBlock: form.additionalHoursBlock };
    const otSlot = form.otPremiumSlot === "auto" ? otSlotFor(startAt, endAt) : form.otPremiumSlot;
    const input: SelfDriveInput = {
      bodyType,
      category,
      fuelType,
      hoursTier: sched.hoursTier,
      days: sched.days,
      additionalHoursBlock: sched.additionalHoursBlock,
      extensionHours: form.extensionHours,
      beyondOperatingHours: form.beyondOperatingHours,
      otPremiumSlot: otSlot,
      withCdw: form.withCdw,
      sevenDayDiscount: form.sevenDayDiscount,
      promo: form.promo,
      clientIsRepeat,
      deliveryFee: form.deliveryFee,
      pickupFee: form.pickupFee,
      oneWayDistanceKm: form.oneWayDistanceKm,
      includeFuel: form.includeFuel,
      fuelPrices: form.fuelPrices,
      reservationFee: form.reservationFee,
      deposit: form.deposit,
      paymentMethods: { rental: form.rentalMethod, reservation: form.reservationMethod, deposit: form.depositMethod },
    };
    const result = priceSelfDrive(input, ctx.card, pricingCtx);
    return {
      result,
      startAt,
      endAt,
      bodyType,
      category,
      schedule: { ...sched, otSlot },
      clientIsRepeat,
      total: result.total,
    };
  }

  const w = withDriverWindow(form.startDate, form.startTime, form.endTime, form.wdDays);
  const clientType = form.clientType === "auto" ? (ctx.client?.clientType ?? "individual") : form.clientType;
  const input: WithDriverInput = {
    bodyType,
    category,
    fuelType,
    startAt: w.startAt.toISOString(),
    endAt: w.firstDayEndAt.toISOString(),
    days: form.wdDays,
    oneWayDistanceKm: form.oneWayDistanceKm,
    pricingBasis: form.pricingBasis,
    additionalHoursBlock: form.wdAdditionalHoursBlock,
    package: form.package,
    drivingTerm: form.drivingTerm,
    driverRateMode: form.driverRateMode,
    event: form.event,
    clientType,
    corporateMarkupBps: clientType === "corporate" ? Math.round(form.corporateMarkupPct * 100) : 0,
    serviceArea: form.serviceArea,
    mealPerDay: form.mealPerDay,
    accommodationPerDay: form.accommodationPerDay,
    fuelPrices: form.fuelPrices,
    reservationFee: form.reservationFee,
    discount: form.discount,
    paymentMethods: { rental: form.rentalMethod, reservation: form.reservationMethod },
  };
  const result = priceWithDriver(input, ctx.card, pricingCtx);
  return {
    result,
    startAt: w.startAt,
    endAt: w.endAt,
    bodyType,
    category,
    schedule: null,
    clientIsRepeat,
    total: result.grandTotal,
  };
}

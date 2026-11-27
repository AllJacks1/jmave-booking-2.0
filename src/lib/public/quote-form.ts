/**
 * Public request → quotation form (`QuoteForm`) and engine result → what the
 * public page shows. Pure. All price math stays in the engine: the public
 * page and the draft quotation are priced by `priceQuote` with this form.
 *
 * - The public price leaves out the new-client discount (`repeat: "repeat"`);
 *   the page says "New clients get 5% off — applied on your formal
 *   quotation". The staff draft prices with the client's real history.
 * - Delivery / pick-up fees are ₱0 ("to be confirmed" when an address is given).
 * - No distance is known for Self-Drive (no fuel or excess km line); With
 *   Driver uses the optional one-way km estimate (0 = shortest band).
 */
import type { QuoteForm, QuoteFormInput } from "@/lib/quotes/schema";
import { quoteFormSchema } from "@/lib/quotes/schema";
import { newQuoteForm } from "@/lib/quotes/defaults";
import { BODY_CATEGORIES, CATEGORIES, type BodyType, type Category, type FuelType } from "@/lib/pricing/types";
import type { SelfDriveResult } from "@/lib/pricing/self-drive";
import type { WithDriverResult } from "@/lib/pricing/with-driver";
import { ID_TYPES } from "@/lib/bookings/constants";
import type { Details, PublicLine, Search } from "./schema";

export type PublicVehicleRow = {
  id: string;
  displayName: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  transmission: string | null;
  seats: number | null;
  bodyType: BodyType | null;
  fuelType: FuelType | null;
  category: string | null;
};

/** The category the public page prices with, or null when the car cannot be priced (hidden). */
export function publicCategory(v: Pick<PublicVehicleRow, "bodyType" | "category">): { ok: boolean; category: Category | null } {
  if (!v.bodyType) return { ok: false, category: null };
  const cats = BODY_CATEGORIES[v.bodyType];
  if (cats.length === 0) return { ok: true, category: null };
  const c = v.category as Category | null;
  if (c && (CATEGORIES as readonly string[]).includes(c) && cats.includes(c)) return { ok: true, category: c };
  return { ok: false, category: null };
}

/** Name shown to the public: make + model (+ colour); never the plate. */
export function publicVehicleName(v: Pick<PublicVehicleRow, "displayName" | "plate" | "make" | "model" | "color">): string {
  const mm = [v.make, v.model].map((s) => s?.trim()).filter(Boolean).join(" ");
  const base = mm || stripPlate(v.displayName, v.plate);
  const color = v.color?.trim();
  return color && !base.toLowerCase().includes(color.toLowerCase()) ? `${base} (${color})` : base;
}

function stripPlate(name: string, plate: string | null): string {
  let out = name;
  if (plate?.trim()) {
    const pattern = plate
      .trim()
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s*");
    out = out.replace(new RegExp(pattern, "i"), "");
  }
  return out.replace(/[·\-–|]\s*$/, "").replace(/\s{2,}/g, " ").trim() || name;
}

export type FormPurpose = "public_price" | "draft";

/** Public search (+ details) for one vehicle → a full quotation form. */
export function publicQuoteForm(
  search: Search,
  vehicle: Pick<PublicVehicleRow, "id" | "bodyType" | "category">,
  fuelPrices: QuoteForm["fuelPrices"],
  purpose: FormPurpose,
  extra: { clientId?: string | null; details?: Details | null; reference?: string | null } = {},
): QuoteForm {
  const base = newQuoteForm("formal", fuelPrices);
  const { category } = publicCategory(vehicle);
  const d = extra.details ?? null;
  const method = search.paymentMethod;
  const form: QuoteFormInput = {
    ...base,
    service: search.service,
    clientId: extra.clientId ?? null,
    clientName: d?.fullName ?? "",
    repeat: purpose === "public_price" ? "repeat" : "auto",
    vehicleId: vehicle.id,
    bodyType: vehicle.bodyType ?? "sedan",
    category,
    startDate: search.startDate,
    startTime: search.startTime,
    endDate: search.service === "self_drive" ? search.endDate! : search.startDate,
    endTime: search.service === "self_drive" ? search.endTime! : search.wdEndTime!,
    destination: search.destination,
    notes: d ? draftNotes(search, d, extra.reference ?? null) : "",
    scheduleMode: "auto",
    otPremiumSlot: "auto",
    deliveryFee: 0,
    pickupFee: 0,
    includeFuel: true,
    oneWayDistanceKm: search.service === "with_driver" ? search.oneWayKm : 0,
    rentalMethod: method,
    reservationMethod: method,
    depositMethod: method,
    wdDays: search.wdDays,
    package: search.package,
    drivingTerm: search.drivingTerm,
    serviceArea: search.serviceArea,
    pickupPlace: search.service === "with_driver" ? (d?.pickupAddress ?? "") : "",
    dropoffPlace: search.service === "with_driver" ? (d?.dropoffAddress ?? "") : "",
    itinerary: search.service === "with_driver" ? (d?.itinerary ?? "") : "",
  };
  return quoteFormSchema.parse(form);
}

/** Internal notes on the draft: everything the client typed that the form has no field for. */
export function draftNotes(search: Search, d: Details, reference: string | null): string {
  const rows: [string, string | number | null | undefined][] = [
    ["Website request", reference],
    ...(search.service === "self_drive"
      ? ([
          ["Delivery address (fee to be confirmed)", d.deliveryAddress],
          ["Pick-up address at return (fee to be confirmed)", d.pickupAddress],
        ] as [string, string][])
      : ([
          ["Passengers", d.passengers || null],
          ["Luggage", d.luggage],
          ["Approx. one-way km (client estimate)", search.oneWayKm || null],
        ] as [string, string | number | null][])),
    ["Driver's license no.", d.driversLicenseNo],
    ["IDs to present", d.idsPresented.join(", ")],
    ["Payment preference", search.paymentMethod],
    ["Special requests", d.specialRequests],
  ];
  return rows
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

/** Booking fields copied from a request when its quotation becomes a booking. */
export function bookingFieldsFromRequest(search: Search, d: Details) {
  const wd = search.service === "with_driver";
  const itinerary = wd ? [d.dropoffAddress ? `Drop-off: ${d.dropoffAddress}` : "", d.itinerary].filter(Boolean).join("\n") : "";
  return {
    deliveryAddress: wd ? null : d.deliveryAddress || null,
    pickupAddress: d.pickupAddress || null,
    passengers: wd && d.passengers > 0 ? d.passengers : null,
    luggage: wd ? d.luggage || null : null,
    itinerary: itinerary || null,
    driversLicenseNo: d.driversLicenseNo || null,
    idsPresented: d.idsPresented.filter((t) => (ID_TYPES as readonly string[]).includes(t)),
    sourceChannel: "website" as const,
  };
}

// ---------------------------------------------------------------------------
// Engine result → public view
// ---------------------------------------------------------------------------

type Result = SelfDriveResult | WithDriverResult;

const toLine = (l: { label: string; remark: string; amount: number }): PublicLine => ({ label: l.label, remark: l.remark || null, amount: l.amount });

/** Total shown for a car: Self-Drive rental total, With Driver grand total (same as `total_centavos`). */
export function publicTotal(r: Result): number {
  return r.service === "self_drive" ? r.total : r.grandTotal;
}

export function publicBreakdown(r: Result): { lines: PublicLine[]; discounts: PublicLine[]; payable: PublicLine[] } {
  const lines = r.lines.map(toLine);
  const discounts = r.discounts.map(toLine);
  const payable: PublicLine[] = [];
  if (r.service === "self_drive") {
    const p = r.payable;
    payable.push({ label: "Rental total", remark: null, amount: r.total });
    if (p.terminalFees.rental) payable.push({ label: "Card terminal fee (rental)", remark: "3.5%", amount: p.terminalFees.rental });
    payable.push({ label: "Refundable security deposit", remark: null, amount: p.deposit });
    if (p.terminalFees.deposit) payable.push({ label: "Card terminal fee (deposit)", remark: "3.5%", amount: p.terminalFees.deposit });
    payable.push({ label: "Reservation fee (to confirm)", remark: "part of the total", amount: p.reservationFee });
    if (p.terminalFees.reservation) payable.push({ label: "Card terminal fee (reservation)", remark: "3.5%", amount: p.terminalFees.reservation });
    payable.push({ label: "Total contract value", remark: null, amount: p.totalContractValue });
  } else {
    payable.push({ label: "Total", remark: null, amount: r.total });
    if (r.terminalFees.rental) payable.push({ label: "Card terminal fee", remark: "3.5%", amount: r.terminalFees.rental });
    if (r.terminalFees.reservation) payable.push({ label: "Card terminal fee (reservation)", remark: "3.5%", amount: r.terminalFees.reservation });
    payable.push({ label: "Reservation fee (to confirm)", remark: "part of the total", amount: r.payable.reservationFee });
    payable.push({ label: "Grand total", remark: null, amount: r.grandTotal });
  }
  return { lines, discounts, payable };
}

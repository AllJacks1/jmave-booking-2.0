"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon, CarIcon, CheckCircle2Icon, Loader2Icon, UserRoundIcon, UsersIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import type { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { ID_TYPES } from "@/lib/bookings/constants";
import { DRIVING_TERM_LABELS, WD_PACKAGE_LABELS } from "@/lib/pricing/inputs";
import { SERVICE_AREA_LABELS, type PaymentMethod } from "@/lib/pricing/types";
import { sessionAttribution } from "@/lib/public/attribution";
import {
  detailsSchema,
  searchSchema,
  type Details,
  type PublicPriceDetail,
  type PublicVehicle,
  type QuoteResponse,
  type Search,
  type SubmitResponse,
} from "@/lib/public/schema";
import { DRIVERS_LICENSE_LABELS, DRIVERS_LICENSE_TYPES } from "@/lib/rework/options";
import { PChecks, PField, PSelect, PTextarea } from "./fields";
import { Turnstile } from "./turnstile";

type Step = "service" | "when" | "cars" | "details" | "summary" | "done";

export type BusinessContact = { name: string; mobile: string; landline: string; email: string; address: string };

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });
const fmt = (centavos: number) => peso.format(centavos / 100);
const dt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "gcash", label: "GCash" },
  { value: "bank", label: "Bank transfer" },
  { value: "card", label: "Card (+3.5% terminal fee)" },
];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 ? "30" : "00";
  const value = `${String(h).padStart(2, "0")}:${m}`;
  const label = `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
  return { value, label };
});

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as T | null;
  if (!json) throw new Error("Network error");
  return json;
}

function addDays(dateKey: string, n: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function BookingWizard({ siteKey, business, embed, today }: { siteKey: string | null; business: BusinessContact; embed: boolean; today: string }) {
  const [step, setStep] = useState<Step>("service");
  const [search, setSearch] = useState<Search | null>(null);
  const [cars, setCars] = useState<PublicVehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [detail, setDetail] = useState<PublicPriceDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState("");
  const [reference, setReference] = useState<string | null>(null);
  const honeypot = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);

  const searchForm = useForm<z.input<typeof searchSchema>, unknown, Search>({
    resolver: zodResolver(searchSchema),
    defaultValues: {
      service: "self_drive",
      startDate: addDays(today, 1),
      startTime: "09:00",
      endDate: addDays(today, 2),
      endTime: "09:00",
      wdEndTime: "17:00",
      wdDays: 1,
      package: "round_trip",
      drivingTerm: "back_and_forth",
      serviceArea: "within_davao_city",
      oneWayKm: 0,
      destination: "",
      paymentMethod: "cash",
    },
  });
  const detailsForm = useForm<z.input<typeof detailsSchema>, unknown, Details>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { fullName: "", phone: "", email: "", birthday: "", idsPresented: [], driversLicenseType: "", passengers: 0 },
  });
  const service = useWatch({ control: searchForm.control, name: "service" });

  // Capture attribution on the first visit of the session.
  useEffect(() => {
    sessionAttribution();
  }, []);

  // Embedded: tell the parent page our height (auto-resizing iframe).
  useEffect(() => {
    if (!embed || window.parent === window) return;
    const send = () => window.parent.postMessage({ type: "jmave-book:height", height: document.documentElement.scrollHeight }, "*");
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    send();
    return () => ro.disconnect();
  }, [embed]);

  const go = useCallback(
    (s: Step) => {
      setError(null);
      setStep(s);
      if (embed && window.parent !== window) window.parent.postMessage({ type: "jmave-book:top" }, "*");
      else top.current?.scrollIntoView({ block: "start" });
    },
    [embed],
  );

  function applyServerErrors(fieldErrors: Record<string, string[]> | undefined) {
    let target: Step | null = null;
    for (const [k, msgs] of Object.entries(fieldErrors ?? {})) {
      if (k.startsWith("details.")) {
        detailsForm.setError(k.slice(8) as FieldPath<z.input<typeof detailsSchema>>, { message: msgs[0] });
        target ??= "details";
      } else if (k.startsWith("search.") || k in searchSchema.def.shape) {
        searchForm.setError((k.startsWith("search.") ? k.slice(7) : k) as FieldPath<z.input<typeof searchSchema>>, { message: msgs[0] });
        target = "when";
      }
    }
    return target;
  }

  async function findCars(s: Search) {
    setBusy(true);
    setError(null);
    try {
      const r = await post<QuoteResponse>("/api/public/quote", { search: s });
      if (!r.ok) {
        applyServerErrors(r.fieldErrors);
        setError(r.error);
        return;
      }
      setSearch(s);
      setCars(r.vehicles);
      setVehicleId(null);
      go("cars");
    } catch {
      setError("We could not reach the booking service. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function loadSummary(d: Details, method: PaymentMethod) {
    if (!search || !vehicleId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<QuoteResponse>("/api/public/quote", { search: { ...search, paymentMethod: method }, vehicleId });
      if (!r.ok || !r.detail) {
        setError(r.ok ? "Sorry, that car is no longer available for these dates." : r.error);
        if (!r.ok && r.error.includes("no longer available")) go("cars");
        return;
      }
      setDetails(d);
      setDetail(r.detail);
      go("summary");
    } catch {
      setError("We could not reach the booking service. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }


  async function submit() {
    if (!search || !vehicleId || !details) return;
    if (!consent) {
      setError("Please agree to the privacy notice.");
      return;
    }
    if (siteKey && !token) {
      setError("Please complete the security check.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await post<SubmitResponse>("/api/public/inquiries", {
        search: { ...search, paymentMethod: payment },
        vehicleId,
        details,
        consent: true,
        turnstileToken: token,
        website: honeypot.current?.value ?? "",
        attribution: sessionAttribution(),
      });
      if (!r.ok) {
        const target = applyServerErrors(r.fieldErrors);
        setError(r.error);
        setToken("");
        setTurnstileKey((k) => k + 1);
        if (target) go(target);
        if (r.fieldErrors?.vehicleId) go("cars");
        return;
      }
      setReference(r.reference);
      go("done");
    } catch {
      setError("We could not send your request. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const car = cars?.find((c) => c.id === vehicleId) ?? null;
  const stepNo = { service: 1, when: 2, cars: 3, details: 4, summary: 5, done: 6 }[step];

  return (
    <div ref={top} className="mx-auto flex w-full max-w-2xl scroll-mt-4 flex-col gap-5" data-testid="booking-wizard">
      {step !== "done" ? (
        <div className="flex items-center gap-3">
          {step !== "service" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => go(({ when: "service", cars: "when", details: "cars", summary: "details" } as Record<string, Step>)[step])}
            >
              <ArrowLeftIcon /> Back
            </Button>
          ) : null}
          <p className="ml-auto text-sm text-muted-foreground">Step {stepNo} of 5</p>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {step === "service" ? (
        <section className="flex flex-col gap-4">
          <h1 className="text-2xl font-bold tracking-tight">Book a car</h1>
          <p className="text-muted-foreground">Check available cars and prices for your dates, then send us a booking request.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["self_drive", "Self-Drive", "You drive. Pick up or have it delivered.", UserRoundIcon],
                ["with_driver", "With Driver", "Our driver takes you where you need to go.", UsersIcon],
              ] as const
            ).map(([value, title, text, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  searchForm.setValue("service", value);
                  go("when");
                }}
                className="flex min-h-28 flex-col items-start gap-1 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Icon className="size-6 text-primary" aria-hidden />
                <span className="text-lg font-semibold">{title}</span>
                <span className="text-sm text-muted-foreground">{text}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === "when" ? (
        <form onSubmit={(e) => void searchForm.handleSubmit(findCars)(e)} noValidate className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">{service === "self_drive" ? "When do you need the car?" : "When is your trip?"}</h2>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <PField control={searchForm.control} name="startDate" label={service === "self_drive" ? "Pick-up date" : "Trip date"} type="date" min={today} />
            <PSelect control={searchForm.control} name="startTime" label={service === "self_drive" ? "Pick-up time" : "Start time"} options={TIME_OPTIONS} />
            {service === "self_drive" ? (
              <>
                <PField control={searchForm.control} name="endDate" label="Return date" type="date" min={today} />
                <PSelect control={searchForm.control} name="endTime" label="Return time" options={TIME_OPTIONS} />
                <div className="sm:col-span-2">
                  <PField control={searchForm.control} name="destination" label="Where will you drive? (optional)" placeholder="e.g. Davao City, Samal" />
                </div>
              </>
            ) : (
              <>
                <PSelect control={searchForm.control} name="wdEndTime" label="End time (each day)" options={TIME_OPTIONS} />
                <PField control={searchForm.control} name="wdDays" label="Number of days" type="number" inputMode="numeric" min={1} max={30} number />
                <div className="sm:col-span-2">
                  <PField control={searchForm.control} name="destination" label="Destination" placeholder="e.g. Tagum City" />
                </div>
                <PSelect control={searchForm.control} name="package" label="Trip type" options={Object.entries(WD_PACKAGE_LABELS).map(([value, label]) => ({ value, label }))} />
                <PSelect
                  control={searchForm.control}
                  name="drivingTerm"
                  label="Should the driver wait?"
                  options={Object.entries(DRIVING_TERM_LABELS).map(([value, label]) => ({
                    value,
                    label: value === "long_term_parking" ? `Yes – stays at the destination (${label.toLowerCase()})` : `No – ${label.toLowerCase()}`,
                  }))}
                />
                <PSelect control={searchForm.control} name="serviceArea" label="Area" options={Object.entries(SERVICE_AREA_LABELS).map(([value, label]) => ({ value, label }))} />
                <PField
                  control={searchForm.control}
                  name="oneWayKm"
                  label="Approx. one-way distance in km (optional)"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  placeholder="Not sure? Leave blank"
                  number
                />
              </>
            )}
          </FieldGroup>
          <Button type="submit" size="lg" disabled={busy} className="h-12 text-base">
            {busy ? <Loader2Icon className="animate-spin" /> : <CarIcon />} Show available cars
          </Button>
        </form>
      ) : null}

      {step === "cars" && cars ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Available cars</h2>
          <WhenSummary search={search} />
          {cars.length === 0 ? (
            <Alert>
              <AlertDescription>
                No cars are free for these dates. Try other dates, or call {business.mobile} – we may still be able to help.
              </AlertDescription>
            </Alert>
          ) : (
            <ul className="flex flex-col gap-3" data-testid="car-list">
              {cars.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    data-testid="car-option"
                    onClick={() => {
                      setVehicleId(c.id);
                      go("details");
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <CarIcon className="size-8 shrink-0 text-primary" aria-hidden />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold">{c.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {[c.category ? `${c.bodyType} · ${c.category}` : c.bodyType, c.transmission, c.seats ? `${c.seats} seats` : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="flex flex-col items-end">
                      <span className="text-lg font-bold" data-testid="car-price">
                        {fmt(c.total)}
                      </span>
                      <span className="text-xs text-muted-foreground">for your dates</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted-foreground">New clients get 5% off — applied on your formal quotation.</p>
        </section>
      ) : null}

      {step === "details" && car ? (
        <form onSubmit={(e) => void detailsForm.handleSubmit((d) => loadSummary(d, payment))(e)} noValidate className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Your details</h2>
          <p className="text-sm text-muted-foreground">
            {car.name} · {fmt(car.total)}
          </p>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <PField control={detailsForm.control} name="fullName" label="Full name" autoComplete="name" />
            </div>
            <PField control={detailsForm.control} name="phone" label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" placeholder="0917 123 4567" />
            <PField control={detailsForm.control} name="email" label="Email (optional)" type="email" autoComplete="email" />
            <PField control={detailsForm.control} name="birthday" label="Birthday (optional)" type="date" autoComplete="bday" />
            <PField control={detailsForm.control} name="companyName" label="Company (optional)" autoComplete="organization" />
            <div className="sm:col-span-2">
              <PField control={detailsForm.control} name="address" label="Home address (optional)" autoComplete="street-address" />
            </div>
            <PField control={detailsForm.control} name="altContactName" label="Alternative contact person (optional)" />
            <PField control={detailsForm.control} name="altContactPhone" label="Their number (optional)" type="tel" inputMode="tel" />
            {service === "self_drive" ? (
              <>
                <PField control={detailsForm.control} name="driversLicenseNo" label="Driver's license no. (optional)" />
                <PSelect
                  control={detailsForm.control}
                  name="driversLicenseType"
                  label="License type"
                  options={[{ value: "", label: "—" }, ...DRIVERS_LICENSE_TYPES.map((t) => ({ value: t, label: DRIVERS_LICENSE_LABELS[t] }))]}
                />
                <div className="sm:col-span-2">
                  <PField control={detailsForm.control} name="deliveryAddress" label="Deliver the car to (optional)" description="Leave blank to pick up at our office. Delivery fee to be confirmed." />
                </div>
                <div className="sm:col-span-2">
                  <PField control={detailsForm.control} name="pickupAddress" label="Collect the car at return from (optional)" description="Leave blank to return at our office. Pick-up fee to be confirmed." />
                </div>
              </>
            ) : (
              <>
                <div className="sm:col-span-2">
                  <PField control={detailsForm.control} name="pickupAddress" label="Pick-up place" />
                </div>
                <div className="sm:col-span-2">
                  <PField control={detailsForm.control} name="dropoffAddress" label="Drop-off place" />
                </div>
                <PField control={detailsForm.control} name="passengers" label="Passengers" type="number" inputMode="numeric" min={0} number placeholder="e.g. 4" />
                <PField control={detailsForm.control} name="luggage" label="Luggage (optional)" placeholder="e.g. 2 big bags" />
                <div className="sm:col-span-2">
                  <PTextarea control={detailsForm.control} name="itinerary" label="Itinerary / route plan (optional)" />
                </div>
              </>
            )}
            <div className="sm:col-span-2">
              <PChecks control={detailsForm.control} name="idsPresented" label="IDs you can present (optional)" options={ID_TYPES} />
            </div>
            <div className="sm:col-span-2 flex flex-col gap-2">
              <label htmlFor="paymentPreference" className="text-sm font-medium">
                Payment preference
              </label>
              <select
                id="paymentPreference"
                value={payment}
                onChange={(e) => setPayment(e.target.value as PaymentMethod)}
                className="h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base md:h-10 md:text-sm dark:bg-input/30"
              >
                {PAYMENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <PTextarea control={detailsForm.control} name="specialRequests" label="Special requests (optional)" />
            </div>
          </FieldGroup>
          {/* Honeypot: hidden from people and screen readers; bots fill it. */}
          <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
            <label htmlFor="website">Website</label>
            <input ref={honeypot} id="website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
          </div>
          <Button type="submit" size="lg" disabled={busy} className="h-12 text-base">
            {busy ? <Loader2Icon className="animate-spin" /> : null} Review request
          </Button>
        </form>
      ) : null}

      {step === "summary" && detail && details ? (
        <section className="flex flex-col gap-4" data-testid="summary">
          <h2 className="text-xl font-semibold">Review and send</h2>
          <div className="rounded-xl border bg-card p-4">
            <p className="font-semibold">{detail.name}</p>
            <p className="text-sm text-muted-foreground">
              {dt.format(new Date(detail.startAt))} → {dt.format(new Date(detail.endAt))}
            </p>
            <p className="text-sm text-muted-foreground">
              {details.fullName} · {details.phone}
            </p>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {[...detail.lines, ...detail.discounts].map((l, i) => (
                  <tr key={i} className="border-t first:border-t-0">
                    <td className="py-1.5 pr-2">
                      {l.label}
                      {l.remark ? <span className="block text-xs text-muted-foreground">{l.remark}</span> : null}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(l.amount)}</td>
                  </tr>
                ))}
                {details.deliveryAddress || (service === "self_drive" && details.pickupAddress) ? (
                  <tr className="border-t">
                    <td className="py-1.5 pr-2">{details.deliveryAddress ? "Delivery fee" : "Pick-up fee"}</td>
                    <td className="py-1.5 text-right text-muted-foreground">to be confirmed</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <table className="mt-3 w-full border-t-2 text-sm">
              <tbody>
                {detail.payable.map((l, i) => (
                  <tr key={i} className={l.label.startsWith("Total contract") || l.label === "Grand total" ? "font-bold" : ""}>
                    <td className="py-1 pr-2">
                      {l.label}
                      {l.remark ? <span className="text-xs font-normal text-muted-foreground"> ({l.remark})</span> : null}
                    </td>
                    <td className="py-1 text-right tabular-nums" data-testid={l.label === "Grand total" || l.label.startsWith("Total contract") ? "summary-total" : undefined}>
                      {fmt(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            <li>New clients get 5% off — applied on your formal quotation.</li>
            {service === "with_driver" ? <li>Distance-based charges (driver&apos;s fee band, fuel) are confirmed on your formal quotation.</li> : null}
            <li>This is a request, not a confirmed booking. The car is reserved only after we confirm and the reservation fee is paid.</li>
          </ul>
          <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-5 accent-primary" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="consent" />
            <span>
              I agree that {business.name} may use my details to process this request, as described in the{" "}
              <a href="/book/privacy" target="_blank" rel="noopener" className="font-medium text-primary underline">
                privacy notice
              </a>{" "}
              (Data Privacy Act of 2012, RA 10173).
            </span>
          </label>
          {siteKey ? <Turnstile key={turnstileKey} siteKey={siteKey} onToken={setToken} /> : null}
          <Button type="button" size="lg" disabled={busy} onClick={submit} className="h-12 text-base">
            {busy ? <Loader2Icon className="animate-spin" /> : null} Send booking request
          </Button>
        </section>
      ) : null}

      {step === "done" && reference ? (
        <section className="flex flex-col items-center gap-3 py-6 text-center" data-testid="thank-you">
          <CheckCircle2Icon className="size-12 text-primary" aria-hidden />
          <h2 className="text-2xl font-bold">Request sent</h2>
          <p>
            Your request reference is <strong data-testid="request-reference">{reference}</strong>.
          </p>
          <p className="text-muted-foreground">We will send your formal quotation soon. For anything urgent, contact us:</p>
          <ContactList business={business} />
        </section>
      ) : null}
    </div>
  );
}

function WhenSummary({ search }: { search: Search | null }) {
  if (!search) return null;
  const s = search;
  const text =
    s.service === "self_drive"
      ? `Self-Drive · ${s.startDate} ${s.startTime} → ${s.endDate} ${s.endTime}`
      : `With Driver · ${s.startDate}, ${s.startTime}–${s.wdEndTime} · ${s.wdDays} day${s.wdDays > 1 ? "s" : ""} · ${s.destination}`;
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

export function ContactList({ business }: { business: BusinessContact }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      <li>
        Mobile: <a className="font-medium text-primary" href={`tel:${business.mobile.replace(/\s/g, "")}`}>{business.mobile}</a>
      </li>
      <li>
        Landline: <a className="font-medium text-primary" href={`tel:${business.landline.replace(/[^\d+]/g, "")}`}>{business.landline}</a>
      </li>
      <li>
        Email: <a className="font-medium text-primary" href={`mailto:${business.email}`}>{business.email}</a>
      </li>
      <li className="text-muted-foreground">{business.address}</li>
    </ul>
  );
}

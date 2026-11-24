"use client";

import { ClipboardCopyIcon, FileDownIcon, FileTextIcon, Loader2Icon, SaveIcon, SendIcon, TriangleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Controller, useForm, useWatch, type Control, type FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { NumberField, PesoField, SwitchField, TextareaField, TextField } from "@/components/form-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  BODY_CATEGORIES,
  BODY_TYPE_LABELS,
  BODY_TYPES,
  CATEGORY_LABELS,
  DRIVER_RATE_MODE_LABELS,
  DRIVING_TERM_LABELS,
  OT_SLOT_LABELS,
  PRICING_BASIS_LABELS,
  SD_PROMO_LABELS,
  SERVICE_AREA_LABELS,
  WD_PACKAGE_LABELS,
  type BodyType,
} from "@/lib/pricing";
import { fmtPeso, printedLabel, quoteText, sdPayable, totalsFor, type QuoteDoc } from "@/lib/quotes/document";
import type { QuoteFormInput } from "@/lib/quotes/schema";
import type { PricePreview } from "@/lib/quotes/service";
import { cn } from "@/lib/utils";
import { AvailabilityNote } from "@/components/bookings/availability-note";
import { issueQuotationAction, previewPriceAction, saveDraftAction, saveQuickAction } from "./actions";
import { ClientPicker, type PickedClient } from "./client-picker";

export type VehicleOption = { id: string; displayName: string; plate: string | null; bodyType: BodyType | null };

type Props = {
  mode: "quick" | "formal";
  id: string | null;
  initial: QuoteFormInput;
  vehicles: VehicleOption[];
  initialClient: PickedClient | null;
  canOverrideBlacklist: boolean;
  businessName: string;
  /** Saved quick quotation's validity (for the copy text). */
  validUntil?: string | null;
  revisedFromNumber?: string | null;
};

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "gcash", label: "GCash" },
  { value: "card", label: "Card (+3.5%)" },
  { value: "bank", label: "Bank transfer" },
];
const opts = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));
const NONE = "__none__";

export function QuoteEditor(props: Props) {
  const { mode, vehicles, canOverrideBlacklist, businessName } = props;
  const router = useRouter();
  const form = useForm<QuoteFormInput>({ defaultValues: props.initial });
  const { control, setValue, getValues } = form;
  const values = useWatch({ control }) as QuoteFormInput;
  const service = values.service;
  const [client, setClient] = useState<PickedClient | null>(props.initialClient);
  const [preview, setPreview] = useState<PricePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** Form state the panel currently shows; differs from `key` while pricing. */
  const [pricedKey, setPricedKey] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(props.id);
  const idRef = useRef<string | null>(props.id);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [validUntil, setValidUntil] = useState<string | null>(props.validUntil ?? null);
  const key = JSON.stringify(values);
  const pricing = pricedKey !== key;

  // Live price: debounced server call (the UI never computes prices).
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await previewPriceAction(getValues());
      if (n !== seq.current) return;
      setPricedKey(key);
      if (r.ok) {
        setPreview(r.data);
        setPreviewError(r.data.error);
        if (r.data.client) setClient((c) => (c && c.id === r.data.client!.id ? { ...c, ...r.data.client!, isRepeat: r.data.client!.isRepeat } : c));
      } else {
        setPreview(null);
        setPreviewError(Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [key, getValues]);

  // Formal: draft autosave.
  const first = useRef(true);
  useEffect(() => {
    if (mode !== "formal") return;
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => void saveDraftNow(), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode]);

  async function saveDraftNow(): Promise<string | null> {
    setSaving(true);
    const r = await saveDraftAction({ id: idRef.current, form: getValues() });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.status === 409 ? r.error : `Draft not saved: ${r.error}`);
      return null;
    }
    if (!idRef.current) {
      idRef.current = r.data.id;
      setId(r.data.id);
      window.history.replaceState(null, "", `/quotes/${r.data.id}`);
    }
    setSavedAt(new Date(r.data.savedAt).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }));
    return r.data.id;
  }

  async function saveQuickNow(): Promise<{ id: string } | null> {
    const r = await saveQuickAction({ id: idRef.current, form: getValues() });
    if (!r.ok) {
      toast.error(r.error);
      return null;
    }
    if (!idRef.current) {
      idRef.current = r.data.id;
      setId(r.data.id);
      window.history.replaceState(null, "", `/quotes/${r.data.id}`);
    }
    setValidUntil(r.data.validUntil);
    return r.data;
  }

  async function run(label: string, f: () => Promise<void>) {
    setBusy(label);
    try {
      await f();
    } finally {
      setBusy(null);
    }
  }

  const downloadPdf = () =>
    run("pdf", async () => {
      const saved = await saveQuickNow();
      if (!saved) return;
      const a = document.createElement("a");
      a.href = `/api/quotations/${saved.id}/pdf`;
      a.download = "";
      a.click();
    });

  const saveQuick = () =>
    run("save", async () => {
      if (await saveQuickNow()) toast.success("Estimate saved");
    });

  const makeFormal = () =>
    run("formal", async () => {
      const r = await saveDraftAction({ id: null, form: { ...getValues(), clientName: "", repeat: "auto" } });
      if (!r.ok) return void toast.error(r.error);
      router.push(`/quotes/${r.data.id}`);
    });

  const copyText = async () => {
    if (!preview?.result || !preview.startAt || !preview.endAt) return;
    const doc = {
      number: null,
      kind: mode,
      service: values.service,
      startAt: new Date(preview.startAt),
      endAt: new Date(preview.endAt),
      validUntil: validUntil ? new Date(validUntil) : null,
      business: { name: businessName },
      vehicleLabel: preview.vehicleLabel ?? "",
      result: preview.result,
    } as unknown as QuoteDoc;
    await navigator.clipboard.writeText(quoteText(doc));
    toast.success("Copied. Paste it into Messenger or WhatsApp.");
  };

  async function issue(overrideReason = "") {
    await run("issue", async () => {
      const draftId = idRef.current ?? (await saveDraftNow());
      if (!draftId) return;
      const r = await issueQuotationAction({ id: draftId, form: getValues(), overrideReason });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setOverrideOpen(false);
      toast.success(`Issued ${r.data.number}`);
      router.replace(`/quotes/${draftId}`);
      router.refresh();
    });
  }

  const blacklisted = client?.isBlacklisted ?? false;
  const vehicle = vehicles.find((v) => v.id === values.vehicleId) ?? null;
  const bodyType = (vehicle?.bodyType ?? values.bodyType) as BodyType;
  const cats = BODY_CATEGORIES[bodyType];

  // Keep the category valid for the body type.
  useEffect(() => {
    const c = getValues("category");
    if (cats.length === 0 && c !== null) setValue("category", null);
    if (cats.length > 0 && (!c || !cats.includes(c))) setValue("category", cats.includes("primo") ? "primo" : cats[0]);
  }, [bodyType, cats, getValues, setValue]);

  const sd = service === "self_drive";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()} noValidate>
        {props.revisedFromNumber ? (
          <Alert>
            <AlertTitle>Revision of {props.revisedFromNumber}</AlertTitle>
            <AlertDescription>Issuing this gives it a new number and cancels {props.revisedFromNumber}.</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Service and vehicle</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label>Service</Label>
              <div className="inline-flex w-fit rounded-md border p-0.5" role="radiogroup" aria-label="Service">
                {(["self_drive", "with_driver"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={service === s}
                    onClick={() => setValue("service", s)}
                    className={cn(
                      "rounded px-3 py-1.5 text-sm",
                      service === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s === "self_drive" ? "Self-Drive" : "With Driver"}
                  </button>
                ))}
              </div>
            </div>
            <Choice
              control={control}
              name="vehicleId"
              label="Vehicle"
              noneLabel="Any (by body type)"
              options={vehicles.map((v) => ({ value: v.id, label: `${v.displayName}${v.plate ? ` · ${v.plate}` : ""}` }))}
              description="Optional until booking."
            />
            {mode === "formal" && values.vehicleId ? <AvailabilityNote availability={preview?.availability ?? null} /> : null}
            <Choice
              control={control}
              name="bodyType"
              label="Body type"
              disabled={!!vehicle?.bodyType}
              options={BODY_TYPES.map((b) => ({ value: b, label: BODY_TYPE_LABELS[b] }))}
              display={vehicle?.bodyType ?? undefined}
            />
            <Choice
              control={control}
              name="category"
              label="Category"
              disabled={cats.length === 0}
              options={cats.map((c) => ({ value: c, label: !sd && c === "budgetmile" ? "Regular (Budgetmile)" : CATEGORY_LABELS[c] }))}
              noneLabel={cats.length === 0 ? "Standard" : undefined}
            />
            {mode === "quick" ? (
              <TextField control={control} name="clientName" label="Client name (optional)" autoComplete="off" />
            ) : null}
          </CardContent>
        </Card>

        {mode === "formal" ? (
          <Card>
            <CardHeader>
              <CardTitle>Client</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <ClientPicker
                  value={client}
                  onChange={(c) => {
                    setClient(c);
                    setValue("clientId", c?.id ?? null);
                  }}
                />
              </div>
              {blacklisted ? (
                <Alert variant="destructive" className="sm:col-span-2" data-testid="blacklist-warning">
                  <TriangleAlertIcon />
                  <AlertTitle>This client is blacklisted</AlertTitle>
                  <AlertDescription>
                    {client?.blacklistReason ? `Reason: ${client.blacklistReason}. ` : ""}
                    {canOverrideBlacklist
                      ? "You can issue only with a reason, which is recorded."
                      : "Issuing is blocked. Ask an Admin to review."}
                  </AlertDescription>
                </Alert>
              ) : null}
              <Choice
                control={control}
                name="repeat"
                label="Repeat / new client"
                options={[
                  { value: "auto", label: client ? `From history (${client.isRepeat ? "repeat" : "new"})` : "From history" },
                  { value: "repeat", label: "Repeat client" },
                  { value: "new", label: "New client (5% discount)" },
                ]}
                description={sd ? "New clients get the 5% new-client discount." : undefined}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-0">
              <Controller
                control={control}
                name="repeat"
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <input
                      id="repeat-client"
                      type="checkbox"
                      className="size-4"
                      checked={field.value === "repeat"}
                      onChange={(e) => field.onChange(e.target.checked ? "repeat" : "new")}
                    />
                    <FieldLabel htmlFor="repeat-client" className="font-normal">
                      Repeat client (no 5% new-client discount)
                    </FieldLabel>
                  </Field>
                )}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{sd ? "Schedule and area" : "Trip"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <TextField control={control} name="startDate" label={sd ? "Release date" : "Pick-up date"} type="date" />
            <TextField control={control} name="startTime" label={sd ? "Release time" : "Pick-up time"} type="time" />
            {sd ? (
              <>
                <TextField control={control} name="endDate" label="Return date" type="date" />
                <TextField control={control} name="endTime" label="Return time" type="time" />
              </>
            ) : (
              <>
                <TextField control={control} name="endTime" label="End time (each day)" type="time" />
                <NumberField control={control} name="wdDays" label="Days" />
              </>
            )}
            {sd && mode === "formal" ? <TextField control={control} name="areaFrom" label="Area of use: from" /> : null}
            <TextField control={control} name="destination" label={sd ? (mode === "formal" ? "Area of use: to (destination)" : "Destination") : "Destination / service area"} />
            {!sd && mode === "formal" ? (
              <>
                <TextField control={control} name="pickupPlace" label="Pick-up place" />
                <TextField control={control} name="dropoffPlace" label="Drop-off place" />
                <div className="sm:col-span-2">
                  <TextareaField control={control} name="itinerary" label="Itinerary" rows={2} />
                </div>
              </>
            ) : null}
            {sd && mode === "formal" ? (
              <>
                <Choice
                  control={control}
                  name="scheduleMode"
                  label="Days and hours"
                  options={[
                    { value: "auto", label: "From dates" },
                    { value: "manual", label: "Set by hand" },
                  ]}
                  description={
                    preview?.schedule && values.scheduleMode === "auto"
                      ? `${preview.schedule.days} day(s), ${preview.schedule.hoursTier}h${preview.schedule.additionalHoursBlock ? ` + ${preview.schedule.additionalHoursBlock}h block` : ""}`
                      : undefined
                  }
                />
                {values.scheduleMode === "manual" ? (
                  <>
                    <NumberField control={control} name="days" label="Days" />
                    <Choice control={control} name="hoursTier" label="Hours" parse={Number} options={[24, 12, 8].map((h) => ({ value: String(h), label: `${h} hours` }))} />
                    <Choice control={control} name="additionalHoursBlock" label="Additional hours block" parse={Number} noneLabel="None" options={[8, 12].map((h) => ({ value: String(h), label: `${h} hours` }))} />
                  </>
                ) : null}
                <NumberField control={control} name="extensionHours" label="Hourly extension (hours)" />
                <Choice
                  control={control}
                  name="otPremiumSlot"
                  label="OT premium"
                  options={[{ value: "auto", label: `From times${preview?.schedule ? ` (${OT_SLOT_LABELS[preview.schedule.otSlot]})` : ""}` }, ...opts(OT_SLOT_LABELS)]}
                />
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{mode === "quick" ? "Key extras" : "Charges"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <NumberField control={control} name="oneWayDistanceKm" label="One-way distance (km)" step="0.1" />
            {sd ? (
              <>
                <PesoField control={control} name="deliveryFee" label="Delivery fee (₱)" emptyAs={0} />
                {mode === "formal" ? <PesoField control={control} name="pickupFee" label="Pick-up fee (₱)" emptyAs={0} /> : null}
                <div className="flex flex-col gap-3 sm:col-span-2">
                  <SwitchField control={control} name="withCdw" label="With CDW" />
                  {mode === "formal" ? (
                    <>
                      <SwitchField control={control} name="includeFuel" label="Include estimated fuel" />
                      <SwitchField control={control} name="beyondOperatingHours" label="Beyond operating hours (10:01 PM – 5:29 AM)" />
                      <SwitchField control={control} name="sevenDayDiscount" label="7-day discount" />
                    </>
                  ) : null}
                </div>
                {mode === "formal" ? <Choice control={control} name="promo" label="Promo" options={opts(SD_PROMO_LABELS)} /> : null}
              </>
            ) : (
              <>
                <Choice control={control} name="pricingBasis" label="Pricing basis" options={opts(PRICING_BASIS_LABELS)} />
                {mode === "formal" ? (
                  <>
                    <Choice control={control} name="package" label="Trip type" options={opts(WD_PACKAGE_LABELS)} />
                    <Choice control={control} name="drivingTerm" label="Driving term" options={opts(DRIVING_TERM_LABELS)} />
                    <Choice control={control} name="driverRateMode" label="Driver rate" options={opts(DRIVER_RATE_MODE_LABELS)} />
                    <Choice control={control} name="wdAdditionalHoursBlock" label="Additional hours block" parse={Number} noneLabel="None" options={[8, 12].map((h) => ({ value: String(h), label: `${h} hours` }))} />
                    <Choice control={control} name="serviceArea" label="Service area (15+ days)" options={opts(SERVICE_AREA_LABELS)} />
                    <Choice
                      control={control}
                      name="event"
                      label="Event"
                      options={[
                        { value: "auto", label: "From holiday list" },
                        { value: "regular", label: "Regular day" },
                        { value: "holiday", label: "Holiday" },
                      ]}
                    />
                    <Choice
                      control={control}
                      name="clientType"
                      label="Client type"
                      options={[
                        { value: "auto", label: "From client" },
                        { value: "individual", label: "Individual" },
                        { value: "corporate", label: "Corporate" },
                      ]}
                    />
                    <NumberField control={control} name="corporateMarkupPct" label="Corporate mark-up (%)" step="0.5" />
                    <PesoField control={control} name="mealPerDay" label="Meal per day (₱)" emptyAs={0} description="Suggested: 8h ₱100, 10–12h ₱200, 24h ₱300" />
                    <PesoField control={control} name="accommodationPerDay" label="Accommodation per day (₱)" emptyAs={0} />
                    <PesoField control={control} name="discount" label="Less discount (₱)" emptyAs={0} />
                  </>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        {mode === "formal" ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Payment</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <PesoField control={control} name="reservationFee" label="Reservation fee (₱)" emptyAs={0} />
                <Choice control={control} name="reservationMethod" label="Reservation paid by" options={METHODS} />
                <Choice control={control} name="rentalMethod" label="Rental paid by" options={METHODS} />
                {sd ? (
                  <>
                    <PesoField control={control} name="deposit" label="Security deposit (₱)" emptyAs={0} />
                    <Choice control={control} name="depositMethod" label="Deposit paid by" options={METHODS} />
                  </>
                ) : null}
                <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                  <PesoField control={control} name="fuelPrices.gasoline" label="Gasoline /L" />
                  <PesoField control={control} name="fuelPrices.premium" label="Premium /L" />
                  <PesoField control={control} name="fuelPrices.diesel" label="Diesel /L" />
                </div>
              </CardContent>
            </Card>
            {!sd ? (
              <Card>
                <CardHeader>
                  <CardTitle>Driver</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <TextField control={control} name="driverName" label="Driver name" description="Blank = “To be assigned upon confirmation”." />
                  <TextField control={control} name="driverContact" label="Driver contact" />
                </CardContent>
              </Card>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle>Internal notes</CardTitle>
              </CardHeader>
              <CardContent>
                <TextareaField control={control} name="notes" label="Notes (staff only, never on the client copy)" rows={3} />
              </CardContent>
            </Card>
          </>
        ) : null}
      </form>

      <div className="flex flex-col gap-4 lg:sticky lg:top-18 lg:h-fit">
        <PricePanel preview={preview} error={previewError} pricing={pricing} sd={sd} />
        <Card>
          <CardContent className="flex flex-col gap-2">
            {mode === "quick" ? (
              <>
                <Button type="button" onClick={downloadPdf} disabled={!preview?.result || !!busy}>
                  {busy === "pdf" ? <Loader2Icon className="animate-spin" /> : <FileDownIcon />}
                  Download PDF
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="secondary" onClick={copyText} disabled={!preview?.result}>
                    <ClipboardCopyIcon />
                    Copy text
                  </Button>
                  <Button type="button" variant="secondary" onClick={saveQuick} disabled={!preview?.result || !!busy}>
                    <SaveIcon />
                    Save
                  </Button>
                </div>
                <Button type="button" variant="outline" onClick={makeFormal} disabled={!!busy}>
                  <FileTextIcon />
                  Make formal
                </Button>
                {id ? <p className="text-xs text-muted-foreground">Saved as an estimate. It has no number.</p> : null}
              </>
            ) : (
              <>
                <Button
                  type="button"
                  onClick={() => (blacklisted ? setOverrideOpen(true) : issue())}
                  disabled={!preview?.result || !client || !!busy || (blacklisted && !canOverrideBlacklist)}
                >
                  {busy === "issue" ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                  Issue quotation
                </Button>
                {!client ? <p className="text-xs text-muted-foreground">Choose or add a client to issue.</p> : null}
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {saving ? "Saving draft…" : savedAt ? `Draft saved ${savedAt}` : id ? "Draft" : "Not saved yet"}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <OverrideDialog open={overrideOpen} onOpenChange={setOverrideOpen} busy={busy === "issue"} onConfirm={(reason) => issue(reason)} />
    </div>
  );
}

function OverrideDialog({
  open,
  onOpenChange,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busy: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue for a blacklisted client</DialogTitle>
          <DialogDescription>The reason is stored with the quotation and in the audit log.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="override-reason">Reason</Label>
          <Textarea id="override-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button type="button" variant="destructive" disabled={!reason.trim() || busy} onClick={() => onConfirm(reason.trim())}>
            Issue anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Select bound to any scalar value; `parse` turns the option string back. */
function Choice({
  control,
  name,
  label,
  options,
  noneLabel,
  disabled,
  description,
  parse,
  display,
}: {
  control: Control<QuoteFormInput>;
  name: FieldPath<QuoteFormInput>;
  label: string;
  options: { value: string; label: string }[];
  noneLabel?: string;
  disabled?: boolean;
  description?: ReactNode;
  parse?: (v: string) => unknown;
  /** Show this value instead of the field's (e.g. the chosen vehicle's body type). */
  display?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const raw = display ?? field.value;
        const v = raw === null || raw === undefined || raw === "" ? (noneLabel ? NONE : "") : String(raw);
        return (
          <Field>
            <FieldLabel htmlFor={name}>{label}</FieldLabel>
            <Select disabled={disabled} value={v} onValueChange={(s) => field.onChange(s === NONE ? null : parse ? parse(s) : s)}>
              <SelectTrigger id={name} className="w-full">
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {noneLabel ? <SelectItem value={NONE}>{noneLabel}</SelectItem> : null}
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
          </Field>
        );
      }}
    />
  );
}

export function PricePanel({
  preview,
  error,
  pricing,
  sd,
}: {
  preview: PricePreview | null;
  error: string | null;
  pricing: boolean;
  sd: boolean;
}) {
  const r = preview?.result ?? null;
  const doc = useMemo(() => (r ? ({ result: r } as Pick<QuoteDoc, "result">) : null), [r]);
  return (
    <Card data-testid="price-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Price
          {pricing ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Pricing" /> : null}
          {r?.service === "with_driver" ? (
            <Badge variant="secondary">
              {r.hoursTier}h · {(r.contractMinutes / 60).toFixed(1).replace(/\.0$/, "")}h contract{r.isHoliday ? " · Holiday" : ""}
            </Badge>
          ) : null}
          {preview?.clientIsRepeat === false && sd ? <Badge variant="outline">New client</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
            <TriangleAlertIcon className="size-4 shrink-0" />
            {error}
          </p>
        ) : null}
        {r?.warnings.map((w) => (
          <p key={w} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon className="size-4 shrink-0" />
            {w}
          </p>
        ))}
        {r && doc ? (
          <Table className="text-sm">
            <TableBody>
              {[...r.lines, ...r.discounts].map((l, i) => (
                <TableRow key={`${l.code}-${i}`}>
                  <TableCell className="whitespace-normal">
                    {printedLabel(l, doc)}
                    {l.remark ? <div className="text-xs text-muted-foreground">{l.remark}</div> : null}
                  </TableCell>
                  <TableCell className="text-right align-top tabular-nums">{fmtPeso(l.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              {totalsFor(doc).map((t) => (
                <TableRow key={t.label}>
                  <TableCell className={t.strong ? "font-semibold" : "font-normal text-muted-foreground"}>{t.label}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", t.strong ? "font-semibold" : "font-normal")}>{fmtPeso(t.amount)}</TableCell>
                </TableRow>
              ))}
              {r.service === "self_drive" && r.payable.deposit ? (
                <TableRow>
                  <TableCell className="font-normal text-muted-foreground">Refundable deposit</TableCell>
                  <TableCell className="text-right font-normal tabular-nums">{fmtPeso(r.payable.deposit)}</TableCell>
                </TableRow>
              ) : null}
              {(sdPayable(doc) ?? []).filter((t) => t.label === "Balance on release" || t.label === "Total contract value").map((t) => (
                <TableRow key={t.label}>
                  <TableCell className="font-normal text-muted-foreground">{t.label}</TableCell>
                  <TableCell className="text-right font-normal tabular-nums">{fmtPeso(t.amount)}</TableCell>
                </TableRow>
              ))}
            </TableFooter>
          </Table>
        ) : !error ? (
          <p className="text-sm text-muted-foreground">Fill in the trip to see the price.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}


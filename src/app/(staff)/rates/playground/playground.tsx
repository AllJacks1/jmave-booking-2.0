"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPeso } from "@/lib/money";
import {
  BODY_CATEGORIES,
  BODY_TYPE_LABELS,
  BODY_TYPES,
  CATEGORY_LABELS,
  DRIVER_RATE_MODE_LABELS,
  DRIVING_TERM_LABELS,
  OT_SLOT_LABELS,
  PAYMENT_METHODS,
  PRICING_BASIS_LABELS,
  priceSelfDrive,
  priceWithDriver,
  PricingInputError,
  SD_PROMO_LABELS,
  SERVICE_AREA_LABELS,
  WD_PACKAGE_LABELS,
  type BodyType,
  type Category,
  type PriceLine,
  type RateCardData,
  type SelfDriveInput,
  type WithDriverInput,
} from "@/lib/pricing";
import { addDaysToKey, manilaDateKey } from "@/lib/time";

type Fuel = { gasoline: number; premium: number; diesel: number };
type Props = {
  card: { id: string; version: number; name: string; status: string; data: RateCardData };
  cards: { id: string; label: string }[];
  holidays: string[];
  fuelPrices: Fuel;
};

const METHOD_LABELS = { cash: "Cash", gcash: "GCash", card: "Card", bank: "Bank" } as const;
const opts = <T extends string>(labels: Record<T, string>) => Object.entries(labels).map(([value, label]) => ({ value, label: label as string }));

function run<T>(f: () => T): { result: T | null; error: string | null } {
  try {
    return { result: f(), error: null };
  } catch (e) {
    if (e instanceof PricingInputError) return { result: null, error: e.message };
    return { result: null, error: e instanceof Error ? e.message : "Could not price this input." };
  }
}

export function Playground({ card, cards, holidays, fuelPrices }: Props) {
  const router = useRouter();
  const ctx = { holidays };
  const today = manilaDateKey(new Date());

  const [sd, setSd] = useState<SelfDriveInput>({
    bodyType: "sedan",
    category: "primo",
    hoursTier: 24,
    days: 1,
    additionalHoursBlock: null,
    extensionHours: 0,
    beyondOperatingHours: false,
    otPremiumSlot: "none",
    withCdw: false,
    sevenDayDiscount: false,
    promo: "none",
    clientIsRepeat: true,
    deliveryFee: 0,
    pickupFee: 0,
    oneWayDistanceKm: 0,
    includeFuel: true,
    fuelPrices,
    reservationFee: 50000,
    deposit: 200000,
    paymentMethods: { rental: "cash", reservation: "cash", deposit: "cash" },
  });
  const [wd, setWd] = useState({
    bodyType: "suv" as BodyType,
    category: "primo" as Category | null,
    startDate: today,
    startTime: "08:30",
    endTime: "18:30",
    days: 1,
    oneWayDistanceKm: 50,
    pricingBasis: "all_in" as WithDriverInput["pricingBasis"],
    additionalHoursBlock: null as 8 | 12 | null,
    package: "round_trip" as WithDriverInput["package"],
    drivingTerm: "back_and_forth" as WithDriverInput["drivingTerm"],
    driverRateMode: "contract_rate" as WithDriverInput["driverRateMode"],
    event: "auto" as WithDriverInput["event"],
    clientType: "individual" as WithDriverInput["clientType"],
    corporateMarkupPct: 0,
    serviceArea: "davao_region" as WithDriverInput["serviceArea"],
    mealPerDay: 10000,
    accommodationPerDay: 0,
    fuelPrices,
    reservationFee: 0,
    discount: 0,
    paymentMethods: { rental: "cash", reservation: "cash" } as NonNullable<WithDriverInput["paymentMethods"]>,
  });

  const sdOut = useMemo(() => run(() => priceSelfDrive(sd, card.data, ctx)), [sd, card.data, holidays]); // eslint-disable-line react-hooks/exhaustive-deps
  const wdOut = useMemo(() => {
    // End on the same day, or the next day when the end time is not after the start.
    const endDate = wd.endTime > wd.startTime ? wd.startDate : addDaysToKey(wd.startDate, 1);
    const input: WithDriverInput = {
      ...wd,
      startAt: `${wd.startDate}T${wd.startTime}:00+08:00`,
      endAt: `${endDate}T${wd.endTime}:00+08:00`,
      corporateMarkupBps: Math.round(wd.corporateMarkupPct * 100),
    };
    return run(() => priceWithDriver(input, card.data, ctx));
  }, [wd, card.data, holidays]); // eslint-disable-line react-hooks/exhaustive-deps

  const upSd = (patch: Partial<SelfDriveInput>) => setSd((s) => ({ ...s, ...patch }));
  const upWd = (patch: Partial<typeof wd>) => setWd((s) => ({ ...s, ...patch }));
  const catsFor = (b: BodyType) => BODY_CATEGORIES[b];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Label htmlFor="card">Rate card</Label>
        <select
          id="card"
          className="h-9 rounded-md border bg-background px-2"
          value={card.id}
          onChange={(e) => router.push(`/rates/playground?card=${e.target.value}`)}
        >
          {cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <Tabs defaultValue="sd">
        <TabsList>
          <TabsTrigger value="sd">Self-Drive</TabsTrigger>
          <TabsTrigger value="wd">With Driver</TabsTrigger>
        </TabsList>

        <TabsContent value="sd" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Inputs</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Sel label="Body type" value={sd.bodyType} options={BODY_TYPES.map((b) => ({ value: b, label: BODY_TYPE_LABELS[b] }))} onChange={(v) => upSd({ bodyType: v as BodyType, category: catsFor(v as BodyType)[1] ?? catsFor(v as BodyType)[0] ?? null })} />
              <Sel label="Category" value={sd.category ?? ""} disabled={catsFor(sd.bodyType).length === 0} options={catsFor(sd.bodyType).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} onChange={(v) => upSd({ category: v as Category })} />
              <Sel label="Hours" value={String(sd.hoursTier)} options={[24, 12, 8].map((h) => ({ value: String(h), label: `${h} hours` }))} onChange={(v) => upSd({ hoursTier: Number(v) as 8 | 12 | 24 })} />
              <Num label="Days" value={sd.days} onChange={(v) => upSd({ days: v ?? 0 })} />
              <Sel label="Additional hours block" value={String(sd.additionalHoursBlock ?? "")} options={[{ value: "", label: "None" }, { value: "8", label: "8 hours" }, { value: "12", label: "12 hours" }]} onChange={(v) => upSd({ additionalHoursBlock: v ? (Number(v) as 8 | 12) : null })} />
              <Num label="Hourly extension (hours)" value={sd.extensionHours ?? 0} onChange={(v) => upSd({ extensionHours: v ?? 0 })} />
              <Sel label="OT premium slot" value={sd.otPremiumSlot ?? "none"} options={opts(OT_SLOT_LABELS)} onChange={(v) => upSd({ otPremiumSlot: v as SelfDriveInput["otPremiumSlot"] })} />
              <Sel label="Promo" value={sd.promo ?? "none"} options={opts(SD_PROMO_LABELS)} onChange={(v) => upSd({ promo: v as SelfDriveInput["promo"] })} />
              <Peso label="Delivery fee" value={sd.deliveryFee ?? 0} onChange={(v) => upSd({ deliveryFee: v })} />
              <Peso label="Pick-up fee" value={sd.pickupFee ?? 0} onChange={(v) => upSd({ pickupFee: v })} />
              <Num label="One-way distance (km)" value={sd.oneWayDistanceKm ?? 0} step="0.1" onChange={(v) => upSd({ oneWayDistanceKm: v ?? 0 })} />
              <Sel label="Fuel type" value={sd.fuelType ?? ""} options={[{ value: "", label: "By body type" }, { value: "gasoline", label: "Gasoline" }, { value: "premium", label: "Premium" }, { value: "diesel", label: "Diesel" }]} onChange={(v) => upSd({ fuelType: (v || null) as SelfDriveInput["fuelType"] })} />
              <FuelInputs value={sd.fuelPrices} onChange={(f) => upSd({ fuelPrices: f })} />
              <Peso label="Reservation fee" value={sd.reservationFee ?? 0} onChange={(v) => upSd({ reservationFee: v })} />
              <Peso label="Security deposit" value={sd.deposit ?? 0} onChange={(v) => upSd({ deposit: v })} />
              {(["rental", "reservation", "deposit"] as const).map((k) => (
                <Sel key={k} label={`Payment: ${k}`} value={sd.paymentMethods?.[k] ?? "cash"} options={PAYMENT_METHODS.map((m) => ({ value: m, label: METHOD_LABELS[m] }))} onChange={(v) => upSd({ paymentMethods: { rental: "cash", reservation: "cash", deposit: "cash", ...sd.paymentMethods, [k]: v as "cash" } })} />
              ))}
              <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
                <Check label="With CDW" checked={!!sd.withCdw} onChange={(c) => upSd({ withCdw: c })} />
                <Check label="7-day discount" checked={!!sd.sevenDayDiscount} onChange={(c) => upSd({ sevenDayDiscount: c })} />
                <Check label="Beyond operating hours (10:01 PM – 5:29 AM)" checked={!!sd.beyondOperatingHours} onChange={(c) => upSd({ beyondOperatingHours: c })} />
                <Check label="Include estimated fuel" checked={sd.includeFuel !== false} onChange={(c) => upSd({ includeFuel: c })} />
                <Check label="Repeat client (no new-client discount)" checked={sd.clientIsRepeat !== false} onChange={(c) => upSd({ clientIsRepeat: c })} />
              </div>
            </CardContent>
          </Card>
          <Result
            error={sdOut.error}
            warnings={sdOut.result?.warnings ?? []}
            lines={sdOut.result?.lines ?? []}
            discounts={sdOut.result?.discounts ?? []}
            totals={
              sdOut.result
                ? [
                    ["Subtotal", sdOut.result.subtotal],
                    ["Rental total", sdOut.result.total, true],
                    ["Terminal fee (rental)", sdOut.result.payable.terminalFees.rental],
                    ["Terminal fee (reservation)", sdOut.result.payable.terminalFees.reservation],
                    ["Terminal fee (deposit)", sdOut.result.payable.terminalFees.deposit],
                    ["Refundable security deposit", sdOut.result.payable.deposit],
                    ["Total contract value", sdOut.result.payable.totalContractValue, true],
                    ["Due today (reservation + delivery)", sdOut.result.payable.dueToday],
                    ["Balance on release", sdOut.result.payable.balanceOnRelease, true],
                  ]
                : []
            }
          />
        </TabsContent>

        <TabsContent value="wd" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Inputs</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Sel label="Body type" value={wd.bodyType} options={BODY_TYPES.map((b) => ({ value: b, label: BODY_TYPE_LABELS[b] }))} onChange={(v) => upWd({ bodyType: v as BodyType, category: catsFor(v as BodyType)[1] ?? catsFor(v as BodyType)[0] ?? null })} />
              <Sel label="Category" value={wd.category ?? ""} disabled={catsFor(wd.bodyType).length === 0} options={catsFor(wd.bodyType).map((c) => ({ value: c, label: c === "budgetmile" ? "Regular (Budgetmile)" : CATEGORY_LABELS[c] }))} onChange={(v) => upWd({ category: v as Category })} />
              <Field label="Start date" id="wd-start-date">
                <Input id="wd-start-date" type="date" value={wd.startDate} onChange={(e) => upWd({ startDate: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start time" id="wd-start-time">
                  <Input id="wd-start-time" type="time" value={wd.startTime} onChange={(e) => upWd({ startTime: e.target.value })} />
                </Field>
                <Field label="End time" id="wd-end-time">
                  <Input id="wd-end-time" type="time" value={wd.endTime} onChange={(e) => upWd({ endTime: e.target.value })} />
                </Field>
              </div>
              <Num label="Days" value={wd.days} onChange={(v) => upWd({ days: v ?? 0 })} />
              <Num label="One-way distance (km)" value={wd.oneWayDistanceKm} step="0.1" onChange={(v) => upWd({ oneWayDistanceKm: v ?? 0 })} />
              <Sel label="Package" value={wd.package!} options={opts(WD_PACKAGE_LABELS)} onChange={(v) => upWd({ package: v as WithDriverInput["package"] })} />
              <Sel label="Driving term" value={wd.drivingTerm!} options={opts(DRIVING_TERM_LABELS)} onChange={(v) => upWd({ drivingTerm: v as WithDriverInput["drivingTerm"] })} />
              <Sel label="Driver rate" value={wd.driverRateMode!} options={opts(DRIVER_RATE_MODE_LABELS)} onChange={(v) => upWd({ driverRateMode: v as WithDriverInput["driverRateMode"] })} />
              <Sel label="Pricing basis" value={wd.pricingBasis!} options={opts(PRICING_BASIS_LABELS)} onChange={(v) => upWd({ pricingBasis: v as WithDriverInput["pricingBasis"] })} />
              <Sel label="Additional hours block" value={String(wd.additionalHoursBlock ?? "")} options={[{ value: "", label: "None" }, { value: "8", label: "8 hours" }, { value: "12", label: "12 hours" }]} onChange={(v) => upWd({ additionalHoursBlock: v ? (Number(v) as 8 | 12) : null })} />
              <Sel label="Event" value={wd.event!} options={[{ value: "auto", label: "From holiday list" }, { value: "regular", label: "Regular day" }, { value: "holiday", label: "Holiday" }]} onChange={(v) => upWd({ event: v as WithDriverInput["event"] })} />
              <Sel label="Service area (15+ days)" value={wd.serviceArea!} options={opts(SERVICE_AREA_LABELS)} onChange={(v) => upWd({ serviceArea: v as WithDriverInput["serviceArea"] })} />
              <Sel label="Client type" value={wd.clientType!} options={[{ value: "individual", label: "Individual" }, { value: "corporate", label: "Corporate" }]} onChange={(v) => upWd({ clientType: v as WithDriverInput["clientType"] })} />
              {wd.clientType === "corporate" ? <Num label="Corporate mark-up (%)" value={wd.corporateMarkupPct} step="0.5" onChange={(v) => upWd({ corporateMarkupPct: v ?? 0 })} /> : null}
              <Peso label="Meal per day" value={wd.mealPerDay} onChange={(v) => upWd({ mealPerDay: v })} hint="Suggested: 8h ₱100, 10–12h ₱200, 24h ₱300" />
              <Peso label="Accommodation per day" value={wd.accommodationPerDay} onChange={(v) => upWd({ accommodationPerDay: v })} />
              <FuelInputs value={wd.fuelPrices} onChange={(f) => upWd({ fuelPrices: f })} />
              <Peso label="Reservation fee" value={wd.reservationFee} onChange={(v) => upWd({ reservationFee: v })} />
              <Peso label="Less discount" value={wd.discount} onChange={(v) => upWd({ discount: v })} />
              {(["rental", "reservation"] as const).map((k) => (
                <Sel key={k} label={`Payment: ${k}`} value={wd.paymentMethods[k] ?? "cash"} options={PAYMENT_METHODS.map((m) => ({ value: m, label: METHOD_LABELS[m] }))} onChange={(v) => upWd({ paymentMethods: { ...wd.paymentMethods, [k]: v as "cash" } })} />
              ))}
            </CardContent>
          </Card>
          <Result
            error={wdOut.error}
            warnings={wdOut.result?.warnings ?? []}
            badges={
              wdOut.result
                ? [
                    `${wdOut.result.hoursTier}h tier`,
                    `${(wdOut.result.contractMinutes / 60).toFixed(2).replace(/\.?0+$/, "")}h contract`,
                    wdOut.result.isHoliday ? "Holiday" : "Regular day",
                  ]
                : []
            }
            lines={wdOut.result?.lines ?? []}
            discounts={wdOut.result?.discounts ?? []}
            supplemental={wdOut.result?.supplemental ?? []}
            totals={
              wdOut.result
                ? [
                    ["Subtotal", wdOut.result.subtotal],
                    ["Total", wdOut.result.total, true],
                    ["Terminal fee (rental)", wdOut.result.terminalFees.rental],
                    ["Terminal fee (reservation)", wdOut.result.terminalFees.reservation],
                    ["Corporate mark-up", wdOut.result.corporateMarkup],
                    ["Grand total", wdOut.result.grandTotal, true],
                    ["Due today (reservation)", wdOut.result.payable.dueToday],
                    ["Balance", wdOut.result.payable.balanceOnRelease, true],
                  ]
                : []
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, children, hint, id }: { label: string; children: ReactNode; hint?: string; id?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Sel({ label, value, options, onChange, disabled }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <Field label={label} id={id}>
      <select id={id} className="h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-50" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.length === 0 ? <option value="">—</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Num({ label, value, onChange, step = "1" }: { label: string; value: number; onChange: (v: number | null) => void; step?: string }) {
  const id = useId();
  return (
    <Field label={label} id={id}>
      <Input id={id} type="number" inputMode="decimal" step={step} min="0" value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
    </Field>
  );
}

function Peso({ label, value, onChange, hint }: { label: string; value: number; onChange: (centavos: number) => void; hint?: string }) {
  const id = useId();
  return (
    <Field label={`${label} (₱)`} hint={hint} id={id}>
      <Input id={id} type="number" inputMode="decimal" step="0.01" min="0" value={value / 100} onChange={(e) => onChange(Math.round(Number(e.target.value || 0) * 100))} />
    </Field>
  );
}

function FuelInputs({ value, onChange }: { value: Fuel; onChange: (v: Fuel) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:col-span-2">
      {(["gasoline", "premium", "diesel"] as const).map((f) => (
        <Peso key={f} label={`${f[0].toUpperCase()}${f.slice(1)} /L`} value={value[f]} onChange={(v) => onChange({ ...value, [f]: v })} />
      ))}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      {label}
    </label>
  );
}

function Result({
  error,
  warnings,
  lines,
  discounts,
  totals,
  supplemental = [],
  badges = [],
}: {
  error: string | null;
  warnings: string[];
  lines: PriceLine[];
  discounts: PriceLine[];
  totals: (readonly [string, number] | readonly [string, number, boolean])[];
  supplemental?: PriceLine[];
  badges?: string[];
}) {
  return (
    <Card className="h-fit lg:sticky lg:top-4">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Result
          {badges.map((b) => (
            <Badge key={b} variant="secondary">
              {b}
            </Badge>
          ))}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <TriangleAlertIcon className="size-4" />
            {error}
          </p>
        ) : null}
        {warnings.map((w) => (
          <p key={w} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon className="size-4" />
            {w}
          </p>
        ))}
        {!error ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead className="hidden sm:table-cell">Remark</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...lines, ...discounts].map((l, i) => (
                <TableRow key={`${l.code}-${i}`}>
                  <TableCell>{l.label}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{l.remark}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPeso(l.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              {totals.map(([label, amount, strong]) => (
                <TableRow key={label}>
                  <TableCell colSpan={2} className={strong ? "font-semibold" : "font-normal text-muted-foreground"}>
                    {label}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${strong ? "font-semibold" : "font-normal"}`}>{formatPeso(amount)}</TableCell>
                </TableRow>
              ))}
            </TableFooter>
          </Table>
        ) : null}
        {supplemental.length ? (
          <p className="text-sm text-muted-foreground">
            Supplemental charges (not in total): {supplemental.map((s) => `${s.label} ${formatPeso(s.amount)} (${s.remark})`).join(", ")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

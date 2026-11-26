"use client";

import { SaveIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AvailabilityNote } from "@/components/bookings/availability-note";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionFailure } from "@/lib/actions";
import { ID_TYPES, SOURCE_CHANNEL_LABELS, SOURCE_CHANNELS, type IdType, type SourceChannel } from "@/lib/bookings/constants";
import type { Availability } from "@/lib/bookings/format";
import type { Service } from "@/lib/pricing/types";
import { manilaToUtc } from "@/lib/time";
import { assignDriverAction, availabilityCheckAction, updateDetailsAction, updateScheduleAction } from "../actions";

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

function errorText(r: ActionFailure) {
  const first = Object.values(r.fieldErrors ?? {})[0]?.[0];
  return first ? `${r.error} ${first}` : r.error;
}

// ---------------------------------------------------------------------------
// Vehicle + schedule
// ---------------------------------------------------------------------------

type Schedule = { vehicleId: string; startDate: string; startTime: string; endDate: string; endTime: string };

export function ScheduleForm({
  id,
  editable,
  vehicles,
  initial,
  vehicleLabel,
  holdText,
}: {
  id: string;
  editable: boolean;
  vehicles: { id: string; label: string }[];
  initial: Schedule;
  vehicleLabel: string | null;
  holdText: string | null;
}) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  const set = (k: keyof Schedule, v: string) => setS((x) => ({ ...x, [k]: v }));

  // Live availability for the edited vehicle/time (own booking excluded).
  useEffect(() => {
    if (!editable || !dirty || !s.vehicleId) return;
    let start: Date;
    let end: Date;
    try {
      start = manilaToUtc(s.startDate, s.startTime);
      end = manilaToUtc(s.endDate, s.endTime);
    } catch {
      return;
    }
    if (!(end > start)) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await availabilityCheckAction({ vehicleId: s.vehicleId, startAt: start.toISOString(), endAt: end.toISOString(), excludeBookingId: id });
      if (!cancelled && r.ok) setAvailability(r.data);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [s, editable, dirty, id]);

  async function save() {
    setBusy(true);
    const r = await updateScheduleAction({ id, ...s });
    setBusy(false);
    if (!r.ok) return void toast.error(errorText(r));
    toast.success("Schedule saved");
    setAvailability(null);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vehicle and schedule</CardTitle>
        {holdText ? <CardDescription>{holdText}</CardDescription> : <CardDescription>Not holding the car yet (pending reservation).</CardDescription>}
        {editable && dirty ? (
          <CardAction>
            <Button size="sm" onClick={save} disabled={busy}>
              <SaveIcon />
              Save schedule
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="sch-vehicle">Vehicle</Label>
          {editable ? (
            <select id="sch-vehicle" className={selectClass} value={s.vehicleId} onChange={(e) => set("vehicleId", e.target.value)}>
              {s.vehicleId === "" ? <option value="">{vehicleLabel ?? "Choose a vehicle"}</option> : null}
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm">{vehicleLabel ?? "—"}</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="sch-start-date">Release date</Label>
            <Input id="sch-start-date" type="date" disabled={!editable} value={s.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sch-start-time">Time</Label>
            <Input id="sch-start-time" type="time" disabled={!editable} value={s.startTime} onChange={(e) => set("startTime", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="sch-end-date">Return date</Label>
            <Input id="sch-end-date" type="date" disabled={!editable} value={s.endDate} onChange={(e) => set("endDate", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sch-end-time">Time</Label>
            <Input id="sch-end-time" type="time" disabled={!editable} value={s.endTime} onChange={(e) => set("endTime", e.target.value)} />
          </div>
        </div>
        {editable && dirty ? (
          <div className="sm:col-span-2">
            <AvailabilityNote availability={availability} />
            <p className="mt-1 text-xs text-muted-foreground">Charges are not re-priced when the schedule changes. Adjust them below if needed.</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Booking details (§1)
// ---------------------------------------------------------------------------

type Details = {
  id: string;
  destination: string;
  deliveryAddress: string;
  pickupAddress: string;
  driverNameOnLicense: string;
  driversLicenseNo: string;
  idsPresented: IdType[];
  passengers: number | null;
  luggage: string;
  itinerary: string;
  sourceChannel: SourceChannel | null;
  contactHandle: string;
  reworkLink: string;
  orIssued: boolean;
  notes: string;
  showNotesOnBoard: boolean;
};

export function DetailsForm({ initial, editable, service }: { initial: Details; editable: boolean; service: Service }) {
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const set = <K extends keyof Details>(k: K, v: Details[K]) => setD((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true);
    const r = await updateDetailsAction(d);
    setBusy(false);
    if (!r.ok) {
      setErrors(Object.fromEntries(Object.entries(r.fieldErrors ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])));
      return void toast.error(r.error);
    }
    setErrors({});
    toast.success("Details saved");
    router.refresh();
  }

  const text = (k: keyof Details, label: string, opts: { area?: boolean; span?: boolean; placeholder?: string } = {}) => (
    <div className={`grid gap-1.5 ${opts.span ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={`d-${k}`}>{label}</Label>
      {opts.area ? (
        <Textarea id={`d-${k}`} disabled={!editable} rows={2} value={String(d[k] ?? "")} onChange={(e) => set(k, e.target.value as never)} />
      ) : (
        <Input id={`d-${k}`} disabled={!editable} placeholder={opts.placeholder} value={String(d[k] ?? "")} onChange={(e) => set(k, e.target.value as never)} />
      )}
      {errors[k] ? <p className="text-xs text-destructive">{errors[k]}</p> : null}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Booking details</CardTitle>
        {editable ? (
          <CardAction>
            <Button size="sm" onClick={save} disabled={busy || !dirty}>
              <SaveIcon />
              Save details
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {text("destination", "Destination")}
        <div className="grid gap-1.5">
          <Label htmlFor="d-channel">Source channel</Label>
          <select
            id="d-channel"
            className={selectClass}
            disabled={!editable}
            value={d.sourceChannel ?? ""}
            onChange={(e) => set("sourceChannel", (e.target.value || null) as SourceChannel | null)}
          >
            <option value="">—</option>
            {SOURCE_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {SOURCE_CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        {text("deliveryAddress", "Delivery address (FD)", { area: true })}
        {text("pickupAddress", "Pick-up address (PU)", { area: true })}
        {service === "self_drive" ? (
          <>
            {text("driverNameOnLicense", "Driver's name on license")}
            {text("driversLicenseNo", "Driver's license no.")}
            <fieldset className="grid gap-1.5 sm:col-span-2">
              <legend className="mb-1 text-sm font-medium">IDs presented</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {ID_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      disabled={!editable}
                      checked={d.idsPresented.includes(t)}
                      onCheckedChange={(v) => set("idsPresented", v === true ? [...d.idsPresented, t] : d.idsPresented.filter((x) => x !== t))}
                    />
                    {t}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        ) : (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="d-passengers">Passengers</Label>
              <Input
                id="d-passengers"
                type="number"
                min={0}
                disabled={!editable}
                value={d.passengers ?? ""}
                onChange={(e) => set("passengers", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
            {text("luggage", "Luggage")}
            {text("itinerary", "Itinerary", { area: true, span: true })}
          </>
        )}
        {text("contactHandle", "Contact handle", { placeholder: "FB name, WhatsApp number…" })}
        {text("reworkLink", "Rework inbox link", { placeholder: "https://…" })}
        {text("notes", "Notes", { area: true, span: true })}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox disabled={!editable} checked={d.showNotesOnBoard} onCheckedChange={(v) => set("showNotesOnBoard", v === true)} />
          Show notes on the movement board
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox disabled={!editable} checked={d.orIssued} onCheckedChange={(v) => set("orIssued", v === true)} />
          Official receipt (OR) issued
        </label>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Driver (With Driver)
// ---------------------------------------------------------------------------

export function DriverAssign({
  id,
  current,
  drivers,
  clash,
  overrideReason,
  canOverride,
  editable,
}: {
  id: string;
  current: { id: string; name: string; phone: string | null } | null;
  drivers: { id: string; name: string }[];
  clash: string[];
  overrideReason: string | null;
  canOverride: boolean;
  editable: boolean;
}) {
  const router = useRouter();
  const [driverId, setDriverId] = useState(current?.id ?? "");
  const [reason, setReason] = useState("");
  const [needReason, setNeedReason] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const r = await assignDriverAction({ id, driverId: driverId || null, overrideReason: reason.trim() });
    setBusy(false);
    if (!r.ok) {
      if (r.fieldErrors?.overrideReason) setNeedReason(true);
      return void toast.error(r.error);
    }
    toast.success(driverId ? "Driver assigned" : "Driver removed");
    setNeedReason(false);
    setReason("");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Driver</CardTitle>
        <CardDescription>{current ? current.name : "Waiting driver…"}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {clash.length ? <p className="text-amber-700 dark:text-amber-400">Overlaps {clash.join(", ")}{overrideReason ? ` (override: ${overrideReason})` : ""}</p> : null}
        {editable ? (
          <>
            <select aria-label="Driver" className={selectClass} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">No driver yet</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {needReason && canOverride ? (
              <div className="grid gap-1.5">
                <Label htmlFor="drv-reason">Reason to assign anyway</Label>
                <Textarea id="drv-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            ) : null}
            <Button size="sm" variant="outline" disabled={busy || driverId === (current?.id ?? "")} onClick={save}>
              Save driver
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

"use client";

import { CarFrontIcon, CheckIcon, Loader2Icon, ReceiptIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionFailure } from "@/lib/actions";
import { fuelText } from "@/lib/check-in/format";
import type { ReturnPreview } from "@/lib/check-in/service";
import { fmtPeso } from "@/lib/quotes/document";
import { cn } from "@/lib/utils";
import { previewReturnAction, releaseAction, returnAction } from "./actions";

export type CheckInFormProps = {
  mode: "release" | "return";
  bookingId: string;
  backHref: string;
  defaults: { date: string; time: string };
  /** FD address (release) or PU address (return), if any. */
  address: string | null;
  /** Release reading (return form) or the car's last known odometer (release form). */
  reference: { odometerKm: number | null; fuelLevelEighths: number | null; label: string } | null;
};

const FUEL_LABELS = ["E", "1/8", "2/8", "3/8", "4/8", "5/8", "6/8", "7/8", "F"];


export function CheckInForm({ mode, bookingId, backHref, defaults, address, reference }: CheckInFormProps) {
  const router = useRouter();
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [odo, setOdo] = useState("");
  const [fuel, setFuel] = useState<number | null>(null);
  const [delivery, setDelivery] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ key: string; data: ReturnPreview } | null>(null);

  const odometerKm = odo.trim() === "" ? NaN : Number(odo.replace(/[,\s]/g, ""));
  const input = { bookingId, actualDate: date, actualTime: time, odometerKm, fuelLevelEighths: fuel ?? NaN, delivery, notes };
  const key = JSON.stringify([date, time, odometerKm, fuel]);
  const current = preview && preview.key === key ? preview.data : null;

  function fail(r: ActionFailure) {
    setErrors(Object.fromEntries(Object.entries(r.fieldErrors ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])));
    toast.error(r.error);
  }

  function validLocal(): boolean {
    const e: Record<string, string> = {};
    if (!Number.isInteger(odometerKm) || odometerKm < 0) e.odometerKm = "Enter the odometer reading in km";
    if (fuel === null) e.fuelLevelEighths = "Choose the fuel level";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function check() {
    if (!validLocal()) return;
    setBusy(true);
    const r = await previewReturnAction(input);
    setBusy(false);
    if (!r.ok) return fail(r);
    setErrors({});
    setPreview({ key, data: r.data });
  }

  async function save() {
    if (!validLocal()) return;
    setBusy(true);
    if (mode === "release") {
      const r = await releaseAction(input);
      setBusy(false);
      if (!r.ok) return fail(r);
    } else {
      const r = await returnAction(input);
      setBusy(false);
      if (!r.ok) return fail(r);
      for (const w of r.data.warnings) toast.warning(w, { duration: 10_000 });
    }
    toast.success(mode === "release" ? "Release recorded" : "Return recorded");
    router.push(backHref);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{mode === "release" ? "Release check-in" : "Return check-in"}</CardTitle>
          {reference ? (
            <CardDescription>
              {reference.label}: {reference.odometerKm !== null ? `${reference.odometerKm.toLocaleString("en-PH")} km` : "—"}
              {reference.fuelLevelEighths !== null ? ` · fuel ${fuelText(reference.fuelLevelEighths)}` : ""}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ci-date">{mode === "release" ? "Released on" : "Returned on"}</Label>
              <Input id="ci-date" type="date" className="h-11 text-base" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ci-time">Time</Label>
              <Input id="ci-time" type="time" className="h-11 text-base" value={time} onChange={(e) => setTime(e.target.value)} />
              {errors.actualTime ? <p className="text-xs text-destructive">{errors.actualTime}</p> : null}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ci-odo">Odometer (km)</Label>
            <Input
              id="ci-odo"
              inputMode="numeric"
              autoComplete="off"
              className="h-11 text-base tabular-nums"
              placeholder={reference?.odometerKm ? `e.g. ${reference.odometerKm.toLocaleString("en-PH")}` : "e.g. 10,000"}
              value={odo}
              onChange={(e) => setOdo(e.target.value)}
              aria-invalid={Boolean(errors.odometerKm)}
            />
            {errors.odometerKm ? <p className="text-xs text-destructive">{errors.odometerKm}</p> : null}
          </div>

          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Fuel level</legend>
            <div role="radiogroup" aria-label="Fuel level" className="grid grid-cols-9 gap-1">
              {FUEL_LABELS.map((l, i) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={fuel === i}
                  aria-label={`Fuel ${fuelText(i)}`}
                  onClick={() => setFuel(i)}
                  className={cn(
                    "h-11 rounded-md border text-xs font-medium tabular-nums transition-colors",
                    fuel === i ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
            {errors.fuelLevelEighths ? <p className="text-xs text-destructive">{errors.fuelLevelEighths}</p> : null}
          </fieldset>

          {address ? (
            <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
              <Checkbox className="mt-0.5" checked={delivery} onCheckedChange={(v) => setDelivery(v === true)} />
              <span>
                <span className="font-medium">{mode === "release" ? "Delivered (FD)" : "Picked up (PU)"}</span>
                <span className="block text-muted-foreground">{address}</span>
              </span>
            </label>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="ci-notes">Notes</Label>
            <Textarea id="ci-notes" rows={3} placeholder="Scratches, items left, anything to remember" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {mode === "return" && current ? (
        <Card data-testid="return-preview">
          <CardHeader>
            <CardTitle>Charges to add</CardTitle>
            <CardDescription>
              {current.actualKm.toLocaleString("en-PH")} km driven · allowance {current.allowanceKm.toLocaleString("en-PH")} km ({current.billedDays}{" "}
              {current.billedDays === 1 ? "day" : "days"}) · {current.lateMinutes > 0 ? `${current.lateMinutes} min late (grace ${current.graceMinutes})` : "on time"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {current.lines.length === 0 ? <p className="text-muted-foreground">No extra charges.</p> : null}
            {current.lines.map((l) => (
              <div key={l.code} className="flex items-start justify-between gap-3" data-testid="preview-line" data-kind={l.kind}>
                <div>
                  <p className="font-medium">{l.label}</p>
                  <p className="text-xs text-muted-foreground">{l.remark}</p>
                </div>
                <p className="tabular-nums">{fmtPeso(l.amount)}</p>
              </div>
            ))}
            {current.warnings.map((w) => (
              <p key={w} className="text-amber-700 dark:text-amber-400">
                {w}
              </p>
            ))}
            <div className="mt-2 flex justify-between border-t pt-2">
              <span>Balance now</span>
              <span className="tabular-nums">{fmtPeso(current.ledger.balance)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Balance after return</span>
              <span className="tabular-nums" data-testid="balance-after">
                {fmtPeso(current.balanceAfter)}
              </span>
            </div>
            {current.ledger.depositHeld > 0 ? (
              <p className="text-xs text-muted-foreground">Deposit held: {fmtPeso(current.ledger.depositHeld)}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {mode === "return" && preview && !current ? (
        <Alert>
          <AlertTitle>Details changed</AlertTitle>
          <AlertDescription>Check the charges again before saving.</AlertDescription>
        </Alert>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        {mode === "return" && !current ? (
          <Button size="lg" className="flex-1 sm:flex-none" onClick={check} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : <ReceiptIcon />}
            Check charges
          </Button>
        ) : (
          <Button size="lg" className="flex-1 sm:flex-none" onClick={save} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : mode === "release" ? <CarFrontIcon /> : <CheckIcon />}
            {mode === "release" ? "Save release" : "Save return"}
          </Button>
        )}
        <Button size="lg" variant="outline" onClick={() => router.push(backHref)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

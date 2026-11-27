"use client";

import { SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  optionKeyLabel,
  REWORK_DATE_UNITS,
  REWORK_OPTION_FIELD_KEYS,
  REWORK_OPTION_FIELDS,
  type ReworkDateUnit,
  type ReworkOptionMap,
} from "@/lib/rework/options";
import { sendTestLeadAction, updateReworkSettingsAction } from "./actions";

type Props = {
  initial: { sendStaffIntakes: boolean; optionMap: ReworkOptionMap; dateUnit: ReworkDateUnit };
  status: { urlSet: boolean; tokenSet: boolean; ready: boolean };
  readOnly: boolean;
};

const yes = (v: boolean) => (v ? <Badge variant="secondary">yes</Badge> : <Badge variant="destructive">no</Badge>);

/** Rework lead settings (rework.md §1, §2, §4). The URL and token are never shown. */
export function ReworkSettings({ initial, status, readOnly }: Props) {
  const router = useRouter();
  const [sendStaff, setSendStaff] = useState(initial.sendStaffIntakes);
  const [unit, setUnit] = useState<ReworkDateUnit>(initial.dateUnit);
  const [map, setMap] = useState<ReworkOptionMap>(initial.optionMap);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const r = await updateReworkSettingsAction({ rework_send_staff_intakes: sendStaff, rework_date_unit: unit, rework_option_map: map });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(r.data.changed.length ? "Rework settings saved" : "No changes to save");
    router.refresh();
  }

  async function testLead() {
    setBusy(true);
    const r = await sendTestLeadAction();
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Test lead queued. Check the deliveries list below, then look for it in Rework.");
    router.refresh();
  }

  return (
    <Card data-testid="rework-settings">
      <CardHeader>
        <CardTitle>Rework leads</CardTitle>
        <CardDescription>
          Every booking request is sent to Rework as a lead by the worker. Option values must match the dropdown options in Rework exactly; an empty value
          leaves the field out.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm" data-testid="rework-status">
          <span>URL set: {yes(status.urlSet)}</span>
          <span>Token set: {yes(status.tokenSet)}</span>
          {!status.ready ? <span className="text-muted-foreground">Set REWORK_WEBHOOK_URL and REWORK_WEBHOOK_TOKEN in Railway Variables (web and worker).</span> : null}
          {!readOnly ? (
            <Button type="button" variant="outline" size="sm" className="ml-auto" disabled={busy} onClick={testLead}>
              <SendIcon />
              Send test lead
            </Button>
          ) : null}
        </div>

        <fieldset disabled={readOnly} className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Switch id="rework-staff" checked={sendStaff} onCheckedChange={setSendStaff} />
            <Label htmlFor="rework-staff" className="font-normal">
              Also send a lead when a formal quotation is issued for a client added in the quotation form
            </Label>
          </div>
          <div className="flex max-w-xs flex-col gap-2">
            <Label htmlFor="rework-unit">Date fields unit</Label>
            <select
              id="rework-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value as ReworkDateUnit)}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
            >
              {REWORK_DATE_UNITS.map((u) => (
                <option key={u} value={u}>
                  Unix {u}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">Confirm with a test lead: the start time in Rework must match.</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {REWORK_OPTION_FIELD_KEYS.map((f) => (
              <div key={f} className="flex flex-col gap-2 rounded-lg border p-3">
                <p className="text-sm font-medium">
                  {REWORK_OPTION_FIELDS[f].label} <code className="text-xs text-muted-foreground">{REWORK_OPTION_FIELDS[f].reworkField}</code>
                </p>
                {REWORK_OPTION_FIELDS[f].keys.map((k) => (
                  <div key={k} className="grid grid-cols-[minmax(8rem,1fr)_1.4fr] items-center gap-2">
                    <Label htmlFor={`opt-${f}-${k}`} className="text-xs font-normal text-muted-foreground">
                      {optionKeyLabel(f, k)}
                    </Label>
                    <Input
                      id={`opt-${f}-${k}`}
                      value={map[f]?.[k] ?? ""}
                      placeholder={f === "car_type" && k.includes(":") ? "(uses the body type)" : "(not sent)"}
                      onChange={(e) => setMap((m) => ({ ...m, [f]: { ...m[f], [k]: e.target.value } }))}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </fieldset>
        {!readOnly ? (
          <div className="flex justify-end">
            <Button type="button" disabled={busy} onClick={save}>
              Save Rework settings
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

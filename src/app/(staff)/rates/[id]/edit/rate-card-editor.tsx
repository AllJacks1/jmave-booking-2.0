"use client";

import { SaveIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RateCardTables } from "@/components/rates/rate-card-tables";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { describePath, setPath } from "@/lib/pricing/paths";
import { diffRateCards, rateCardDataSchema, type RateCardData } from "@/lib/pricing/rate-card";
import { updateDraftAction } from "../../actions";

/** Zod issue path (`withDriver.driverFee.h8.0`) → table path (`withDriver.driverFee.h8[0]`). */
function tablePath(path: (string | number | symbol)[]): string {
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : `${i ? "." : ""}${String(p)}`)).join("");
}

export function RateCardEditor({
  id,
  name: initialName,
  notes: initialNotes,
  data: initialData,
  compareTo,
}: {
  id: string;
  name: string;
  notes: string;
  data: RateCardData;
  compareTo: RateCardData;
}) {
  const router = useRouter();
  const [data, setData] = useState<RateCardData>(initialData);
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const unsaved = diffRateCards(initialData, data).length;

  function onChange(path: string, value: number | null) {
    setData((d) => setPath(d, path, value));
  }

  function save() {
    setFormError(null);
    const parsed = rateCardDataSchema.safeParse(data);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[tablePath(issue.path)] ??= issue.message;
      setErrors(errs);
      const first = Object.keys(errs)[0];
      setFormError(`${Object.keys(errs).length} value(s) need fixing, e.g. ${describePath(first)}: ${errs[first]}.`);
      return;
    }
    setErrors({});
    start(async () => {
      const r = await updateDraftAction({ id, name, notes, data: parsed.data });
      if (!r.ok) {
        const errs: Record<string, string> = {};
        for (const [k, v] of Object.entries(r.fieldErrors ?? {})) {
          if (k.startsWith("data.") && v?.[0]) errs[k.slice(5).replace(/\.(\d+)(?=\.|$)/g, "[$1]")] = v[0];
        }
        setErrors(errs);
        setFormError(r.error);
        return;
      }
      toast.success(`Saved (${r.data.changed} value(s) changed)`);
      router.push(`/rates/${id}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          <Field>
            <FieldLabel htmlFor="notes">Notes</FieldLabel>
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </Field>
        </CardContent>
      </Card>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      <RateCardTables data={data} onChange={onChange} compareTo={compareTo} errors={errors} />
      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t bg-background/95 py-3 backdrop-blur">
        <span className="text-sm text-muted-foreground">{unsaved ? `${unsaved} unsaved change(s)` : "No unsaved changes"}</span>
        <Button asChild variant="outline">
          <Link href={`/rates/${id}`}>Cancel</Link>
        </Button>
        <Button onClick={save} disabled={pending}>
          <SaveIcon />
          {pending ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </div>
  );
}

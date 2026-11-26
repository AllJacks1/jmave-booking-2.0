"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { applyFieldErrors, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { centavosToInput, parsePesoToCentavos } from "@/lib/money";
import { formatPhPhone } from "@/lib/phone";
import { businessSchema, type Settings } from "@/lib/settings/schema";
import { updateSettingsAction } from "./actions";

/** Form shape: pesos as text and whole numbers as text; converted on submit. */
const peso = z
  .string()
  .trim()
  .refine((v) => parsePesoToCentavos(v) !== null, "Enter an amount like 94.00");
const wholeNumber = z.string().trim().regex(/^\d+$/, "Whole number");

const formSchema = z.object({
  business: z.object({
    name: businessSchema.shape.name,
    address: businessSchema.shape.address,
    mobile: z.string().trim().min(1, "Required"),
    landline: z.string().trim().min(1, "Required"),
    email: businessSchema.shape.email,
  }),
  fuel: z.object({ gasoline: peso, premium: peso, diesel: peso }),
  quoteValidityHours: wholeNumber,
  turnaroundBufferMinutes: wholeNumber,
  lateReturnGraceMinutes: wholeNumber,
});
type FormValues = z.infer<typeof formSchema>;

function toForm(s: Settings): FormValues {
  return {
    business: {
      ...s.business,
      mobile: formatPhPhone(s.business.mobile),
      landline: formatPhPhone(s.business.landline),
    },
    fuel: {
      gasoline: centavosToInput(s.fuel_prices_centavos.gasoline),
      premium: centavosToInput(s.fuel_prices_centavos.premium),
      diesel: centavosToInput(s.fuel_prices_centavos.diesel),
    },
    quoteValidityHours: String(s.quote_validity_hours),
    turnaroundBufferMinutes: String(s.turnaround_buffer_minutes),
    lateReturnGraceMinutes: String(s.late_return_grace_minutes),
  };
}

/** Server field paths → form field paths. */
const SERVER_TO_FORM: Record<string, string> = {
  quote_validity_hours: "quoteValidityHours",
  turnaround_buffer_minutes: "turnaroundBufferMinutes",
  late_return_grace_minutes: "lateReturnGraceMinutes",
};

export function SettingsForm({ initial, readOnly }: { initial: Settings; readOnly: boolean }) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toForm(initial),
  });

  async function onSubmit(v: FormValues) {
    const result = await updateSettingsAction({
      business: v.business,
      fuel_prices_centavos: {
        gasoline: parsePesoToCentavos(v.fuel.gasoline)!,
        premium: parsePesoToCentavos(v.fuel.premium)!,
        diesel: parsePesoToCentavos(v.fuel.diesel)!,
      },
      quote_validity_hours: Number(v.quoteValidityHours),
      turnaround_buffer_minutes: Number(v.turnaroundBufferMinutes),
      late_return_grace_minutes: Number(v.lateReturnGraceMinutes),
    });
    if (!result.ok) {
      applyFieldErrors(form.setError, {
        ...result,
        fieldErrors: Object.fromEntries(
          Object.entries(result.fieldErrors ?? {}).map(([k, m]) => [
            SERVER_TO_FORM[k] ?? k.replace(/^fuel_prices_centavos./, "fuel."),
            m,
          ]),
        ),
      });
      toast.error(result.error);
      return;
    }
    toast.success(
      result.data.changed.length ? "Settings saved" : "No changes to save",
    );
  }

  const disabled = readOnly || form.formState.isSubmitting;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex max-w-3xl flex-col gap-6">
      <fieldset disabled={readOnly} className="contents">
        <Card>
          <CardHeader>
            <CardTitle>Business details</CardTitle>
            <CardDescription>Printed on quotations and the booking page.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <TextField control={form.control} name="business.name" label="Business name" disabled={disabled} />
              <TextField control={form.control} name="business.email" label="Email" type="email" disabled={disabled} />
              <div className="md:col-span-2">
                <TextField control={form.control} name="business.address" label="Address" disabled={disabled} />
              </div>
              <TextField control={form.control} name="business.mobile" label="Mobile" inputMode="tel" disabled={disabled} />
              <TextField control={form.control} name="business.landline" label="Landline" inputMode="tel" disabled={disabled} />
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Default fuel prices</CardTitle>
            <CardDescription>Pesos per litre. Used for fuel estimates and fuel shortage charges.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-4 md:grid-cols-3">
              <TextField control={form.control} name="fuel.gasoline" label="Gasoline (₱/L)" inputMode="decimal" disabled={disabled} />
              <TextField control={form.control} name="fuel.premium" label="Premium (₱/L)" inputMode="decimal" disabled={disabled} />
              <TextField control={form.control} name="fuel.diesel" label="Diesel (₱/L)" inputMode="decimal" disabled={disabled} />
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Booking rules</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <TextField
                control={form.control}
                name="quoteValidityHours"
                label="Quotation validity (hours)"
                inputMode="numeric"
                disabled={disabled}
              />
              <TextField
                control={form.control}
                name="turnaroundBufferMinutes"
                label="Turnaround buffer (minutes)"
                inputMode="numeric"
                description="Added after each return before the car can be booked again."
                disabled={disabled}
              />
              <TextField
                control={form.control}
                name="lateReturnGraceMinutes"
                label="Late return grace (minutes)"
                inputMode="numeric"
                description="A return later than this after the booked end is charged every late hour."
                disabled={disabled}
              />
            </FieldGroup>
          </CardContent>
        </Card>
      </fieldset>

      {!readOnly ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving…" : "Save settings"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

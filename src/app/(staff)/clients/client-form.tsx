"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { applyFieldErrors, SelectField, TextareaField, TextField } from "@/components/form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { CLIENT_TYPE_LABELS, CLIENT_TYPES, clientSchema, type ClientInput } from "@/lib/clients/schema";
import { createClientAction, updateClientAction } from "./actions";

/** Create or edit a client. `initial` values are display strings. */
export function ClientForm({ id, initial }: { id?: string; initial?: ClientInput }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ClientInput>({
    resolver: zodResolver(clientSchema) as unknown as Resolver<ClientInput>,
    defaultValues: initial ?? { fullName: "", clientType: "individual" },
  });

  async function onSubmit(values: ClientInput) {
    setError(null);
    const r = id ? await updateClientAction({ id, client: values }) : await createClientAction(values);
    if (!r.ok) {
      // Update errors are keyed `client.phone`; map them back to the form.
      applyFieldErrors(form.setError, {
        ...r,
        fieldErrors: Object.fromEntries(Object.entries(r.fieldErrors ?? {}).map(([k, v]) => [k.replace(/^client\./, ""), v])),
      });
      setError(r.error);
      return;
    }
    toast.success(id ? "Client saved" : "Client created");
    router.push(`/clients/${r.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardContent>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <TextField control={form.control} name="fullName" label="Full name" autoComplete="off" />
            <TextField control={form.control} name="fbName" label="FB name" autoComplete="off" />
            <TextField control={form.control} name="phone" label="Phone" placeholder="0917 123 4567" inputMode="tel" />
            <TextField control={form.control} name="email" label="Email" type="email" />
            <TextField control={form.control} name="birthday" label="Birthday" type="date" />
            <SelectField
              control={form.control}
              name="clientType"
              label="Client type"
              options={CLIENT_TYPES.map((t) => ({ value: t, label: CLIENT_TYPE_LABELS[t] }))}
            />
            <TextField control={form.control} name="companyName" label="Company" />
            <TextField control={form.control} name="driversLicenseNo" label="Driver's license no." />
            <div className="sm:col-span-2">
              <TextareaField control={form.control} name="address" label="Complete address" rows={2} />
            </div>
            <TextField control={form.control} name="altContactName" label="Alternative contact person" />
            <TextField control={form.control} name="altContactPhone" label="Alternative contact no." inputMode="tel" />
            <div className="sm:col-span-2">
              <TextareaField control={form.control} name="notes" label="Notes" rows={3} />
            </div>
          </FieldGroup>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button asChild variant="outline" type="button">
          <Link href={id ? `/clients/${id}` : "/clients"}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : id ? "Save" : "Create client"}
        </Button>
      </div>
    </form>
  );
}

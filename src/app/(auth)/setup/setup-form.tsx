"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { applyFieldErrors, TextField } from "@/components/form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { setupSchema, type SetupInput } from "@/lib/setup/schema";
import { setupAction } from "./actions";

export function SetupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<SetupInput>({
    resolver: zodResolver(setupSchema),
    defaultValues: { setupToken: "", name: "", email: "", password: "", confirmPassword: "" },
  });

  async function onSubmit(values: SetupInput) {
    setError(null);
    const result = await setupAction(values);
    if (!result.ok) {
      applyFieldErrors(form.setError, result);
      setError(result.status === 404 ? "Setup is already complete." : result.error);
      return;
    }
    router.replace("/login?setup=done");
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <TextField control={form.control} name="setupToken" label="Setup token" type="password" autoComplete="off" />
        <FieldSeparator />
        <TextField control={form.control} name="name" label="Your name" autoComplete="name" />
        <TextField control={form.control} name="email" label="Email" type="email" autoComplete="email" />
        <TextField
          control={form.control}
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        <TextField control={form.control} name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Creating…" : "Create Super Admin"}
        </Button>
      </FieldGroup>
    </form>
  );
}

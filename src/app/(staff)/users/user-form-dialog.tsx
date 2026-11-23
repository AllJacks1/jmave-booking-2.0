"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { applyFieldErrors, TextField } from "@/components/form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Role } from "@/db/schema";
import { ROLE_LABELS } from "@/lib/permissions";
import {
  createUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/lib/users/schema";
import { createUserAction, updateUserAction } from "./actions";

export type EditableUser = { id: string; name: string; displayName: string; role: Role };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
} & (
  | { mode: "create"; onCreated: (email: string, temporaryPassword: string) => void; user?: never }
  | { mode: "edit"; user: EditableUser; onCreated?: never }
);

type FormValues = Omit<CreateUserInput, "email"> & { email?: string; id?: string };

export function UserFormDialog(props: Props) {
  const { open, onOpenChange, roles, mode } = props;
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    // Edit mode has no email field; validate the rest with the same schema.
    resolver: zodResolver(
      mode === "create" ? createUserSchema : createUserSchema.omit({ email: true }),
    ) as unknown as Resolver<FormValues>,
    defaultValues:
      mode === "edit"
        ? { id: props.user.id, name: props.user.name, displayName: props.user.displayName, role: props.user.role, email: undefined }
        : { name: "", displayName: "", email: "", role: roles.includes("sales") ? "sales" : roles[0] },
  });

  // Roles offered: those the actor may assign, plus the user's current role.
  const roleOptions = mode === "edit" && !roles.includes(props.user.role) ? [props.user.role, ...roles] : roles;

  async function onSubmit(values: FormValues) {
    setError(null);
    if (mode === "create") {
      const result = await createUserAction({
        name: values.name,
        displayName: values.displayName,
        email: values.email ?? "",
        role: values.role,
      });
      if (!result.ok) {
        applyFieldErrors(form.setError, result);
        setError(result.error);
        return;
      }
      toast.success(`${result.data.user.displayName} created`);
      form.reset();
      onOpenChange(false);
      props.onCreated(result.data.user.email, result.data.temporaryPassword);
    } else {
      const input: UpdateUserInput = {
        id: props.user.id,
        name: values.name,
        displayName: values.displayName,
        role: values.role,
      };
      const result = await updateUserAction(input);
      if (!result.ok) {
        applyFieldErrors(form.setError, result);
        setError(result.error);
        return;
      }
      toast.success("User updated");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "New user" : "Edit user"}</DialogTitle>
            <DialogDescription>
              {mode === "create"
                ? "A temporary password is generated. The user must change it at first sign-in."
                : "Change the name or role."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <TextField control={form.control} name="name" label="Full name" autoComplete="off" />
            <TextField
              control={form.control}
              name="displayName"
              label="Display name"
              autoComplete="off"
              description="Shown on quotations as the booking consultant."
            />
            {mode === "create" ? (
              <TextField control={form.control} name="email" label="Email" type="email" autoComplete="off" />
            ) : null}
            <Controller
              control={form.control}
              name="role"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="role">Role</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="role" aria-invalid={fieldState.invalid}>
                      <SelectValue placeholder="Pick a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((r) => (
                        <SelectItem key={r} value={r} disabled={!roles.includes(r)}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Saving…" : mode === "create" ? "Create user" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import type { ComponentProps, ReactNode } from "react";
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
  type UseFormSetError,
} from "react-hook-form";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ActionFailure } from "@/lib/actions";

type TextFieldProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: ReactNode;
} & Omit<ComponentProps<typeof Input>, "name" | "defaultValue" | "value" | "onChange">;

/** Text input bound to react-hook-form with shadcn Field + error. */
export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  ...inputProps
}: TextFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            {...inputProps}
            {...field}
            value={field.value ?? ""}
            id={name}
            aria-invalid={fieldState.invalid}
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

/** Copy server-side field errors onto the form. */
export function applyFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  failure: ActionFailure,
) {
  for (const [key, messages] of Object.entries(failure.fieldErrors ?? {})) {
    if (messages?.[0]) setError(key as FieldPath<T>, { type: "server", message: messages[0] });
  }
}

type BaseProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
};

/** Number input; empty → null. */
export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  step = "1",
  placeholder,
}: BaseProps<T> & { step?: string; placeholder?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            id={name}
            type="number"
            inputMode="decimal"
            step={step}
            placeholder={placeholder}
            disabled={disabled}
            value={field.value ?? ""}
            onBlur={field.onBlur}
            onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
            aria-invalid={fieldState.invalid}
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

/** Peso input bound to a centavos value (₱1,580.00 ↔ 158000); empty → null or 0. */
export function PesoField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  emptyAs = null,
}: BaseProps<T> & { emptyAs?: null | 0 }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            id={name}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            disabled={disabled}
            value={field.value === null || field.value === undefined ? "" : field.value / 100}
            onBlur={field.onBlur}
            onChange={(e) =>
              field.onChange(e.target.value === "" ? emptyAs : Math.round(Number(e.target.value) * 100))
            }
            aria-invalid={fieldState.invalid}
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

const NONE = "__none__";

/** Select bound to a string value; optional "None" → null. */
export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  options,
  noneLabel,
}: BaseProps<T> & { options: { value: string; label: string }[]; noneLabel?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Select
            disabled={disabled}
            value={field.value === null || field.value === undefined ? (noneLabel ? NONE : "") : String(field.value)}
            onValueChange={(v) => field.onChange(v === NONE ? null : v)}
          >
            <SelectTrigger id={name} aria-invalid={fieldState.invalid} className="w-full">
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
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

/** On/off switch bound to a boolean. */
export function SwitchField<T extends FieldValues>({ control, name, label, description, disabled }: BaseProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field orientation="horizontal">
          <Switch id={name} checked={!!field.value} onCheckedChange={field.onChange} disabled={disabled} />
          <FieldLabel htmlFor={name} className="font-normal">
            {label}
          </FieldLabel>
          {description ? <FieldDescription>{description}</FieldDescription> : null}
        </Field>
      )}
    />
  );
}

/** Multi-line text. */
export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  rows = 3,
}: BaseProps<T> & { rows?: number }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Textarea id={name} rows={rows} disabled={disabled} {...field} value={field.value ?? ""} aria-invalid={fieldState.invalid} />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

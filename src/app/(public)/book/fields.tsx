"use client";

/**
 * Light form fields for the public booking page: native inputs and selects
 * (fast on phones, small bundle) bound to react-hook-form with shadcn Field.
 */
import type { ComponentProps, ReactNode } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Base<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: ReactNode;
};

const inputClass = "h-11 text-base md:h-10 md:text-sm";

export function PField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  number,
  ...rest
}: Base<T> & { number?: boolean } & Omit<ComponentProps<"input">, "name" | "value" | "onChange" | "defaultValue">) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            {...rest}
            id={name}
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            className={inputClass}
            value={field.value === null || field.value === undefined || (number && field.value === 0 && rest.placeholder) ? "" : String(field.value)}
            onChange={(e) => field.onChange(number ? (e.target.value === "" ? 0 : Number(e.target.value)) : e.target.value)}
            aria-invalid={fieldState.invalid}
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

export function PSelect<T extends FieldValues>({
  control,
  name,
  label,
  description,
  options,
  number,
}: Base<T> & { options: readonly { value: string; label: string }[]; number?: boolean }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <select
            id={name}
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            value={String(field.value ?? "")}
            onChange={(e) => field.onChange(number ? Number(e.target.value) : e.target.value)}
            aria-invalid={fieldState.invalid}
            className={`${inputClass} w-full rounded-lg border border-input bg-transparent px-2.5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30`}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

export function PTextarea<T extends FieldValues>({ control, name, label, description, rows = 3, placeholder }: Base<T> & { rows?: number; placeholder?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Textarea id={name} rows={rows} placeholder={placeholder} {...field} value={field.value ?? ""} className="text-base md:text-sm" aria-invalid={fieldState.invalid} />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

/** Several checkboxes bound to a string array. */
export function PChecks<T extends FieldValues>({ control, name, label, description, options }: Base<T> & { options: readonly string[] }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const value: string[] = Array.isArray(field.value) ? field.value : [];
        return (
          <fieldset className="flex flex-col gap-2" data-invalid={fieldState.invalid}>
            <legend className="mb-1 text-sm font-medium">{label}</legend>
            <div className="grid grid-cols-2 gap-2">
              {options.map((o) => (
                <label key={o} className="flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm has-checked:border-primary has-checked:bg-primary/5">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={value.includes(o)}
                    onChange={(e) => field.onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))}
                  />
                  {o}
                </label>
              ))}
            </div>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
          </fieldset>
        );
      }}
    />
  );
}

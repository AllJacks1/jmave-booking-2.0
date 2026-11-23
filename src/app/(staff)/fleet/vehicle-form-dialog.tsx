"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { applyFieldErrors, NumberField, PesoField, SelectField, SwitchField, TextField } from "@/components/form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { FUEL_TYPE_LABELS, OWNERSHIP_LABELS, OWNERSHIPS, vehicleSchema, type VehicleInput } from "@/lib/fleet/schema";
import { BODY_TYPE_LABELS, BODY_TYPES, FUEL_TYPES } from "@/lib/pricing/types";
import { createVehicleAction, updateVehicleAction } from "./actions";
import type { VehicleItem } from "./fleet-table";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle?: VehicleItem;
  nextSortOrder?: number;
};

function defaults(vehicle: VehicleItem | undefined, nextSortOrder: number): VehicleInput {
  if (!vehicle) {
    return {
      displayName: "",
      plate: "",
      ownership: "owned",
      active: true,
      sortOrder: nextSortOrder,
      bodyType: null,
      fuelType: null,
      year: null,
      tankCapacityL: null,
      dailyRateDisplay: null,
    };
  }
  return {
    displayName: vehicle.displayName,
    plate: vehicle.plate ?? "",
    make: vehicle.make ?? "",
    model: vehicle.model ?? "",
    year: vehicle.year,
    color: vehicle.color ?? "",
    transmission: vehicle.transmission ?? "",
    chassisNo: vehicle.chassisNo ?? "",
    engineNo: vehicle.engineNo ?? "",
    engine: vehicle.engine ?? "",
    bodyType: vehicle.bodyType,
    fuelType: vehicle.fuelType,
    tankCapacityL: vehicle.tankCapacityL,
    ownership: vehicle.ownership,
    operatorName: vehicle.operatorName ?? "",
    dailyRateDisplay: vehicle.dailyRateDisplay,
    active: vehicle.active,
    sortOrder: vehicle.sortOrder,
  };
}

export function VehicleFormDialog({ open, onOpenChange, vehicle, nextSortOrder = 0 }: Props) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<VehicleInput>({
    resolver: zodResolver(vehicleSchema) as unknown as Resolver<VehicleInput>,
    defaultValues: defaults(vehicle, nextSortOrder),
  });
  const ownership = useWatch({ control: form.control, name: "ownership" });

  async function onSubmit(values: VehicleInput) {
    setError(null);
    const result = vehicle ? await updateVehicleAction({ id: vehicle.id, vehicle: values }) : await createVehicleAction(values);
    if (!result.ok) {
      applyFieldErrors(form.setError, result);
      setError(result.error);
      return;
    }
    toast.success(vehicle ? "Vehicle saved" : "Vehicle added");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{vehicle ? "Edit vehicle" : "Add vehicle"}</DialogTitle>
            <DialogDescription>Body type and fuel type set the pricing defaults on quotations.</DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <TextField control={form.control} name="displayName" label="Display name" autoComplete="off" />
            <TextField control={form.control} name="plate" label="Plate" autoComplete="off" />
            <TextField control={form.control} name="make" label="Make" />
            <TextField control={form.control} name="model" label="Model" />
            <NumberField control={form.control} name="year" label="Year" />
            <TextField control={form.control} name="color" label="Color" />
            <SelectField
              control={form.control}
              name="bodyType"
              label="Body type"
              noneLabel="Not set"
              options={BODY_TYPES.map((b) => ({ value: b, label: BODY_TYPE_LABELS[b] }))}
            />
            <SelectField
              control={form.control}
              name="fuelType"
              label="Fuel"
              noneLabel="Not set"
              options={FUEL_TYPES.map((f) => ({ value: f, label: FUEL_TYPE_LABELS[f] }))}
            />
            <TextField control={form.control} name="transmission" label="Transmission" />
            <NumberField control={form.control} name="tankCapacityL" label="Tank capacity (L)" />
            <TextField control={form.control} name="chassisNo" label="Chassis no." />
            <TextField control={form.control} name="engineNo" label="Engine no." />
            <TextField control={form.control} name="engine" label="Engine" />
            <PesoField control={form.control} name="dailyRateDisplay" label="Daily rate (display only)" />
            <SelectField
              control={form.control}
              name="ownership"
              label="Ownership"
              options={OWNERSHIPS.map((o) => ({ value: o, label: OWNERSHIP_LABELS[o] }))}
            />
            <TextField
              control={form.control}
              name="operatorName"
              label={ownership === "operator" ? "Operator name" : "Operator name (optional)"}
            />
            <NumberField
              control={form.control}
              name="sortOrder"
              label="Sort order"
              description="Lower numbers come first on lists and the calendar."
            />
            <SwitchField control={form.control} name="active" label="Active (can be quoted and booked)" />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

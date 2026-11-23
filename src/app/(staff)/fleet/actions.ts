"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import type { VehicleInput } from "@/lib/fleet/schema";
import { createVehicle, updateVehicle } from "@/lib/fleet/service";

export async function createVehicleAction(input: VehicleInput) {
  const result = await createVehicle(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/fleet");
  return result;
}

export async function updateVehicleAction(input: { id: string; vehicle: VehicleInput }) {
  const result = await updateVehicle(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/fleet");
  return result;
}

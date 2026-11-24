"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import type { DriverInput } from "@/lib/bookings/schema";
import { saveDriver } from "@/lib/drivers/service";

export async function saveDriverAction(input: DriverInput) {
  const r = await saveDriver(await getCurrentUser(), input);
  if (r.ok) revalidatePath("/drivers");
  return r;
}

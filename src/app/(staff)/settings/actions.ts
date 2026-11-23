"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import type { SettingsInput } from "@/lib/settings/schema";
import { updateSettings } from "@/lib/settings/service";

export async function updateSettingsAction(input: SettingsInput) {
  const result = await updateSettings(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/settings");
  return result;
}

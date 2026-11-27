"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { sendTestLead } from "@/lib/rework/leads";
import type { ReworkSettingsInput, SettingsInput } from "@/lib/settings/schema";
import { updateReworkSettings, updateSettings } from "@/lib/settings/service";

export async function updateSettingsAction(input: SettingsInput) {
  const result = await updateSettings(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function updateReworkSettingsAction(input: ReworkSettingsInput) {
  const result = await updateReworkSettings(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function sendTestLeadAction() {
  const result = await sendTestLead(await getCurrentUser(), {});
  if (result.ok) revalidatePath("/settings");
  return result;
}

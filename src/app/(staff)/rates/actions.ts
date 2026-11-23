"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import type { HolidayInput, UpdateDraftInput } from "@/lib/rates/schema";
import { activateRateCard, addHoliday, createDraft, removeHoliday, updateDraft } from "@/lib/rates/service";

export async function createDraftAction(input: { fromId: string; name: string }) {
  const result = await createDraft(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/rates", "layout");
  return result;
}

export async function updateDraftAction(input: UpdateDraftInput) {
  const result = await updateDraft(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/rates", "layout");
  return result;
}

export async function activateRateCardAction(input: { id: string }) {
  const result = await activateRateCard(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/rates", "layout");
  return result;
}

export async function addHolidayAction(input: HolidayInput) {
  const result = await addHoliday(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/rates/holidays");
  return result;
}

export async function removeHolidayAction(input: { id: string }) {
  const result = await removeHoliday(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/rates/holidays");
  return result;
}

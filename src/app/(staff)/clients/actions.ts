"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import type { BlacklistInput, ClientInput } from "@/lib/clients/schema";
import { createClient, setBlacklist, updateClient } from "@/lib/clients/service";
import { sendClientToRework } from "@/lib/rework/leads";

export async function createClientAction(input: ClientInput) {
  const result = await createClient(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/clients");
  return result;
}

export async function updateClientAction(input: { id: string; client: ClientInput }) {
  const result = await updateClient(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/clients", "layout");
  return result;
}

export async function setBlacklistAction(input: BlacklistInput) {
  const result = await setBlacklist(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/clients", "layout");
  return result;
}

export async function sendClientToReworkAction(input: { id: string; again: boolean }) {
  const result = await sendClientToRework(await getCurrentUser(), input);
  if (result.ok) revalidatePath(`/clients/${input.id}`);
  return result;
}

"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import type { AdjustInput, LinkClientInput, TierInput } from "@/lib/loyalty/schema";
import { adjustPoints, linkClient, setTier } from "@/lib/loyalty/service";

function refresh<T extends { ok: boolean }>(r: T): T {
  if (r.ok) {
    revalidatePath("/rewards", "layout");
    revalidatePath("/clients", "layout");
  }
  return r;
}

export async function adjustPointsAction(input: AdjustInput) {
  return refresh(await adjustPoints(await getCurrentUser(), input));
}

export async function setTierAction(input: TierInput) {
  return refresh(await setTier(await getCurrentUser(), input));
}

export async function linkClientAction(input: LinkClientInput) {
  return refresh(await linkClient(await getCurrentUser(), input));
}

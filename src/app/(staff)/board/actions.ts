"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import type { ReleaseInput, ReturnInput } from "@/lib/check-in/schema";
import { previewReturn, recordRelease, recordReturn } from "@/lib/check-in/service";

function refresh<T extends { ok: boolean }>(r: T): T {
  if (r.ok) {
    revalidatePath("/board");
    revalidatePath("/calendar");
    revalidatePath("/bookings", "layout");
  }
  return r;
}

export async function releaseAction(input: ReleaseInput) {
  return refresh(await recordRelease(await getCurrentUser(), input));
}

export async function previewReturnAction(input: ReturnInput) {
  return previewReturn(await getCurrentUser(), input);
}

export async function returnAction(input: ReturnInput) {
  return refresh(await recordReturn(await getCurrentUser(), input));
}

"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { copyPreviousWeek, setShift, type SetShiftInput } from "@/lib/roster/service";

function refresh<T extends { ok: boolean }>(r: T): T {
  if (r.ok) {
    revalidatePath("/roster");
    revalidatePath("/board");
    revalidatePath("/dashboard");
  }
  return r;
}

export async function setShiftAction(input: SetShiftInput) {
  return refresh(await setShift(await getCurrentUser(), input));
}

export async function copyPreviousWeekAction(input: { week: string }) {
  return refresh(await copyPreviousWeek(await getCurrentUser(), input));
}

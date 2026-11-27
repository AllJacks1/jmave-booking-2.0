"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { rejectInquiry } from "@/lib/inquiries/service";

export async function rejectInquiryAction(input: { id: string; reason: string }) {
  const r = await rejectInquiry(await getCurrentUser(), input);
  if (r.ok) {
    revalidatePath("/inquiries");
    revalidatePath(`/inquiries/${input.id}`);
  }
  return r;
}

"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { commitImport } from "@/lib/import/service";

export async function commitImportAction(input: { runId: string }) {
  const result = await commitImport(await getCurrentUser(), input);
  if (result.ok) {
    revalidatePath("/import", "layout");
    revalidatePath("/fleet");
    revalidatePath("/rates", "layout");
    revalidatePath("/clients", "layout");
  }
  return result;
}

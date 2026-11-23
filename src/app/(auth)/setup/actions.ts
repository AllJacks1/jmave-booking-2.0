"use server";

import type { ActionResult } from "@/lib/actions";
import { runSetup } from "@/lib/setup/service";
import type { SetupInput } from "@/lib/setup/schema";

export async function setupAction(input: SetupInput): Promise<ActionResult<{ userId: string }>> {
  return runSetup(input);
}

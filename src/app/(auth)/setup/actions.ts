"use server";

import { headers } from "next/headers";
import type { ActionResult } from "@/lib/actions";
import { clientIp } from "@/lib/public/guard";
import { runSetup } from "@/lib/setup/service";
import type { SetupInput } from "@/lib/setup/schema";

/** Public by design (PLAN §6.4): guarded by SETUP_TOKEN, an empty user table and a per-IP limit. */
export async function setupAction(input: SetupInput): Promise<ActionResult<{ userId: string }>> {
  return runSetup(input, process.env.SETUP_TOKEN, clientIp(await headers()));
}

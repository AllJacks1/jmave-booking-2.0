import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { type ActionResult, toFailure, ActionError, fieldErrorsFromZod } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { ensureDefaultSettings } from "@/lib/settings/service";
import { countUsers, insertUserWithPassword } from "@/lib/users/service";
import { setupSchema, type SetupInput } from "./schema";

/** Constant-time comparison of the submitted token with SETUP_TOKEN. */
export function setupTokenMatches(submitted: string, expected: string | undefined): boolean {
  if (!expected) return false;
  // Hash both sides so lengths match and length is not leaked.
  const a = createHash("sha256").update(submitted, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function isSetupOpen(): Promise<boolean> {
  return (await countUsers()) === 0;
}

/**
 * Create the first Super Admin (PLAN §6.4). Works only while `user` is empty
 * and with the correct SETUP_TOKEN. The transaction takes an advisory lock and
 * re-checks emptiness, so two concurrent submissions cannot both succeed.
 */
export async function runSetup(
  raw: SetupInput,
  expectedToken = process.env.SETUP_TOKEN,
): Promise<ActionResult<{ userId: string }>> {
  try {
    if (!(await isSetupOpen())) throw new ActionError(404, "Not found.");
    const parsed = setupSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        status: 400,
        error: "Please fix the highlighted fields.",
        fieldErrors: fieldErrorsFromZod(parsed.error),
      };
    }
    const input = parsed.data;
    if (!setupTokenMatches(input.setupToken, expectedToken)) {
      throw new ActionError(403, "The setup token is not correct.", {
        setupToken: ["Incorrect token"],
      });
    }

    const userId = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('jmave:first-run-setup'))`);
      if ((await countUsers(tx)) > 0) throw new ActionError(404, "Not found.");
      const created = await insertUserWithPassword(tx, {
        name: input.name,
        displayName: input.name,
        email: input.email,
        role: "super_admin",
        password: input.password,
        mustChangePassword: false,
      });
      await ensureDefaultSettings(tx, created.id);
      await withAudit(
        created,
        "setup.super_admin_created",
        "user",
        created.id,
        null,
        { id: created.id, email: created.email, name: created.name, role: created.role },
        tx,
      );
      return created.id;
    });
    return { ok: true, data: { userId } };
  } catch (err) {
    return toFailure(err);
  }
}

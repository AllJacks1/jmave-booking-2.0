"use server";

import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { user } from "@/db/schema";
import { type ActionResult, toFailure, fieldErrorsFromZod } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { changePasswordSchema, type ChangePasswordInput } from "@/lib/users/schema";

export async function changePasswordAction(
  raw: ChangePasswordInput,
): Promise<ActionResult<{ landing: string }>> {
  try {
    const actor = await getCurrentUser();
    if (!actor) return { ok: false, status: 401, error: "You are not signed in." };
    const parsed = changePasswordSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        status: 400,
        error: "Please fix the highlighted fields.",
        fieldErrors: fieldErrorsFromZod(parsed.error),
      };
    }
    try {
      await auth.api.changePassword({
        body: {
          currentPassword: parsed.data.currentPassword,
          newPassword: parsed.data.newPassword,
          revokeOtherSessions: true,
        },
        headers: await headers(),
      });
    } catch (err) {
      if (err instanceof APIError) {
        return {
          ok: false,
          status: 400,
          error: "Current password is incorrect.",
          fieldErrors: { currentPassword: ["Incorrect password"] },
        };
      }
      throw err;
    }
    await db.transaction(async (tx) => {
      await tx.update(user).set({ mustChangePassword: false }).where(eq(user.id, actor.id));
      await withAudit(
        actor,
        "user.change_password",
        "user",
        actor.id,
        { mustChangePassword: actor.mustChangePassword },
        { mustChangePassword: false },
        tx,
      );
    });
    return { ok: true, data: { landing: actor.role === "operations" ? "/board" : "/dashboard" } };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Server action plumbing.
 *
 * Server actions cannot set an HTTP status, so they return an `ActionResult`
 * whose `status` mirrors HTTP (400, 401, 403, 404, 409, 500). Each action is
 * built as `run(actor, input)` so tests can call the exact same code path with
 * any role; the `"use server"` export only adds the session lookup.
 */
import { z } from "zod";
import {
  ForbiddenError,
  requirePermission,
  UnauthorizedError,
  type Action,
} from "@/lib/permissions";
import type { CurrentUser } from "@/lib/auth/session";

export type ActionFailure = {
  ok: false;
  status: 400 | 401 | 403 | 404 | 409 | 500;
  error: string;
  fieldErrors?: Record<string, string[] | undefined>;
};
export type ActionResult<T = undefined> = { ok: true; data: T } | ActionFailure;

export class ActionError extends Error {
  constructor(
    public readonly status: ActionFailure["status"],
    message: string,
    public readonly fieldErrors?: ActionFailure["fieldErrors"],
  ) {
    super(message);
    this.name = "ActionError";
  }
}

export type ActionRunner<I, T> = (
  actor: CurrentUser | null,
  input: I,
) => Promise<ActionResult<T>>;

export function defineAction<S extends z.ZodType, T>(opts: {
  /** Checked before input parsing. Resource-level checks go in the handler. */
  permission: Action;
  input: S;
  handler: (actor: CurrentUser, input: z.infer<S>) => Promise<T>;
}): ActionRunner<z.input<S>, T> {
  return async (actor, raw) => {
    try {
      if (actor?.mustChangePassword) {
        throw new ActionError(403, "Change your password first.");
      }
      requirePermission(actor, opts.permission);
      const parsed = opts.input.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          status: 400,
          error: "Please fix the highlighted fields.",
          fieldErrors: fieldErrorsFromZod(parsed.error),
        };
      }
      return { ok: true, data: await opts.handler(actor, parsed.data) };
    } catch (err) {
      return toFailure(err);
    }
  };
}

/** Zod issues → { "business.mobile": ["…"] } (dot paths, first message first). */
export function fieldErrorsFromZod(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function toFailure(err: unknown): ActionFailure {
  if (err instanceof UnauthorizedError) {
    return { ok: false, status: 401, error: "You are not signed in." };
  }
  if (err instanceof ForbiddenError) {
    return { ok: false, status: 403, error: "You do not have permission to do that." };
  }
  if (err instanceof ActionError) {
    return { ok: false, status: err.status, error: err.message, fieldErrors: err.fieldErrors };
  }
  console.error("Unhandled action error:", err instanceof Error ? err.message : err);
  return { ok: false, status: 500, error: "Something went wrong. Please try again." };
}

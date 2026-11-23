import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db/client";
import { user, type Role } from "@/db/schema";
import { auth } from "./index";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  displayName: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
};

/**
 * The signed-in, active user for this request, or null.
 * Reads the user row fresh so role / active changes apply immediately.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const row = await db.query.user.findFirst({ where: eq(user.id, s.user.id) });
  if (!row || !row.active) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    displayName: row.displayName,
    role: row.role,
    active: row.active,
    mustChangePassword: row.mustChangePassword,
  };
});

/** For pages: redirect to /login when signed out, /change-password when forced. */
export async function requireUser(opts?: {
  allowMustChangePassword?: boolean;
}): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (u.mustChangePassword && !opts?.allowMustChangePassword) {
    redirect("/change-password");
  }
  return u;
}

export function landingPath(role: Role): string {
  return role === "operations" ? "/board" : "/dashboard";
}

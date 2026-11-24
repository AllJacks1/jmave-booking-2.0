import "server-only";
import { forbidden } from "next/navigation";
import { requireUser, type CurrentUser } from "@/lib/auth/session";
import { can, type Action } from "@/lib/permissions";

/** Booking / driver pages: Sales and up; Operations get a real 403. */
export async function requirePermissionPage(action: Action = "bookings.manage"): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, action)) forbidden();
  return user;
}

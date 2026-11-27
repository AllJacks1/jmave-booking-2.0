import "server-only";
import { forbidden } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";

/** Inbox pages: Sales+; others get a real 403. */
export async function requireInquiriesPage() {
  const user = await requireUser();
  if (!can(user, "inquiries.manage")) forbidden();
  return user;
}

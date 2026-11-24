import "server-only";
import { forbidden } from "next/navigation";
import { requireUser, type CurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";

/** Quotation pages: signed-in Sales and up; everyone else gets a real 403. */
export async function requireQuotesPage(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, "quotes.manage")) forbidden();
  return user;
}

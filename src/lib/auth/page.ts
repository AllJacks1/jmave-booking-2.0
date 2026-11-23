import "server-only";
import { can, type Action } from "@/lib/permissions";
import { requireUser, type CurrentUser } from "./session";

/**
 * For staff pages: signed-in user plus whether they may open the page.
 * Pages render <NoAccess /> when `allowed` is false.
 */
export async function requirePage(
  action: Action,
): Promise<{ user: CurrentUser; allowed: boolean }> {
  const user = await requireUser();
  return { user, allowed: can(user, action) };
}

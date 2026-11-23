import { ComingSoon, NoAccess } from "@/components/placeholders";
import { requirePage } from "@/lib/auth/page";
import { navItem } from "@/lib/nav";

/** A staff page that exists in the menu but is built in a later phase. */
export async function PlaceholderPage({ href }: { href: string }) {
  const item = navItem(href);
  const { allowed } = await requirePage(item.permission);
  if (!allowed) return <NoAccess />;
  return <ComingSoon title={item.label} phase={item.comingIn ?? "?"} />;
}

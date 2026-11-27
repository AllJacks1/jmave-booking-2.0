import { can, type Action, type Actor } from "@/lib/permissions";

export type NavIcon =
  | "dashboard"
  | "quotes"
  | "inquiries"
  | "bookings"
  | "calendar"
  | "board"
  | "clients"
  | "rewards"
  | "drivers"
  | "roster"
  | "fleet"
  | "rates"
  | "import"
  | "users"
  | "audit"
  | "settings";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** Permission needed to see the item and open the page. */
  permission: Action;
  /** Phase that delivers the page; undefined when it already exists. */
  comingIn?: string;
  group: "work" | "operations" | "admin";
};

/**
 * The staff menu. The Operations menu ends up as Board, Calendar, Roster
 * (phase 2b brief §9) because those are the only `*.view` actions they hold.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", permission: "quotes.manage", group: "work" },
  { href: "/inquiries", label: "Booking requests", icon: "inquiries", permission: "inquiries.manage", group: "work" },
  { href: "/quotes", label: "Quotations", icon: "quotes", permission: "quotes.manage", group: "work" },
  { href: "/bookings", label: "Bookings", icon: "bookings", permission: "bookings.manage", group: "work" },
  { href: "/clients", label: "Clients", icon: "clients", permission: "clients.view", group: "work" },
  { href: "/rewards", label: "Rewards", icon: "rewards", permission: "rewards.view", group: "work" },
  { href: "/board", label: "Movement board", icon: "board", permission: "board.view", group: "operations" },
  { href: "/calendar", label: "Calendar", icon: "calendar", permission: "calendar.view", group: "operations" },
  { href: "/roster", label: "Roster", icon: "roster", permission: "roster.view", group: "operations" },
  { href: "/drivers", label: "Drivers", icon: "drivers", permission: "drivers.manage", group: "operations" },
  { href: "/fleet", label: "Fleet", icon: "fleet", permission: "fleet.view", group: "admin" },
  { href: "/rates", label: "Rates", icon: "rates", permission: "rates.view", group: "admin" },
  { href: "/import", label: "Import", icon: "import", permission: "import.view", group: "admin" },
  { href: "/users", label: "Users", icon: "users", permission: "users.view", group: "admin" },
  { href: "/audit", label: "Audit log", icon: "audit", permission: "audit.view", comingIn: "5", group: "admin" },
  { href: "/settings", label: "Settings", icon: "settings", permission: "settings.view", group: "admin" },
];

export const NAV_GROUP_LABELS: Record<NavItem["group"], string> = {
  work: "Sales",
  operations: "Operations",
  admin: "Administration",
};

export function navForUser(user: Actor): NavItem[] {
  return NAV_ITEMS.filter((item) => can(user, item.permission));
}

export function navItem(href: string): NavItem {
  const item = NAV_ITEMS.find((i) => i.href === href);
  if (!item) throw new Error(`Unknown nav item ${href}`);
  return item;
}

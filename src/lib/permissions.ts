/**
 * The single permission table for J-MaVe Booking (PLAN.md §2).
 *
 * Every server action and route handler checks `can()` / `requirePermission()`.
 * Hiding UI is never the protection. Later phases only consume this table;
 * add a row here (and its test) if a new action appears.
 */
import { ROLES, type Role } from "@/db/schema";

export { ROLES, type Role };

const ALL: readonly Role[] = ROLES;
const SA: readonly Role[] = ["super_admin"];
const ADMIN_UP: readonly Role[] = ["super_admin", "admin"];
const SALES_UP: readonly Role[] = ["super_admin", "admin", "sales"];

/**
 * action → roles allowed. Comments name the PLAN §2 row.
 * "read-only" in PLAN §2 is modelled as a `*.view` action the role has
 * while the matching `*.edit` action is denied.
 */
export const PERMISSIONS = {
  // Quick + formal quotations: create, edit, issue, PDF, share link, email
  "quotes.manage": SALES_UP,
  // Issue a quotation for a blacklisted client (with a reason): Admin and up (Phase 1c brief)
  "quotes.override_blacklist": ADMIN_UP,
  // Clients: view, create, edit
  "clients.view": SALES_UP,
  "clients.edit": SALES_UP,
  // Clients: set/clear blacklist
  "clients.blacklist": ADMIN_UP,
  // Bookings: create from quotation, edit, confirm, cancel
  "bookings.manage": SALES_UP,
  "bookings.confirm": SALES_UP,
  // Payments ledger
  "payments.add": SALES_UP,
  "payments.void": ADMIN_UP,
  // Calendar + Daily Movement board: view
  "calendar.view": ALL,
  "board.view": ALL,
  // Release / Return check-in (actual time, odometer, fuel)
  "movement.check_in": ALL,
  // Vehicle blocks (owner use, maintenance)
  "vehicle_blocks.manage": SALES_UP,
  // Drivers list, driver assignment
  "drivers.manage": SALES_UP,
  // Shift roster
  "roster.view": ALL,
  "roster.edit": ADMIN_UP,
  // Rewards
  "rewards.view": SALES_UP,
  "rewards.redeem": SALES_UP,
  "rewards.adjust": ADMIN_UP,
  // Fleet (vehicles): Super Admin edits, Admin read-only
  "fleet.view": ADMIN_UP,
  "fleet.edit": SA,
  // Rate cards, holidays, pricing settings: Admin read-only
  "rates.view": ADMIN_UP,
  "rates.edit": SA,
  // Users: list; manage (target role checked via resource)
  "users.view": ADMIN_UP,
  "users.manage": ADMIN_UP,
  // Excel import: Admin read-only (view runs)
  "import.view": ADMIN_UP,
  "import.run": SA,
  // Rework settings, system settings: Admin read-only
  "settings.view": ADMIN_UP,
  "settings.edit": SA,
  // Hard delete of any record
  "records.hard_delete": SA,
  // Audit log: view
  "audit.view": ADMIN_UP,
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof PERMISSIONS;
export const ACTIONS = Object.keys(PERMISSIONS) as Action[];

/** Which target roles each role may manage (PLAN §2 "Users: manage …"). */
export const MANAGEABLE_ROLES: Record<Role, readonly Role[]> = {
  super_admin: ROLES,
  admin: ["sales", "operations"],
  sales: [],
  operations: [],
};

/** Minimal user shape the permission check needs. */
export type Actor = { id: string; role: Role; active: boolean };

/** Optional resource context. */
export type Resource = {
  /** For `users.manage`: every role involved (target's current and new role). */
  targetRoles?: readonly Role[];
};

export function can(
  user: Actor | null | undefined,
  action: Action,
  resource?: Resource,
): boolean {
  if (!user || !user.active) return false;
  const allowed: readonly Role[] = PERMISSIONS[action];
  if (!allowed.includes(user.role)) return false;

  if (action === "users.manage" && resource?.targetRoles) {
    const manageable = MANAGEABLE_ROLES[user.role];
    return resource.targetRoles.every((r) => manageable.includes(r));
  }
  return true;
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(public readonly action: Action) {
    super(`Forbidden: ${action}`);
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor() {
    super("Not signed in");
    this.name = "UnauthorizedError";
  }
}

/**
 * Throws `UnauthorizedError` (401) without a user, `ForbiddenError` (403)
 * when the table denies the action. Narrows `user` to non-null.
 */
export function requirePermission(
  user: Actor | null | undefined,
  action: Action,
  resource?: Resource,
): asserts user is Actor {
  if (!user) throw new UnauthorizedError();
  if (!can(user, action, resource)) throw new ForbiddenError(action);
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  sales: "Sales",
  operations: "Operations",
};

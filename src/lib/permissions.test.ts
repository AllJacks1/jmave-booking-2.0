import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  can,
  ForbiddenError,
  requirePermission,
  UnauthorizedError,
  type Action,
  type Actor,
  type Role,
} from "./permissions";

/**
 * Expected matrix, written out by hand from PLAN.md §2 (not derived from the
 * implementation). Column order: super_admin, admin, sales, operations.
 */
const Y = true;
const N = false;
const EXPECTED: Record<Action, [boolean, boolean, boolean, boolean]> = {
  "quotes.manage": [Y, Y, Y, N],
  "quotes.override_blacklist": [Y, Y, N, N],
  "clients.view": [Y, Y, Y, N],
  "clients.edit": [Y, Y, Y, N],
  "clients.blacklist": [Y, Y, N, N],
  "bookings.manage": [Y, Y, Y, N],
  "bookings.confirm": [Y, Y, Y, N],
  "bookings.confirm_without_rf": [Y, Y, N, N],
  "payments.add": [Y, Y, Y, N],
  "payments.void": [Y, Y, N, N],
  "calendar.view": [Y, Y, Y, Y],
  "board.view": [Y, Y, Y, Y],
  "movement.check_in": [Y, Y, Y, Y],
  "vehicle_blocks.manage": [Y, Y, Y, N],
  "drivers.manage": [Y, Y, Y, N],
  "drivers.override_overlap": [Y, Y, N, N],
  "roster.view": [Y, Y, Y, Y],
  "roster.edit": [Y, Y, N, N],
  "rewards.view": [Y, Y, Y, N],
  "rewards.redeem": [Y, Y, Y, N],
  "rewards.adjust": [Y, Y, N, N],
  "fleet.view": [Y, Y, N, N],
  "fleet.edit": [Y, N, N, N],
  "rates.view": [Y, Y, N, N],
  "rates.edit": [Y, N, N, N],
  "users.view": [Y, Y, N, N],
  "users.manage": [Y, Y, N, N],
  "import.view": [Y, Y, N, N],
  "import.run": [Y, N, N, N],
  "settings.view": [Y, Y, N, N],
  "settings.edit": [Y, N, N, N],
  "records.hard_delete": [Y, N, N, N],
  "audit.view": [Y, Y, N, N],
};

const ROLE_ORDER: Role[] = ["super_admin", "admin", "sales", "operations"];
const actor = (role: Role, active = true): Actor => ({
  id: "00000000-0000-4000-8000-000000000001",
  role,
  active,
});

describe("permission table", () => {
  it("covers exactly the implemented actions", () => {
    expect([...ACTIONS].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  const cases = ACTIONS.flatMap((action) =>
    ROLE_ORDER.map((role, i) => ({
      action,
      role,
      expected: EXPECTED[action][i],
    })),
  );

  it.each(cases)("$role → $action = $expected", ({ action, role, expected }) => {
    expect(can(actor(role), action)).toBe(expected);
  });

  it.each(ACTIONS)("inactive users are denied %s", (action) => {
    for (const role of ROLE_ORDER) {
      expect(can(actor(role, false), action)).toBe(false);
    }
  });

  it("denies a missing user", () => {
    expect(can(null, "calendar.view")).toBe(false);
    expect(can(undefined, "calendar.view")).toBe(false);
  });
});

describe("users.manage target roles", () => {
  const targets: [Role, Role[], boolean][] = [
    ["super_admin", ["super_admin"], true],
    ["super_admin", ["admin"], true],
    ["super_admin", ["sales", "operations"], true],
    ["admin", ["sales"], true],
    ["admin", ["operations"], true],
    ["admin", ["sales", "operations"], true],
    ["admin", ["admin"], false],
    ["admin", ["super_admin"], false],
    ["admin", ["sales", "admin"], false],
    ["sales", ["sales"], false],
    ["operations", ["operations"], false],
  ];
  it.each(targets)("%s managing %j = %s", (role, targetRoles, expected) => {
    expect(can(actor(role), "users.manage", { targetRoles })).toBe(expected);
  });
});

describe("requirePermission", () => {
  it("throws 401 without a user", () => {
    expect(() => requirePermission(null, "calendar.view")).toThrow(
      UnauthorizedError,
    );
  });
  it("throws 403 when denied", () => {
    try {
      requirePermission(actor("operations"), "quotes.manage");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).status).toBe(403);
    }
  });
  it("passes when allowed", () => {
    expect(() =>
      requirePermission(actor("sales"), "quotes.manage"),
    ).not.toThrow();
  });
});

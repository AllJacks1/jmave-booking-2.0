import { describe, expect, it } from "vitest";
import { navForUser } from "./nav";
import type { Role } from "./permissions";

const menu = (role: Role) =>
  navForUser({ id: "x", role, active: true }).map((i) => i.href);

describe("menu by role", () => {
  it("operations sees Board, Calendar, Roster only", () => {
    expect(menu("operations")).toEqual(["/board", "/calendar", "/roster"]);
  });

  it("sales sees no admin items", () => {
    const m = menu("sales");
    for (const href of ["/users", "/settings", "/fleet", "/rates", "/import", "/audit"]) {
      expect(m).not.toContain(href);
    }
    expect(m).toContain("/quotes");
  });

  it("admin and super admin see Users and Settings", () => {
    for (const role of ["admin", "super_admin"] as const) {
      expect(menu(role)).toEqual(expect.arrayContaining(["/users", "/settings"]));
    }
  });

  it("inactive users see nothing", () => {
    expect(navForUser({ id: "x", role: "super_admin", active: false })).toEqual([]);
  });
});

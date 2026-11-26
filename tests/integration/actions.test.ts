import { hasTestDb } from "./env";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { auditLog, session, user } from "@/db/schema";
import { DEFAULT_SETTINGS } from "@/lib/settings/schema";
import { ensureDefaultSettings, getSettings, updateSettings } from "@/lib/settings/service";
import {
  createUser,
  resetUserPassword,
  setUserActive,
  updateUser,
} from "@/lib/users/service";
import { makeUser, truncateAll } from "./helpers";

const newUser = (role: "super_admin" | "admin" | "sales" | "operations") => ({
  name: "New Person",
  displayName: "New",
  email: `new.${role}.${Math.random().toString(36).slice(2)}@example.test`,
  role,
});

const settingsInput = () => ({
  business: { ...DEFAULT_SETTINGS.business, mobile: "0919 073 7627", landline: "(082) 282-0843" },
  fuel_prices_centavos: { ...DEFAULT_SETTINGS.fuel_prices_centavos },
  quote_validity_hours: DEFAULT_SETTINGS.quote_validity_hours,
  turnaround_buffer_minutes: DEFAULT_SETTINGS.turnaround_buffer_minutes,
  late_return_grace_minutes: DEFAULT_SETTINGS.late_return_grace_minutes,
});

describe.skipIf(!hasTestDb)("server actions against the database", () => {
  beforeEach(truncateAll);
  afterAll(closeDb);

  describe("forbidden calls return 403 (one per role)", () => {
    it("super_admin: cannot deactivate the last active Super Admin (409) and nothing is 403 for them", async () => {
      const sa = await makeUser("super_admin");
      const other = await makeUser("super_admin");
      // Super Admin may manage any role, so the forbidden case for this role is
      // the business rule, not the table.
      await setUserActive(sa, { id: other.id, active: false });
      const r = await updateUser(sa, { id: sa.id, name: sa.name, displayName: sa.displayName, role: "admin" });
      expect(r).toMatchObject({ ok: false, status: 409 });
    });

    it("admin: creating an Admin is 403", async () => {
      const admin = await makeUser("admin");
      const r = await createUser(admin, newUser("admin"));
      expect(r).toMatchObject({ ok: false, status: 403 });
    });

    it("admin: creating a Super Admin is 403", async () => {
      const admin = await makeUser("admin");
      const r = await createUser(admin, newUser("super_admin"));
      expect(r).toMatchObject({ ok: false, status: 403 });
    });

    it("admin: saving settings is 403 (read-only)", async () => {
      const admin = await makeUser("admin");
      const r = await updateSettings(admin, settingsInput());
      expect(r).toMatchObject({ ok: false, status: 403 });
    });

    it("sales: creating any user is 403", async () => {
      const sales = await makeUser("sales");
      const r = await createUser(sales, newUser("sales"));
      expect(r).toMatchObject({ ok: false, status: 403 });
    });

    it("operations: saving settings is 403", async () => {
      const ops = await makeUser("operations");
      const r = await updateSettings(ops, settingsInput());
      expect(r).toMatchObject({ ok: false, status: 403 });
    });

    it("operations: resetting a password is 403", async () => {
      const ops = await makeUser("operations");
      const target = await makeUser("sales");
      const r = await resetUserPassword(ops, { id: target.id });
      expect(r).toMatchObject({ ok: false, status: 403 });
    });

    it("signed out: 401", async () => {
      const r = await createUser(null, newUser("sales"));
      expect(r).toMatchObject({ ok: false, status: 401 });
    });

    it("inactive actor: 403", async () => {
      const sa = await makeUser("super_admin", { active: false });
      const r = await createUser(sa, newUser("sales"));
      expect(r).toMatchObject({ ok: false, status: 403 });
    });
  });

  describe("users", () => {
    it("admin creates Sales with a temporary password and must_change_password", async () => {
      const admin = await makeUser("admin");
      const r = await createUser(admin, newUser("sales"));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.temporaryPassword).toHaveLength(14);
      expect(r.data.user.mustChangePassword).toBe(true);
      const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, r.data.user.id));
      expect(audit).toHaveLength(1);
      expect(audit[0].action).toBe("user.create");
      expect(JSON.stringify(audit[0].after)).not.toContain(r.data.temporaryPassword);
    });

    it("admin cannot edit an Admin, nor promote Sales to Admin", async () => {
      const admin = await makeUser("admin");
      const otherAdmin = await makeUser("admin");
      const sales = await makeUser("sales");
      expect(
        await updateUser(admin, { id: otherAdmin.id, name: "X", displayName: "X", role: "admin" }),
      ).toMatchObject({ status: 403 });
      expect(
        await updateUser(admin, { id: sales.id, name: "X", displayName: "X", role: "admin" }),
      ).toMatchObject({ status: 403 });
      expect(
        await updateUser(admin, { id: sales.id, name: "X", displayName: "X", role: "operations" }),
      ).toMatchObject({ ok: true });
    });

    it("duplicate email is 409", async () => {
      const sa = await makeUser("super_admin");
      const input = newUser("sales");
      expect((await createUser(sa, input)).ok).toBe(true);
      expect(await createUser(sa, { ...input, email: input.email.toUpperCase() })).toMatchObject({
        status: 409,
      });
    });

    it("the last active Super Admin cannot be demoted or deactivated", async () => {
      const sa = await makeUser("super_admin");
      const sa2 = await makeUser("super_admin");

      expect(
        await updateUser(sa2, { id: sa.id, name: sa.name, displayName: sa.displayName, role: "admin" }),
      ).toMatchObject({ ok: true });
      // sa2 is now the only active Super Admin.
      expect(
        await updateUser(sa2, { id: sa2.id, name: sa2.name, displayName: sa2.displayName, role: "admin" }),
      ).toMatchObject({ ok: false, status: 409 });

      // Promote sa back, then deactivate sa2 via sa; then sa is last.
      await updateUser(sa2, { id: sa.id, name: sa.name, displayName: sa.displayName, role: "super_admin" });
      expect(await setUserActive(sa, { id: sa2.id, active: false })).toMatchObject({ ok: true });
      const lone = await db.query.user.findFirst({ where: eq(user.id, sa.id) });
      expect(lone?.role).toBe("super_admin");
      // Nobody else can deactivate the last one either (sa cannot deactivate self).
      expect(await setUserActive(sa, { id: sa.id, active: false })).toMatchObject({ status: 409 });
    });

    it("deactivating revokes sessions; reset password forces a change", async () => {
      const sa = await makeUser("super_admin");
      const sales = await makeUser("sales");
      await db.insert(session).values({
        token: "t-1",
        userId: sales.id,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      expect(await setUserActive(sa, { id: sales.id, active: false })).toMatchObject({ ok: true });
      expect(await db.select().from(session).where(eq(session.userId, sales.id))).toHaveLength(0);

      const r = await resetUserPassword(sa, { id: sales.id });
      expect(r.ok && r.data.user.mustChangePassword).toBe(true);
      const audits = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityId, sales.id), eq(auditLog.action, "user.reset_password")));
      expect(audits).toHaveLength(1);
    });
  });

  describe("settings", () => {
    it("save writes audit_log rows with before/after per changed key", async () => {
      const sa = await makeUser("super_admin");
      await ensureDefaultSettings(db, sa.id);
      const input = settingsInput();
      input.fuel_prices_centavos.diesel = 10150;
      input.quote_validity_hours = 48;

      const r = await updateSettings(sa, input);
      expect(r).toMatchObject({ ok: true });
      if (!r.ok) return;
      expect(r.data.changed.sort()).toEqual(["fuel_prices_centavos", "quote_validity_hours"]);

      const rows = await db.select().from(auditLog).where(eq(auditLog.entity, "settings"));
      expect(rows).toHaveLength(2);
      const fuel = rows.find((x) => x.entityId === "fuel_prices_centavos")!;
      expect(fuel.actorId).toBe(sa.id);
      expect(fuel.before).toEqual(DEFAULT_SETTINGS.fuel_prices_centavos);
      expect(fuel.after).toEqual({ ...DEFAULT_SETTINGS.fuel_prices_centavos, diesel: 10150 });

      const saved = await getSettings();
      expect(saved.quote_validity_hours).toBe(48);
      expect(saved.business.mobile).toBe("+639190737627");
    });

    it("rejects invalid values with 400 and field paths", async () => {
      const sa = await makeUser("super_admin");
      const input = settingsInput();
      input.business.mobile = "12";
      const r = await updateSettings(sa, input);
      expect(r).toMatchObject({ ok: false, status: 400 });
      if (r.ok) return;
      expect(Object.keys(r.fieldErrors ?? {})).toContain("business.mobile");
    });
  });
});

import { hasTestDb } from "./env";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { auditLog, settings, user } from "@/db/schema";
import { isSetupOpen, runSetup, setupTokenMatches } from "@/lib/setup/service";
import { truncateAll } from "./helpers";

const TOKEN = "test-setup-token-0123456789abcdef";
const input = (over: Partial<Record<string, string>> = {}) => ({
  setupToken: TOKEN,
  name: "Owner Person",
  email: "owner@example.test",
  password: "a-strong-password",
  confirmPassword: "a-strong-password",
  ...over,
});

describe("setupTokenMatches", () => {
  it("compares tokens", () => {
    expect(setupTokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(setupTokenMatches("wrong", TOKEN)).toBe(false);
    expect(setupTokenMatches(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(setupTokenMatches(TOKEN, undefined)).toBe(false);
    expect(setupTokenMatches("", "")).toBe(false);
  });
});

describe.skipIf(!hasTestDb)("first-run setup", () => {
  beforeEach(truncateAll);
  afterAll(closeDb);

  it("rejects a wrong token", async () => {
    expect(await runSetup(input({ setupToken: "nope" }), TOKEN)).toMatchObject({ status: 403 });
    expect(await isSetupOpen()).toBe(true);
  });

  it("refuses when SETUP_TOKEN is not configured", async () => {
    expect(await runSetup(input(), undefined)).toMatchObject({ status: 403 });
  });

  it("creates the Super Admin, default settings and an audit row; then closes", async () => {
    const r = await runSetup(input(), TOKEN);
    expect(r).toMatchObject({ ok: true });
    const users = await db.select().from(user);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ role: "super_admin", active: true, mustChangePassword: false });
    expect((await db.select().from(settings)).length).toBeGreaterThanOrEqual(4);
    expect(await db.select().from(auditLog)).toHaveLength(1);

    expect(await isSetupOpen()).toBe(false);
    expect(await runSetup(input({ email: "second@example.test" }), TOKEN)).toMatchObject({
      status: 404,
    });
  });

  it("concurrent submissions create exactly one user", async () => {
    const results = await Promise.all([
      runSetup(input({ email: "a@example.test" }), TOKEN),
      runSetup(input({ email: "b@example.test" }), TOKEN),
      runSetup(input({ email: "c@example.test" }), TOKEN),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.select().from(user)).toHaveLength(1);
  });
});

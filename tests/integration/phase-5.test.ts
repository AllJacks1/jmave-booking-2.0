import { hasTestDb } from "./env";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { auditLog, ROLES } from "@/db/schema";
import type { ActionResult } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { auditListSchema, getAuditEntry, listAudit } from "@/lib/audit-log/service";
import { can, PERMISSIONS, type Action } from "@/lib/permissions";
import { runSetup } from "@/lib/setup/service";
import { SETUP_ATTEMPTS_PER_HOUR } from "@/lib/public/guard";
import { seedStaging } from "@/lib/seed/staging";
import { sql } from "drizzle-orm";
import { boardData } from "@/lib/board/service";
import { listBookings } from "@/lib/bookings/queries";
import { bookingListSchema } from "@/lib/bookings/schema";
import { calendarData } from "@/lib/calendar/service";
import { searchClients } from "@/lib/clients/service";
import { quoteListSchema } from "@/lib/quotes/schema";
import { listQuotations } from "@/lib/quotes/service";
import { manilaToUtc } from "@/lib/time";
import { bookings, clients, user } from "@/db/schema";
import { makeUser, truncateAll } from "./helpers";

type Runner = ((actor: unknown, input: unknown) => Promise<ActionResult<unknown>>) & { permission: Action };

const LIB = path.resolve(import.meta.dirname, "..", "..", "src", "lib");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Every exported `defineAction` runner in src/lib (they carry `.permission`). */
async function allRunners(): Promise<{ name: string; run: Runner }[]> {
  const files = walk(LIB).filter((f) => readFileSync(f, "utf8").includes("defineAction("));
  const out: { name: string; run: Runner }[] = [];
  for (const f of files) {
    const mod = (await import(/* @vite-ignore */ f)) as Record<string, unknown>;
    for (const [name, v] of Object.entries(mod)) {
      if (typeof v === "function" && typeof (v as Partial<Runner>).permission === "string") {
        out.push({ name: `${path.relative(LIB, f)}#${name}`, run: v as Runner });
      }
    }
  }
  return out;
}

describe.skipIf(!hasTestDb)("Phase 5: hardening", () => {
  beforeEach(truncateAll);
  afterAll(closeDb);

  describe("every server action checks permissions (enumerated)", () => {
    let runners: { name: string; run: Runner }[] = [];
    beforeAll(async () => {
      runners = await allRunners();
    });

    it("finds every runner and each names a real permission", () => {
      expect(runners.length).toBeGreaterThanOrEqual(58);
      for (const r of runners) expect(Object.keys(PERMISSIONS)).toContain(r.run.permission);
    });

    it("signed out → 401 for every action", async () => {
      const bad: string[] = [];
      for (const r of runners) {
        const res = await r.run(null, {});
        if (res.ok || res.status !== 401) bad.push(`${r.name}: ${res.ok ? "ok" : res.status}`);
      }
      expect(bad).toEqual([]);
    });

    it("must-change-password users → 403 for every action", async () => {
      const u = { ...(await makeUser("super_admin")), mustChangePassword: true };
      const bad: string[] = [];
      for (const r of runners) {
        const res = await r.run(u, {});
        if (res.ok || res.status !== 403) bad.push(r.name);
      }
      expect(bad).toEqual([]);
    });

    it.each(ROLES)("%s: 403 exactly where the table denies, never 401/403 where it allows", async (role) => {
      const actor = await makeUser(role);
      const bad: string[] = [];
      for (const r of runners) {
        const res = await r.run(actor, {});
        const allowed = can(actor, r.run.permission);
        const status = res.ok ? 200 : res.status;
        if (!allowed && status !== 403) bad.push(`${r.name} (${r.run.permission}): expected 403, got ${status}`);
        if (allowed && (status === 401 || status === 403)) bad.push(`${r.name} (${r.run.permission}): allowed but got ${status}`);
      }
      expect(bad).toEqual([]);
    });

    it("inactive users → 403 for every action", async () => {
      const actor = await makeUser("super_admin", { active: false });
      const bad: string[] = [];
      for (const r of runners) {
        const res = await r.run(actor, {});
        if (res.ok || res.status !== 403) bad.push(r.name);
      }
      expect(bad).toEqual([]);
    });
  });

  describe("audit viewer", () => {
    it("Admin and up only", async () => {
      for (const role of ["sales", "operations"] as const) {
        const u = await makeUser(role);
        await expect(listAudit(u, auditListSchema.parse({}))).rejects.toMatchObject({ status: 403 });
      }
      const admin = await makeUser("admin");
      await expect(listAudit(admin, auditListSchema.parse({}))).resolves.toMatchObject({ total: 0 });
    });

    it("filters by actor, system, entity, record, action prefix and Manila date", async () => {
      const admin = await makeUser("admin");
      const other = await makeUser("sales");
      await withAudit(admin, "booking.confirmed", "booking", "b-1", { status: "pending_reservation" }, { status: "confirmed" });
      await withAudit(other, "payment.added", "payment", "p-1", null, { amountCentavos: 50000 });
      await withAudit(null, "inquiry.created", "inquiry", "i-1", null, { reference: "REQ-2026-0001" });
      // 2026-11-26 23:30 Manila = 15:30 UTC (yesterday in Manila; today in UTC+0 terms is irrelevant)
      await db.insert(auditLog).values({ actorId: admin.id, action: "settings.update", entity: "settings", entityId: "business", at: new Date("2026-11-26T15:30:00Z") });

      const q = (p: Record<string, string>) => listAudit(admin, auditListSchema.parse(p));
      expect((await q({})).total).toBe(4);
      expect((await q({ actor: other.id })).rows.map((r) => r.action)).toEqual(["payment.added"]);
      expect((await q({ actor: "system" })).rows.map((r) => r.action)).toEqual(["inquiry.created"]);
      expect((await q({ entity: "booking" })).total).toBe(1);
      expect((await q({ entity: "settings", entityId: "business" })).total).toBe(1);
      expect((await q({ action: "booking." })).total).toBe(1);
      expect((await q({ action: "%" })).total).toBe(0); // LIKE wildcards are escaped
      expect((await q({ from: "2026-11-26", to: "2026-11-26" })).rows.map((r) => r.action)).toEqual(["settings.update"]);
      expect((await q({ actor: "not-a-uuid" })).total).toBe(4); // bad filter falls back to "all"
    });

    it("shows one entry with its before/after and actor", async () => {
      const admin = await makeUser("admin");
      await withAudit(admin, "booking.confirmed", "booking", "b-1", { status: "pending_reservation" }, { status: "confirmed" });
      const [row] = (await listAudit(admin, auditListSchema.parse({}))).rows;
      const entry = await getAuditEntry(admin, row.id);
      expect(entry).toMatchObject({ action: "booking.confirmed", actorName: admin.displayName, before: { status: "pending_reservation" }, after: { status: "confirmed" } });
      expect(await getAuditEntry(admin, "nope")).toBeNull();
    });
  });

  describe("rate limits", () => {
    it("first-run setup: more than the hourly limit from one IP → 429", async () => {
      const input = { name: "Owner", email: "owner@example.test", password: "correct-horse-battery-1", confirmPassword: "correct-horse-battery-1", setupToken: "wrong" };
      for (let i = 0; i < SETUP_ATTEMPTS_PER_HOUR; i++) {
        expect(await runSetup(input, "right-token", "203.0.113.9")).toMatchObject({ status: 403 });
      }
      expect(await runSetup({ ...input, setupToken: "right-token" }, "right-token", "203.0.113.9")).toMatchObject({ status: 429 });
      // Another IP is not affected.
      expect(await runSetup({ ...input, setupToken: "right-token" }, "right-token", "203.0.113.10")).toMatchObject({ ok: true });
    });
  });

  describe("staging seed", () => {
    it("fills an empty database with invented data through the real services", async () => {
      const summary = await seedStaging({ password: "staging-only-password-1", now: new Date("2026-11-27T02:00:00Z") });
      expect(summary).toMatchObject({ users: 6, vehicles: 8, clients: 20, bookings: 6 });
      const people = await db.select({ email: clients.email, phone: clients.phone }).from(clients);
      for (const p of people) {
        expect(p.email).toMatch(/@example\.test$/);
        expect(p.phone).toMatch(/^\+63917000\d{4}$/);
      }
      for (const u of await db.select({ email: user.email }).from(user)) expect(u.email).toMatch(/@staging\.jmave\.test$/);
      const statuses = (await db.select({ s: bookings.status }).from(bookings)).map((r) => r.s).sort();
      expect(statuses).toEqual(["confirmed", "confirmed", "confirmed", "pending_reservation", "released", "returned"]);
      await expect(seedStaging({ password: "staging-only-password-1" })).rejects.toThrow(/already has users/);
    });
  });

  describe("performance with a few years of data (brief §7)", () => {
    it("board, calendar, lists, search and audit stay fast", { timeout: 120_000 }, async () => {
      const admin = await makeUser("admin");
      // ~3 years of invented volume: 20 cars, 3,000 clients, 6,000 quotations, 1,500 bookings, 30,000 audit rows.
      await db.execute(sql`insert into vehicles (display_name, plate, body_type, fuel_type, sort_order)
        select 'Perf car ' || g, 'PRF ' || (1000 + g), 'compact', 'gasoline', g from generate_series(1, 20) g`);
      await db.execute(sql`insert into clients (full_name, phone, email)
        select 'Perf Client ' || g, '+63917' || lpad(g::text, 7, '0'), 'perf' || g || '@example.test' from generate_series(1, 3000) g`);
      await db.execute(sql`insert into quotations (number, kind, service, status, client_name, body_type, start_at, end_at, total_centavos, created_at, inputs, imported)
        select 'QTN-PRF-' || g, 'formal', 'self_drive', 'issued', 'Perf Client ' || (g % 3000), 'compact',
               now() - (g || ' hours')::interval, now() - (g || ' hours')::interval + interval '1 day', 150000, now() - (g || ' hours')::interval, '{"imported":true}'::jsonb, true
        from generate_series(1, 6000) g`);
      await db.execute(sql`insert into bookings (number, vehicle_id, service, status, client_name, start_at, end_at)
        select 'JMV-PRF-' || g, (select id from vehicles order by sort_order offset (g % 20) limit 1), 'self_drive', 'closed', 'Perf Client ' || (g % 3000),
               ${manilaToUtc("2026-11-27", "08:00").toISOString()}::timestamptz - ((g * 17) || ' hours')::interval,
               ${manilaToUtc("2026-11-27", "08:00").toISOString()}::timestamptz - ((g * 17) || ' hours')::interval + interval '12 hours'
        from generate_series(1, 1500) g`);
      await db.execute(sql`insert into audit_log (actor_id, action, entity, entity_id, after, at)
        select ${admin.id}::uuid, (array['booking.confirmed','payment.added','quotation.issue','client.update'])[1 + g % 4], 'booking', g::text, '{}'::jsonb, now() - (g || ' minutes')::interval
        from generate_series(1, 30000) g`);
      await db.execute(sql`analyze`);

      const time = async <T,>(fn: () => Promise<T>) => {
        await fn(); // warm
        const t0 = performance.now();
        await fn();
        return Math.round(performance.now() - t0);
      };
      const t = {
        board: await time(() => boardData("2026-11-27")),
        calendarMonth: await time(() => calendarData(manilaToUtc("2026-11-01"), manilaToUtc("2026-12-01"), { body: "all", status: "all", service: "all" } as never)),
        quotesPage: await time(() => listQuotations(quoteListSchema.parse({}))),
        quotesSearch: await time(() => listQuotations(quoteListSchema.parse({ q: "PRF-59" }))),
        bookingsSearch: await time(() => listBookings(bookingListSchema.parse({ q: "Client 12", status: "all" }))),
        clientSearch: await time(() => searchClients({ q: "perf1234", page: 1, blacklisted: "all" })),
        auditPage: await time(() => listAudit(admin, auditListSchema.parse({}))),
        auditFiltered: await time(() => listAudit(admin, auditListSchema.parse({ action: "payment.", from: "2026-11-01" }))),
      };
      console.log("phase-5 perf (ms):", JSON.stringify(t));
      expect(t.board).toBeLessThan(1500);
      expect(t.calendarMonth).toBeLessThan(1500);
      for (const [k, v] of Object.entries(t)) if (k !== "board" && k !== "calendarMonth") expect(v, k).toBeLessThan(500);
    });
  });
});

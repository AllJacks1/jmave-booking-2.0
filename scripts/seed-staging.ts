/**
 * Seed a staging (or local) database with invented data (Phase 5).
 *
 *   SEED_PASSWORD=… pnpm db:seed:staging            # empty database only
 *   SEED_PASSWORD=… pnpm db:seed:staging --reset    # wipe app data first
 *
 * Refuses to run unless RAILWAY_ENVIRONMENT_NAME is "staging" or the
 * database host is local. Never runs in the production environment.
 * All staff users get SEED_PASSWORD (never printed); emails are listed.
 */
import { sql } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import { seedStaging, STAGING_USERS } from "@/lib/seed/staging";

function assertAllowed() {
  const envName = process.env.RAILWAY_ENVIRONMENT_NAME ?? "";
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set");
  if (envName === "production") throw new Error("Refusing to seed: this is the production environment.");
  const host = new URL(url).hostname;
  const local = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (envName !== "staging" && !local) {
    throw new Error(`Refusing to seed: RAILWAY_ENVIRONMENT_NAME is "${envName || "unset"}" and the database host is not local.`);
  }
}

async function reset() {
  const { rows } = { rows: await db.execute<{ t: string }>(sql`select tablename as t from pg_tables where schemaname = 'public' and tablename not in ('shift_templates')`) };
  const names = [...rows].map((r) => `"${r.t}"`).filter((t) => t !== '"__drizzle_migrations"');
  if (names.length) await db.execute(sql.raw(`truncate table ${names.join(", ")} restart identity cascade`));
}

async function main() {
  assertAllowed();
  const password = process.env.SEED_PASSWORD ?? "";
  if (process.argv.includes("--reset")) await reset();
  const summary = await seedStaging({ password });
  console.log(JSON.stringify({ msg: "staging seeded", ...summary, users: STAGING_USERS.map((u) => `${u.role}: ${u.email}`) }, null, 2));
}

main()
  .catch((err: unknown) => {
    console.error("seed failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());

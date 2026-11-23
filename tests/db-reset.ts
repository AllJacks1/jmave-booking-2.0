/**
 * Drops and re-creates the public schema of a throwaway test database, then
 * applies all migrations. Used by Vitest integration tests and Playwright.
 *
 * Refuses to touch a database whose name does not end in `_test` or `_e2e`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export function assertThrowawayDb(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/_(test|e2e)$/.test(name)) {
    throw new Error(
      `Refusing to reset database "${name}": test databases must end in _test or _e2e.`,
    );
  }
}

export async function resetDatabase(url: string) {
  assertThrowawayDb(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(
      `DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`,
    );
    await migrate(drizzle(sql), { migrationsFolder: "src/db/migrations" });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

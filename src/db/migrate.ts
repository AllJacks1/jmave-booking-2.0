/**
 * Applies pending migrations from src/db/migrations.
 * Runs as Railway's pre-deploy command (`pnpm db:migrate`) and locally.
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("db:migrate: DATABASE_URL is not set");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "src/db/migrations" });
    console.log("db:migrate: migrations applied");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  // Print the message only: the error object can carry connection details.
  console.error(
    "db:migrate failed:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});

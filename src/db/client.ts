import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
/** A db handle or an open transaction — both accept the same query API. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as {
  __jmaveSql?: postgres.Sql;
  __jmaveDb?: Db;
};

function createDb(): Db {
  // postgres() does not connect until the first query, so importing this
  // module during `next build` without DATABASE_URL is safe.
  const sql = postgres(process.env.DATABASE_URL ?? "", {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    onnotice: () => {},
  });
  globalForDb.__jmaveSql = sql;
  return drizzle(sql, { schema });
}

export const db: Db = globalForDb.__jmaveDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.__jmaveDb = db;

/** Close the pool (scripts and tests only). */
export async function closeDb() {
  await globalForDb.__jmaveSql?.end({ timeout: 5 });
}

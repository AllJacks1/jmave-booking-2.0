/**
 * Import first in every integration test file: points the app's db client at
 * TEST_DATABASE_URL before `@/db/client` is loaded.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

export const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (TEST_DB_URL) process.env.DATABASE_URL = TEST_DB_URL;
export const hasTestDb = Boolean(TEST_DB_URL);

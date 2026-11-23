import { config } from "dotenv";
import { resetDatabase } from "../db-reset";

export default async function setup() {
  config({ path: ".env.local", quiet: true });
  config({ quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn(
      "\n[integration] TEST_DATABASE_URL is not set: database tests will be skipped.\n",
    );
    return;
  }
  await resetDatabase(url);
}

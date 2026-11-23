import { config } from "dotenv";
import { resetDatabase } from "../db-reset";

export default async function globalSetup() {
  config({ path: ".env.local", quiet: true });
  config({ quiet: true });
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL is not set (see .env.example).");
  await resetDatabase(url);
}

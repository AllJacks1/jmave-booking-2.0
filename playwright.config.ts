import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
export const E2E_SETUP_TOKEN = "e2e-setup-token-not-a-secret-7f3a9c";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production build against a throwaway database (E2E_DATABASE_URL).
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "pipe",
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      SETUP_TOKEN: E2E_SETUP_TOKEN,
      BETTER_AUTH_SECRET: "e2e-only-secret-0123456789abcdef0123456789abcdef",
      APP_URL: BASE_URL,
      NODE_ENV: "production",
      // Phase 4. Cloudflare's published Turnstile test keys (always pass); not secrets.
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      PUBLIC_EMBED_ORIGINS: "http://127.0.0.1:3199",
      PUBLIC_BOOK_HOST: "book.e2e.test",
      // Phase 5: never report e2e errors to Sentry (DSNs may be in .env.local).
      SENTRY_DSN: "",
      NEXT_PUBLIC_SENTRY_DSN: "",
    },
  },
});

import { defineConfig, devices } from "@playwright/test";

/**
 * User-guide screenshots against a running environment (normally staging,
 * which holds invented data only). No web server, no database reset.
 *
 *   GUIDE_BASE_URL=https://…staging… GUIDE_PASSWORD=<staging SEED_PASSWORD> \
 *     pnpm exec playwright test -c playwright.guide.config.ts
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "user-guide.spec.ts",
  workers: 1,
  timeout: 300_000,
  reporter: [["list"]],
  use: { baseURL: process.env.GUIDE_BASE_URL, trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

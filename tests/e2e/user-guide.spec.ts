import { expect, test, type Page } from "@playwright/test";

/**
 * Screenshots for docs/user-guide.md (Phase 5). Runs only with
 * USER_GUIDE_SHOTS=1, after the other specs (same database, invented data).
 * Images are written to docs/user-guide/.
 */
test.skip(!process.env.USER_GUIDE_SHOTS && !process.env.GUIDE_PASSWORD, "set USER_GUIDE_SHOTS=1 to refresh the user-guide screenshots");
test.describe.configure({ mode: "serial", timeout: 300_000 });

const OUT = "docs/user-guide";
// Against staging (playwright.guide.config.ts): the seeded staging accounts share GUIDE_PASSWORD.
const STAGING = process.env.GUIDE_PASSWORD;
const OWNER = STAGING ? { email: "owner@staging.jmave.test", password: STAGING } : { email: "owner@example.test", password: "owner-password-123" };
const SALES = STAGING ? { email: "sales1@staging.jmave.test", password: STAGING } : { email: "sam.sales@example.test", password: "sales-password-456" };
const OPS = STAGING ? { email: "ops1@staging.jmave.test", password: STAGING } : { email: "otto.ops@example.test", password: "ops-password-321" };

async function signIn(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    const limited = page.getByText("Too many attempts");
    await Promise.race([page.waitForURL((url) => url.pathname !== "/login"), limited.waitFor()]);
    if (new URL(page.url()).pathname !== "/login") return;
    await page.waitForTimeout(61_000);
  }
}

async function shot(page: Page, name: string, path: string, opts: { full?: boolean } = {}) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: opts.full ?? false });
}

test("Super Admin and Admin screens", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, OWNER.email, OWNER.password);
  await shot(page, "admin-users", "/users");
  await shot(page, "admin-settings", "/settings");
  await shot(page, "admin-rates", "/rates");
  await shot(page, "admin-import", "/import");
  await shot(page, "admin-audit", "/audit");
  await page.getByRole("link", { name: /^View/ }).first().click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/admin-audit-entry.png` });
});

test("Sales screens", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, SALES.email, SALES.password);
  await shot(page, "sales-dashboard", "/dashboard");
  await shot(page, "sales-quick-quote", "/quotes/quick");
  await shot(page, "sales-new-quote", "/quotes/new");
  await shot(page, "sales-quotes", "/quotes");
  await page.goto("/quotes?kind=formal&status=issued");
  const q = await page.getByRole("link", { name: /^QTN-/ }).first().getAttribute("href");
  await shot(page, "sales-quote-issued", q!, { full: true });
  await page.goto("/bookings");
  const b = await page.getByRole("link", { name: /^QTN-/ }).first().getAttribute("href");
  await shot(page, "sales-booking", b!, { full: true });
  await shot(page, "sales-calendar", "/calendar");
  await shot(page, "sales-inquiries", "/inquiries");
  await shot(page, "sales-clients", "/clients");
  await shot(page, "sales-rewards", "/rewards");
});

test("Operations screens (phone)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, OPS.email, OPS.password);
  await shot(page, "ops-board", "/board", { full: true });
  await shot(page, "ops-roster", "/roster");
  await shot(page, "ops-calendar", "/calendar");
});

test("Public booking page (phone)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().clearCookies();
  await shot(page, "public-book", "/book", { full: true });
  await expect(page.getByRole("heading").first()).toBeVisible();
});

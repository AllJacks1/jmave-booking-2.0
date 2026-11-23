import { expect, test, type Page } from "@playwright/test";
import { E2E_SETUP_TOKEN } from "../../playwright.config";

/** Invented test data only. */
const OWNER = { name: "Olivia Owner", email: "owner@example.test", password: "owner-password-123" };
const SALES = { name: "Sam Sales", display: "Sam", email: "sam.sales@example.test" };
const SALES_NEW_PASSWORD = "sales-password-456";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the redirect so a following goto() does not abort the sign-in.
  await page.waitForURL((url) => url.pathname !== "/login");
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe.configure({ mode: "serial" });

test("fresh system: / goes to /login with a not-set-up notice", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("System not set up")).toBeVisible();
});

test("public sign-up endpoint is not reachable", async ({ request }) => {
  const res = await request.post("/api/auth/sign-up/email", {
    data: { email: "intruder@example.test", password: "intruder-pass-1", name: "X" },
  });
  expect(res.status()).toBe(404);
});

test("setup: wrong token fails, right token creates the Super Admin, then 404", async ({ page }) => {
  await page.goto("/setup");
  await page.getByLabel("Setup token").fill("wrong-token");
  await page.getByLabel("Your name").fill(OWNER.name);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Confirm password").fill(OWNER.password);
  await page.getByRole("button", { name: "Create Super Admin" }).click();
  await expect(page.getByText("The setup token is not correct.")).toBeVisible();

  await page.getByLabel("Setup token").fill(E2E_SETUP_TOKEN);
  await page.getByRole("button", { name: "Create Super Admin" }).click();
  await expect(page).toHaveURL(/\/login\?setup=done$/);
  await expect(page.getByText("Setup complete")).toBeVisible();

  const res = await page.goto("/setup");
  expect(res?.status()).toBe(404);
});

test("Super Admin creates a Sales user; Sales sees no Users menu", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: "Users" })).toBeVisible();

  await page.getByRole("link", { name: "Users" }).click();
  await page.getByRole("button", { name: "New user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill(SALES.name);
  await dialog.getByLabel("Display name").fill(SALES.display);
  await dialog.getByLabel("Email").fill(SALES.email);
  await dialog.getByRole("button", { name: "Create user" }).click();

  const temp = (await page.getByTestId("temporary-password").textContent())?.trim();
  expect(temp).toMatch(/^[A-Za-z0-9]{14}$/);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId(`user-row-${SALES.email}`)).toContainText("Sales");

  await signOut(page);

  // First sign-in with the temporary password forces a change.
  await signIn(page, SALES.email, temp!);
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel("Current password").fill(temp!);
  await page.getByLabel("New password", { exact: true }).fill(SALES_NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill(SALES_NEW_PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await expect(page.getByRole("link", { name: "Quotations" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);

  await page.goto("/users");
  await expect(page.getByText("No access")).toBeVisible();
});

test("Super Admin saves settings", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/settings");
  await page.getByLabel("Diesel (₱/L)").fill("101.50");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Diesel (₱/L)")).toHaveValue("101.50");
});

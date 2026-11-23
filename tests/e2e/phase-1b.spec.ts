import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { bookingWorkbook, dmsWorkbook } from "../fixtures/workbooks";

/** Runs after foundation.spec.ts (same database): the owner and Sam (Sales) exist. Invented data only. */
const OWNER = { email: "owner@example.test", password: "owner-password-123" };
const SALES = { email: "sam.sales@example.test", password: "sales-password-456" };
const ADMIN = { name: "Ada Admin", display: "Ada", email: "ada.admin@example.test", password: "admin-password-789" };

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
}

async function upload(page: Page, path: string) {
  await page.goto("/import");
  await page.getByLabel("Workbook file").setInputFiles(path);
  await page.getByRole("button", { name: "Upload and preview" }).click();
  await page.waitForURL(/\/import\/[0-9a-f-]{36}$/, { timeout: 60_000 });
}

test.describe.configure({ mode: "serial" });

test("Super Admin imports both workbooks: preview, commit, re-run changes nothing", async ({ page }, info) => {
  const booking = info.outputPath("Self-Driven and With Driver.xlsx");
  const dms = info.outputPath("2026 Daily Movement Sheet.xlsx");
  writeFileSync(booking, await bookingWorkbook());
  writeFileSync(dms, await dmsWorkbook());

  await signIn(page, OWNER.email, OWNER.password);
  await upload(page, booking);
  await expect(page.getByText("If you commit now: 14 new")).toBeVisible();
  await expect(page.getByTestId("section-rate_cards")).toContainText("Matches pricing.md");
  await page.screenshot({ path: info.outputPath("import-preview.png"), fullPage: true });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(page.getByText("Result: 14 new")).toBeVisible();

  await upload(page, dms);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(page.getByText(/^Result: 1 new, 2 changed/)).toBeVisible();

  await upload(page, booking);
  await expect(page.getByText("If you commit now: 0 new, 0 changed")).toBeVisible();
});

test("rates: active v1 tables, compare, holidays, playground", async ({ page }, info) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/rates");
  await expect(page.getByRole("heading", { name: /Active: v1/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate" })).toHaveCount(1); // v2 draft only
  await page.screenshot({ path: info.outputPath("rates.png"), fullPage: true });

  await page.goto("/rates/compare");
  await expect(page.getByText(/value\(s\) differ — v1 → v2/)).toBeVisible();

  await page.goto("/rates/holidays");
  await page.getByLabel("Date").fill("2026-12-25");
  await page.getByLabel("Name").fill("Christmas Day");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("cell", { name: "Christmas Day", exact: true })).toBeVisible();

  // SD-1: MPV primo 24h, delivery 365 + pick-up 365 → 3,610.
  await page.goto("/rates/playground");
  await page.getByLabel("Body type").first().selectOption("mpv");
  await page.getByLabel("Category").first().selectOption("primo");
  await page.getByLabel("Delivery fee (₱)").fill("365");
  await page.getByLabel("Pick-up fee (₱)").fill("365");
  await expect(page.getByRole("row", { name: /Rental total ₱3,610\.00/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath("playground.png"), fullPage: true });
});

test("clients: blacklisted clients show a badge in search", async ({ page }, info) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/clients?q=0917 000 0001");
  const row = page.getByTestId("client-row").filter({ hasText: "Ana Testcase" });
  await expect(row.getByTestId("blacklist-badge")).toBeVisible();
  await page.goto("/clients?q=Dan");
  await expect(page.getByTestId("client-row").filter({ hasText: "Dan Example" }).getByTestId("blacklist-badge")).toHaveCount(0);
  await page.getByRole("link", { name: "Dan Example" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Dan Example" })).toBeVisible();
  await expect(page.getByText("None yet (new client)")).toBeVisible();
  await page.screenshot({ path: info.outputPath("client.png"), fullPage: true });
});

test("Admin sees fleet, rates and import runs read-only", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/users");
  await page.getByRole("button", { name: "New user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill(ADMIN.name);
  await dialog.getByLabel("Display name").fill(ADMIN.display);
  await dialog.getByLabel("Email").fill(ADMIN.email);
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: "Admin", exact: true }).click();
  await dialog.getByRole("button", { name: "Create user" }).click();
  const temp = (await page.getByTestId("temporary-password").textContent())!.trim();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page, ADMIN.email, temp);
  await page.getByLabel("Current password").fill(temp);
  await page.getByLabel("New password", { exact: true }).fill(ADMIN.password);
  await page.getByLabel("Confirm new password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Change password" }).click();
  await page.waitForURL(/\/dashboard$/);

  await page.goto("/fleet");
  await expect(page.getByText("Read-only. Only a Super Admin can edit the fleet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add vehicle" })).toHaveCount(0);
  await page.goto("/rates");
  await expect(page.getByText("Read-only. Only a Super Admin can change rates.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate" })).toHaveCount(0);
  await page.goto("/import");
  await expect(page.getByText("Read-only. Only a Super Admin can import.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload and preview" })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: /Self-Driven and With Driver/ }).first()).toBeVisible();
  const res = await page.request.post("/api/import", { multipart: { file: { name: "x.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("PK") } } });
  expect(res.status()).toBe(403);
});

test("Sales cannot open fleet, rates or import", async ({ page }) => {
  await signIn(page, SALES.email, SALES.password);
  await expect(page.getByRole("link", { name: "Clients" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Fleet" })).toHaveCount(0);
  for (const path of ["/fleet", "/rates", "/rates/playground", "/import"]) {
    await page.goto(path);
    await expect(page.getByText("No access"), path).toBeVisible();
  }
});

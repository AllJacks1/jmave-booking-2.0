import { expect, test, type Page } from "@playwright/test";

/**
 * Runs after phase-1b/1c specs (same database): the fixture workbook is
 * imported (vehicle "Testcar Red AT TST 1001"), Sales and Operations users
 * exist. Invented data only.
 */
const SALES = { email: "sam.sales@example.test", password: "sales-password-456" };
const OPS = { email: "otto.ops@example.test", password: "ops-password-321" };
const CAR = "Testcar Red AT TST 1001 · TST 1001";
const DAY = "2026-12-14"; // a Monday: the week view starts here

test.describe.configure({ mode: "serial", timeout: 180_000 });

type Cookies = Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>;
const sessions = new Map<string, Cookies>();

async function signIn(page: Page, email: string, password: string) {
  const saved = sessions.get(email);
  if (saved) {
    await page.context().addCookies(saved);
    await page.goto("/");
    return;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    const limited = page.getByText("Too many attempts");
    await Promise.race([page.waitForURL((url) => url.pathname !== "/login"), limited.waitFor()]);
    if (new URL(page.url()).pathname !== "/login") break;
    await page.waitForTimeout(61_000);
  }
  await expect(page).not.toHaveURL(/\/login$/);
  sessions.set(email, await page.context().cookies());
}

async function choose(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** Formal quotation for the Testcar on DAY 09:00 → next day 09:00, issued. Returns its number. */
async function issueQuote(page: Page, client: { name: string; phone: string }, expectNote: RegExp) {
  await page.goto("/quotes/new");
  await choose(page, "Vehicle", CAR);
  await page.getByLabel("Release date").fill(DAY);
  await page.getByLabel("Release time").fill("09:00");
  await page.getByLabel("Return date").fill("2026-12-15");
  await page.getByLabel("Return time").fill("09:00");
  await page.getByRole("button", { name: "New client" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill(client.name);
  await dialog.getByLabel("Phone").fill(client.phone);
  await dialog.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("combobox", { name: "Client", exact: true })).toContainText(client.name);
  await expect(page.getByTestId("availability-note")).toHaveText(expectNote, { timeout: 15_000 });
  await expect(page.getByText(/^Draft saved/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Issue quotation" }).click();
  const heading = page.getByRole("heading", { name: /^QTN-2026-\d+$/ });
  await expect(heading).toBeVisible();
  return (await heading.textContent())!.trim();
}

async function convertAndPayRf(page: Page) {
  await page.getByRole("button", { name: "Convert to booking" }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("booking-status")).toHaveText("Pending reservation");
  await page.getByRole("button", { name: "Add payment" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount (₱)").fill("500");
  await dialog.getByLabel("Reference no.").fill("GC-0001");
  await dialog.getByRole("button", { name: "Add payment" }).click();
  await expect(page.getByTestId("payment-row")).toHaveCount(1);
}

let firstNumber = "";
let firstBookingUrl = "";

test("issue → convert → RF payment → confirm → calendar shows the bar", async ({ page }, info) => {
  await signIn(page, SALES.email, SALES.password);
  firstNumber = await issueQuote(page, { name: "Rita Renter", phone: "0917 555 0201" }, /^Available/);
  await convertAndPayRf(page);
  firstBookingUrl = page.url();
  await expect(page.getByRole("heading", { name: firstNumber })).toBeVisible();

  await page.getByRole("button", { name: "Confirm booking" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByTestId("booking-status")).toHaveText("Confirmed");
  await expect(page.getByText(/^Holding: /)).toBeVisible();
  await page.screenshot({ path: info.outputPath("booking-confirmed.png"), fullPage: true });

  await page.goto(`/calendar?view=week&date=${DAY}`);
  const bar = page.locator(`[data-testid="calendar-bar"][data-number="${firstNumber}"]`);
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("data-status", "confirmed");
  await expect(bar).toContainText("Rita Renter");
  await page.screenshot({ path: info.outputPath("calendar-week.png"), fullPage: true });
  await bar.click();
  const drawer = page.getByTestId("calendar-drawer");
  await expect(drawer.getByRole("link", { name: "Open booking" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("calendar-drawer.png") });
});

test("second booking for the same car and time: confirm is refused with the conflicting number", async ({ page }, info) => {
  await signIn(page, SALES.email, SALES.password);
  const second = await issueQuote(page, { name: "Bert Second", phone: "0917 555 0202" }, new RegExp(`^Booked by ${firstNumber}`));
  await convertAndPayRf(page);
  await expect(page.getByTestId("availability")).toContainText(`Booked by ${firstNumber}`);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText(`This vehicle is already booked for that time by ${firstNumber}.`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("booking-status")).toHaveText("Pending reservation");

  // The pending one shows striped on the calendar next to the confirmed bar.
  await page.goto(`/calendar?view=month&date=${DAY}`);
  await expect(page.locator(`[data-testid="calendar-bar"][data-number="${second}"]`)).toHaveAttribute("data-status", "pending_reservation");
  await page.screenshot({ path: info.outputPath("calendar-month.png"), fullPage: true });
});

test("Operations sees the calendar read-only and gets 403 on bookings", async ({ page }) => {
  await signIn(page, OPS.email, OPS.password);
  const cal = await page.goto(`/calendar?view=week&date=${DAY}`);
  expect(cal?.status()).toBe(200);
  const bar = page.locator(`[data-testid="calendar-bar"][data-number="${firstNumber}"]`);
  await expect(bar).toBeVisible();
  await expect(page.getByRole("button", { name: "Block a vehicle" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^New quotation for/ })).toHaveCount(0);
  await bar.click();
  await expect(page.getByTestId("calendar-drawer")).toBeVisible();
  await expect(page.getByTestId("calendar-drawer").getByRole("link", { name: "Open booking" })).toHaveCount(0);

  for (const path of [firstBookingUrl.replace(/^https?:\/\/[^/]+/, ""), "/bookings", "/drivers"]) {
    const r = await page.goto(path);
    expect(r?.status(), path).toBe(403);
  }
});

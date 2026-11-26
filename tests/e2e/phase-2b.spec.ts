import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 2b brief step 10. Runs after phase-1b…2a specs (same database): the
 * fixture workbook is imported ("Testcar Red AT TST 1001": Sedan, 42 L,
 * unleaded; default gasoline price ₱94), Sales and Operations users exist.
 * Invented data only.
 *
 * Check-ins cannot be dated in the future, so the rental runs three days ago
 * 09:00 → two days ago 09:00 (Manila).
 */
const SALES = { email: "sam.sales@example.test", password: "sales-password-456" };
const OPS = { email: "otto.ops@example.test", password: "ops-password-321" };
const CAR = "Testcar Red AT TST 1001 · TST 1001";
const CAR_NAME = "Testcar Red AT";

test.describe.configure({ mode: "serial", timeout: 240_000 });

function manilaDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const START = manilaDate(-3);
const END = manilaDate(-2);

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

let number = "";
let bookingUrl = "";

test("Sales: confirmed 1-day Self-Drive Sedan booking", async ({ page }) => {
  await signIn(page, SALES.email, SALES.password);
  await page.goto("/quotes/new");
  await choose(page, "Vehicle", CAR);
  await page.getByLabel("Release date").fill(START);
  await page.getByLabel("Release time").fill("09:00");
  await page.getByLabel("Return date").fill(END);
  await page.getByLabel("Return time").fill("09:00");
  await page.getByRole("button", { name: "New client" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Carla Checkin");
  await dialog.getByLabel("Phone").fill("0917 555 0301");
  await dialog.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByTestId("availability-note")).toHaveText(/^Available/, { timeout: 15_000 });
  await expect(page.getByText(/^Draft saved/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Issue quotation" }).click();
  const heading = page.getByRole("heading", { name: /^QTN-2026-\d+$/ });
  await expect(heading).toBeVisible();
  number = (await heading.textContent())!.trim();

  await page.getByRole("button", { name: "Convert to booking" }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
  bookingUrl = page.url();
  await page.getByRole("button", { name: "Add payment" }).click();
  const pay = page.getByRole("dialog");
  await pay.getByLabel("Amount (₱)").fill("500");
  await pay.getByRole("button", { name: "Add payment" }).click();
  await expect(page.getByTestId("payment-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByTestId("booking-status")).toHaveText("Confirmed");
});

test("Operations on a phone: release from the board, return next day, charges shown before saving", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, OPS.email, OPS.password);
  await expect(page).toHaveURL(/\/board/);

  // Release day: stacked cards under 768 px.
  await page.goto(`/board?date=${START}`);
  const card = page.locator(`[data-testid="board-card"][data-vehicle^="${CAR_NAME}"]`);
  await expect(card).toHaveAttribute("data-status", "out_today");
  await expect(card.getByRole("link", { name: "Open" })).toHaveCount(0); // Ops cannot open bookings
  await page.screenshot({ path: info.outputPath("board-mobile-release-day.png"), fullPage: true });
  await card.getByRole("link", { name: `Release ${number}` }).click();
  await expect(page).toHaveURL(/\/board\/release\//);
  await page.getByLabel("Released on").fill(START);
  await page.getByLabel("Time").fill("09:00");
  await page.getByLabel("Odometer (km)").fill("10000");
  await page.getByRole("radio", { name: "Fuel Full (8/8)" }).click();
  await page.screenshot({ path: info.outputPath("release-form.png"), fullPage: true });
  await page.getByRole("button", { name: "Save release" }).click();
  await expect(page).toHaveURL(new RegExp(`/board\\?date=${START}`));
  await expect(card.getByTestId("event-chip").first()).toHaveAttribute("data-done", "true");

  // Return day, 2 h after end_at.
  await page.goto(`/board?date=${END}`);
  await expect(card).toHaveAttribute("data-status", "return");
  await card.getByRole("link", { name: `Return ${number}` }).click();
  await page.getByLabel("Returned on").fill(END);
  await page.getByLabel("Time").fill("11:00");
  await page.getByLabel("Odometer (km)").fill("10450");
  await page.getByRole("radio", { name: "Fuel 6/8" }).click();
  await page.getByRole("button", { name: "Check charges" }).click();
  const preview = page.getByTestId("return-preview");
  await expect(preview.locator('[data-kind="excess_km"]')).toContainText("₱1,200.00");
  await expect(preview.locator('[data-kind="fuel_shortage"]')).toContainText("₱987.00");
  await expect(preview.locator('[data-kind="extension"]')).toContainText("₱600.00");
  await page.screenshot({ path: info.outputPath("return-preview.png"), fullPage: true });
  await page.getByRole("button", { name: "Save return" }).click();
  await expect(page).toHaveURL(new RegExp(`/board\\?date=${END}`));
  await expect(card.getByTestId("event-chip").first()).toHaveAttribute("data-done", "true");

  // Ops still cannot open the booking.
  const r = await page.goto(bookingUrl.replace(/^https?:\/\/[^/]+/, ""));
  expect(r?.status()).toBe(403);
});

test("Sales: check-in charges on the booking and the balance updates", async ({ page }, info) => {
  await signIn(page, SALES.email, SALES.password);
  await page.goto(bookingUrl);
  await expect(page.getByTestId("booking-status")).toHaveText("Returned");
  const checkIn = page.locator('[data-testid="charge-row"][data-source="check_in"]');
  await expect(checkIn).toHaveCount(3);
  await expect(page.locator('[data-testid="charge-row"][data-kind="excess_km"]')).toContainText("₱1,200.00");
  await expect(page.locator('[data-testid="charge-row"][data-kind="fuel_shortage"]')).toContainText("₱987.00");
  await expect(page.locator('[data-testid="charge-row"][data-kind="extension"]')).toContainText("₱600.00");
  // Sales cannot remove check-in charges (Admin+ only).
  await expect(checkIn.first().getByRole("button", { name: "Remove charge" })).toHaveCount(0);

  // Balance = quoted charges − ₱500 RF + ₱2,787 check-in.
  const total = await page.getByTestId("charges-total").textContent();
  const charges = Number(total!.replace(/[^\d.]/g, ""));
  await expect(page.getByTestId("balance")).toHaveText(`₱${(charges - 500).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  await expect(page.getByTestId("movements")).toContainText("10,450 km");
  await page.screenshot({ path: info.outputPath("booking-returned.png"), fullPage: true });

  // Board PDF downloads for any staff.
  const pdf = await page.request.get(`/api/board/pdf?date=${END}`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});

import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 3: earn on return, redeem free hours on a formal quotation (deducted
 * on confirm, refunded on cancel), Admin adjustment, Send by email (queued
 * through the outbox). Runs after the earlier specs (same database):
 * "Testcar Red AT TST 1001" (Sedan) exists; Sales, Admin and Operations users
 * exist. Invented data only.
 */
const SALES = { email: "sam.sales@example.test", password: "sales-password-456" };
const ADMIN = { email: "ada.admin@example.test", password: "admin-password-789" };
const OPS = { email: "otto.ops@example.test", password: "ops-password-321" };
const CAR = "Testcar Red AT TST 1001 · TST 1001";
const CLIENT = "Rhea Rewards";

test.describe.configure({ mode: "serial", timeout: 300_000 });

function manilaDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
// 3-day rental in the past (check-ins cannot be in the future); the redemption trip in the future.
const PAST_START = manilaDate(-12);
const PAST_END = manilaDate(-9);
const NEXT_START = manilaDate(20);
const NEXT_END = manilaDate(21);

type Cookies = Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>;
const sessions = new Map<string, Cookies>();

async function signIn(page: Page, email: string, password: string) {
  const saved = sessions.get(email);
  if (saved) {
    await page.context().clearCookies();
    await page.context().addCookies(saved);
    await page.goto("/");
    return;
  }
  await page.context().clearCookies();
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

async function schedule(page: Page, start: string, end: string) {
  await choose(page, "Vehicle", CAR);
  await page.getByLabel("Release date").fill(start);
  await page.getByLabel("Release time").fill("09:00");
  await page.getByLabel("Return date").fill(end);
  await page.getByLabel("Return time").fill("09:00");
}

/** Issue → convert → ₱500 RF → confirm. Returns the booking URL. */
async function issueAndConfirm(page: Page): Promise<{ quoteUrl: string; bookingUrl: string; number: string }> {
  await expect(page.getByTestId("availability-note")).toHaveText(/^Available/, { timeout: 15_000 });
  await expect(page.getByText(/^Draft saved/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Issue quotation" }).click();
  const heading = page.getByRole("heading", { name: /^QTN-2026-\d+$/ });
  await expect(heading).toBeVisible();
  const number = (await heading.textContent())!.trim();
  const quoteUrl = page.url();
  await page.getByRole("button", { name: "Convert to booking" }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
  const bookingUrl = page.url();
  await page.getByRole("button", { name: "Add payment" }).click();
  const pay = page.getByRole("dialog");
  await pay.getByLabel("Amount (₱)").fill("500");
  await pay.getByRole("button", { name: "Add payment" }).click();
  await expect(page.getByTestId("payment-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByTestId("booking-status")).toHaveText("Confirmed");
  return { quoteUrl, bookingUrl, number };
}

let pastBookingId = "";
let clientUrl = "";
let quoteUrl = "";

test("Sales: 3-day booking for a new client", async ({ page }) => {
  await signIn(page, SALES.email, SALES.password);
  await page.goto("/quotes/new");
  await schedule(page, PAST_START, PAST_END);
  await page.getByRole("button", { name: "New client" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill(CLIENT);
  await dialog.getByLabel("Phone").fill("0917 555 0303");
  await dialog.getByLabel("Email").fill("rhea.rewards@example.test");
  await dialog.getByRole("button", { name: "Add client" }).click();
  // No card yet: nothing to redeem.
  await expect(page.getByTestId("rewards-card")).toContainText("no loyalty card yet");
  const b = await issueAndConfirm(page);
  pastBookingId = b.bookingUrl.split("/").pop()!;
});

test("Operations: release and return 3 days later → 150 points (₱3.00) on a new card", async ({ page }) => {
  await signIn(page, OPS.email, OPS.password);
  await page.goto(`/board/release/${pastBookingId}`);
  await page.getByLabel("Released on").fill(PAST_START);
  await page.getByLabel("Time").fill("09:00");
  await page.getByLabel("Odometer (km)").fill("20000");
  await page.getByRole("radio", { name: "Fuel Full (8/8)" }).click();
  await page.getByRole("button", { name: "Save release" }).click();
  await expect(page).toHaveURL(/\/board\?date=/);

  await page.goto(`/board/return/${pastBookingId}`);
  await page.getByLabel("Returned on").fill(PAST_END);
  await page.getByLabel("Time").fill("09:00");
  await page.getByLabel("Odometer (km)").fill("20300");
  await page.getByRole("radio", { name: "Fuel Full (8/8)" }).click();
  await page.getByRole("button", { name: "Check charges" }).click();
  await page.getByRole("button", { name: "Save return" }).click();
  await expect(page.getByText(/^150 loyalty points added to JMV-\d{4}$/)).toBeVisible();

  // Operations cannot open Rewards.
  await page.goto("/rewards");
  await expect(page.getByText("No access")).toBeVisible();
});

test("Sales: the client page shows the card; Admin adds 15,000 points with a reason", async ({ page }, info) => {
  await signIn(page, SALES.email, SALES.password);
  await page.goto(`/clients?q=${encodeURIComponent(CLIENT)}`);
  await page.getByRole("link", { name: CLIENT }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
  clientUrl = page.url();
  const card = page.getByTestId("client-rewards");
  await expect(card.getByTestId("loyalty-points")).toHaveText("150");
  await expect(card.getByTestId("loyalty-value")).toHaveText("₱3.00");
  // Sales cannot adjust.
  await card.getByRole("link", { name: /^JMV-\d{4}$/ }).click();
  await expect(page).toHaveURL(/\/rewards\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("points-history")).toBeVisible();
  await expect(page.getByRole("button", { name: "Adjust points" })).toHaveCount(0);
  const cardUrl = page.url();

  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(cardUrl);
  await page.getByRole("button", { name: "Adjust points" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Points (+ or −)").fill("15000");
  await d.getByLabel("Reason").fill("Launch promo");
  await d.getByRole("button", { name: "Save adjustment" }).click();
  await expect(page.getByTestId("loyalty-points")).toHaveText("15,150");
  await expect(page.getByTestId("points-entry").first()).toContainText("Launch promo");
  await page.screenshot({ path: info.outputPath("rewards-card.png"), fullPage: true });
});

test("Sales: redeem 1 free Sedan hour → ₱0 line; deducted on confirm, refunded on cancel", async ({ page }, info) => {
  await signIn(page, SALES.email, SALES.password);
  await page.goto("/quotes/new");
  await schedule(page, NEXT_START, NEXT_END);
  await page.getByRole("combobox", { name: "Client", exact: true }).click();
  await page.getByRole("combobox", { name: "Search clients" }).fill("Rhea");
  await page.getByRole("option", { name: new RegExp(CLIENT) }).click();
  const rewards = page.getByTestId("rewards-card");
  await expect(rewards.getByTestId("rewards-balance")).toHaveText("15,150");
  await choose(page, "Redeem", "Free hours");
  await rewards.getByLabel("Free hours").fill("1");
  const panel = page.getByTestId("price-panel");
  const line = panel.getByRole("row").filter({ hasText: "Free hours (rewards)" });
  await expect(line).toContainText("₱0.00", { timeout: 15_000 });
  await expect(rewards).toContainText("Uses 15,000 points");
  await page.screenshot({ path: info.outputPath("redeem-free-hours.png"), fullPage: true });

  const b = await issueAndConfirm(page);
  quoteUrl = b.quoteUrl;
  await expect(page.getByTestId("booking-points")).toContainText("Redeemed: -15,000 points");
  await page.goto(clientUrl);
  await expect(page.getByTestId("client-rewards").getByTestId("loyalty-points")).toHaveText("150");

  await page.goto(b.bookingUrl);
  await page.getByRole("button", { name: "Cancel booking" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Reason").fill("Client postponed");
  await dlg.getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByTestId("booking-status")).toHaveText("Cancelled");
  await expect(page.getByTestId("booking-points")).toContainText("Refund (cancelled): +15,000 points");
  await page.goto(clientUrl);
  await expect(page.getByTestId("client-rewards").getByTestId("loyalty-points")).toHaveText("15,150");
});

test("Sales: Send by email queues the quotation with its delivery status", async ({ page }, info) => {
  await signIn(page, SALES.email, SALES.password);
  await page.goto(quoteUrl);
  await page.getByRole("button", { name: "Send by email" }).click();
  const d = page.getByRole("dialog");
  await expect(d.getByLabel("Recipient")).toHaveValue("rhea.rewards@example.test");
  await d.getByLabel("Message (optional)").fill("Here is your quotation.");
  await d.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Email queued.", { exact: false })).toBeVisible();
  const row = page.getByTestId("delivery-row").first();
  await expect(row).toContainText("rhea.rewards@example.test");
  // The web app only queues; the worker (not running in this test) sends.
  await expect(row).toContainText("Sending");
  await page.screenshot({ path: info.outputPath("email-queued.png"), fullPage: true });
});

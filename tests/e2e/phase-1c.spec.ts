import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Runs after phase-1b.spec.ts (same database): fixture workbooks imported,
 * so QTN-2026 = 109 and "Ana Testcase" is blacklisted. Invented data only.
 */
const OWNER = { email: "owner@example.test", password: "owner-password-123" };
const SALES = { email: "sam.sales@example.test", password: "sales-password-456" };
const OPS = { name: "Otto Ops", display: "Otto", email: "otto.ops@example.test", password: "ops-password-321" };

// Room to wait out the sign-in rate limit once.
test.describe.configure({ mode: "serial", timeout: 180_000 });
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

type Cookies = Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>;
const sessions = new Map<string, Cookies>();

/**
 * Sign in once per user and reuse the session cookie: the whole suite shares
 * one IP and sign-in is limited to 10/min. Waits out the limit if hit.
 */
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
  // Forced password change happens on this session; keep it only once done.
  if (!page.url().endsWith("/change-password")) sessions.set(email, await page.context().cookies());
}

async function choose(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** Golden SD-2: Compact 24h, 1 day, new client, delivery 490. */
async function enterSd2(page: Page) {
  await choose(page, "Body type", "Compact");
  await page.getByLabel("Release date").fill("2026-11-22");
  await page.getByLabel("Release time").fill("11:30");
  await page.getByLabel("Return date").fill("2026-11-23");
  await page.getByLabel("Return time").fill("11:30");
  await page.getByLabel("Delivery fee (₱)").fill("490");
}

// Windows turns LF into CRLF on the clipboard.
const clipboard = async (page: Page) =>
  (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");

const SD2_LINES = [
  "Self-Drive · Compact · Nov 22, 11:30 AM – Nov 23, 11:30 AM",
  "1,580.00  Rental rate (1 day)",
  "  200.00  Carwash",
  "  490.00  Delivery fee",
  "  -79.00  New client discount",
  "--------",
  "2,191.00  Rental total",
  "2,000.00  Refundable deposit",
];

test("quick quote: SD-2 prices exactly; copy text; PDF downloads", async ({ page }, info) => {
  await signIn(page, SALES.email, SALES.password);
  await page.goto("/quotes/quick");
  await enterSd2(page);
  const panel = page.getByTestId("price-panel");
  await expect(panel.getByRole("row", { name: /Rental total ₱2,191\.00/ })).toBeVisible();
  await expect(panel.getByRole("row", { name: /New client discount.*-₱79\.00/ })).toBeVisible();
  await expect(panel.getByRole("row", { name: /Balance on release ₱3,201\.00/ })).toBeVisible();
  await expect(panel.getByRole("row", { name: /Total contract value ₱4,191\.00/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath("quick-quote.png"), fullPage: true });

  await page.getByRole("button", { name: "Copy text" }).click();
  const text = await clipboard(page);
  expect(text.split("\n").slice(0, 10)).toEqual(["J-MaVe Cars — ESTIMATE", ...SD2_LINES, "Estimate only. Rates are confirmed once a formal quotation is issued."]);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^Estimate_\d{4}-\d{2}-\d{2}_\d{4}\.pdf$/);
  expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);
});

let shareUrl = "";
let quoteUrl = "";

test("formal quote with a new client: issue → number → share link → PDF", async ({ page, browser }, info) => {
  await signIn(page, SALES.email, SALES.password);
  await page.goto("/quotes/new");
  await enterSd2(page);
  await page.getByRole("button", { name: "New client" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Paolo Newclient");
  await dialog.getByLabel("FB name").fill("Paolo N.");
  await dialog.getByLabel("Phone").fill("0917 555 0101");
  await dialog.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("combobox", { name: "Client", exact: true })).toContainText("Paolo Newclient");
  await page.getByLabel("Area of use: to (destination)").fill("Tagum City");
  await page.getByLabel("Notes (staff only, never on the client copy)").fill("Internal-note-do-not-share");
  const panel = page.getByTestId("price-panel");
  await expect(panel.getByRole("row", { name: /Rental total ₱2,191\.00/ })).toBeVisible();
  await expect(page.getByText(/^Draft saved/)).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);
  quoteUrl = page.url();

  await page.getByRole("button", { name: "Issue quotation" }).click();
  await expect(page.getByRole("heading", { name: "QTN-2026-110" })).toBeVisible();
  await expect(page.getByTestId("quote-status")).toHaveText("Issued");
  await expect(page.getByTestId("quote-doc").getByText("₱2,191.00")).toBeVisible();
  await page.screenshot({ path: info.outputPath("formal-issued.png"), fullPage: true });

  // Copy text carries the number and the validity.
  await page.getByRole("button", { name: "Copy text" }).click();
  const text = (await clipboard(page)).split("\n");
  expect(text[0]).toBe("J-MaVe Cars — QTN-2026-110");
  expect(text.slice(1, 9)).toEqual(SD2_LINES);
  expect(text[9]).toMatch(/^Valid until [A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} (AM|PM)$/);

  // Staff PDF.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "PDF" }).click()]);
  expect(download.suggestedFilename()).toBe("QTN-2026-110_Paolo-Newclient.pdf");
  expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe("%PDF-");

  // Issued is read-only: no editor fields.
  await expect(page.getByLabel("Release date")).toHaveCount(0);

  // Share link, opened signed out.
  await page.getByRole("button", { name: "Copy share link" }).click();
  shareUrl = await clipboard(page);
  expect(shareUrl).toMatch(/\/q\/[A-Za-z0-9_-]{43}$/);
  const anon = await browser.newContext();
  const pub = await anon.newPage();
  const res = await pub.goto(shareUrl);
  expect(res?.status()).toBe(200);
  await expect(pub.getByTestId("quote-number")).toHaveText("QTN-2026-110");
  await expect(pub.getByText("Self-Driven Rental Quotation")).toBeVisible();
  await expect(pub.getByText("₱2,191.00")).toBeVisible();
  await expect(pub.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const html = await pub.content();
  for (const secret of ["Internal-note-do-not-share", "sam.sales@example.test", "rateCardId", "rate_card"]) {
    expect(html, secret).not.toContain(secret);
  }
  await pub.screenshot({ path: info.outputPath("share-page.png"), fullPage: true });
  const [pubPdf] = await Promise.all([pub.waitForEvent("download"), pub.getByRole("link", { name: "Download PDF" }).click()]);
  expect(pubPdf.suggestedFilename()).toBe("QTN-2026-110_Paolo-Newclient.pdf");
  await anon.close();

  // The list finds it by number.
  await page.goto("/quotes?q=QTN-2026-110");
  await expect(page.getByTestId("quote-row")).toHaveCount(1);
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "QTN-2026-110" }).first()).toBeVisible();
});

test("blacklisted client: Sales sees the warning and cannot issue", async ({ page }) => {
  await signIn(page, SALES.email, SALES.password);
  await page.goto("/quotes/new");
  await page.getByRole("combobox", { name: "Client", exact: true }).click();
  await page.getByPlaceholder("Name, FB name, phone or email").fill("Ana Test");
  await page.getByRole("option", { name: /Ana Testcase/ }).click();
  await expect(page.getByTestId("blacklist-warning")).toBeVisible();
  await expect(page.getByTestId("blacklist-warning")).toContainText("Issuing is blocked");
  await expect(page.getByRole("button", { name: "Issue quotation" })).toBeDisabled();
});

test("Operations gets 403 on every quotation page and PDF route", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/users");
  await page.getByRole("button", { name: "New user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill(OPS.name);
  await dialog.getByLabel("Display name").fill(OPS.display);
  await dialog.getByLabel("Email").fill(OPS.email);
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: "Operations", exact: true }).click();
  await dialog.getByRole("button", { name: "Create user" }).click();
  const temp = (await page.getByTestId("temporary-password").textContent())!.trim();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await signIn(page, OPS.email, temp);
  await page.getByLabel("Current password").fill(temp);
  await page.getByLabel("New password", { exact: true }).fill(OPS.password);
  await page.getByLabel("Confirm new password").fill(OPS.password);
  await page.getByRole("button", { name: "Change password" }).click();
  await page.waitForURL(/\/board$/);

  const id = quoteUrl.split("/").pop();
  for (const path of ["/quotes", "/quotes/quick", "/quotes/new", `/quotes/${id}`, "/dashboard"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(403);
    await expect(page.getByText("No access"), path).toBeVisible();
  }
  const pdf = await page.request.get(`/api/quotations/${id}/pdf`);
  expect(pdf.status()).toBe(403);
});

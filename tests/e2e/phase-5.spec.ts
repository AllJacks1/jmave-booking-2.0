import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 5: hardening. Runs last (same database as the earlier specs).
 *
 * Role journeys (brief §6) — where each lives:
 * - Super Admin: setup (foundation.spec) + import (phase-1b.spec) + rate
 *   activation (here).
 * - Admin: user management (here).
 * - Sales: quote → booking → payment → confirm (phase-2a.spec, phase-2b.spec).
 * - Operations: release / return on a phone (phase-2b.spec, phase-3.spec).
 * - Public: request → inquiry in the Sales inbox (phase-4.spec).
 *
 * Plus: audit viewer, security headers and cookie flags, CSRF on the import
 * route, accessibility scans (axe) of the main pages, and page timings.
 * Invented data only.
 */
const OWNER = { email: "owner@example.test", password: "owner-password-123" };
const ADMIN = { email: "ada.admin@example.test", password: "admin-password-789" };
const SALES = { email: "sam.sales@example.test", password: "sales-password-456" };
const OPS = { email: "otto.ops@example.test", password: "ops-password-321" };
const TRAINEE = { name: "Tina Trainee", display: "Tina", email: "tina.trainee@example.test" };

test.describe.configure({ mode: "serial", timeout: 240_000 });

type Cookies = Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>;
const sessions = new Map<string, Cookies>();

async function signIn(page: Page, email: string, password: string) {
  const saved = sessions.get(email);
  if (saved) {
    await page.context().clearCookies();
    await page.context().addCookies(saved);
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

test("security headers: CSP nonce, nosniff, referrer, permissions; session cookie flags", async ({ page, request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(h["content-security-policy"]).toContain("object-src 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["permissions-policy"]).toContain("camera=()");
  expect(h["x-request-id"]).toBeTruthy();
  expect(h["x-powered-by"]).toBeUndefined();

  // Share links never leak their token as a referrer.
  expect((await request.get("/q/not-a-real-token-but-long-enough")).headers()["referrer-policy"]).toBe("no-referrer");

  // The page still runs under the CSP (hydrated: the form works and no CSP errors).
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto("/book");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "User menu" })).toBeVisible();
  // A dialog (Radix scroll lock inserts a <style> with the nonce) and a toast (Sonner's hashed stylesheet).
  await page.goto("/users");
  await page.getByRole("button", { name: "New user" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Save settings" }).click();
  // Nothing changed, so the toast says so (still a Sonner toast with its stylesheet).
  await expect(page.getByText(/^(Settings saved|No changes to save)$/)).toBeVisible();
  expect(violations).toEqual([]);

  const cookie = (await page.context().cookies()).find((c) => c.name.includes("session_token"));
  expect(cookie).toBeTruthy();
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe("Lax");
});

test("CSRF: a cross-site upload to /api/import is refused", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  const res = await page.request.post("/api/import", {
    headers: { origin: "https://evil.example.test" },
    multipart: { file: { name: "x.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("PK\u0003\u0004") } },
  });
  expect(res.status()).toBe(403);
});

test("Super Admin: copy the active rate card to a draft and activate it; audit shows the change", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/rates");
  await expect(page.getByRole("heading", { name: /Active: v\d+/ })).toBeVisible();

  page.once("dialog", (d) => d.accept("Phase 5 re-issue (same values)"));
  await page.getByRole("button", { name: "New draft" }).first().click();
  const created = page.getByText(/^Draft v\d+ created$/);
  await expect(created).toBeVisible();
  const version = Number((await created.textContent())!.match(/v(\d+)/)![1]);
  await expect(page).toHaveURL(/\/rates\/[0-9a-f-]{36}\/edit$/);
  const draftId = page.url().match(/rates\/([0-9a-f-]{36})/)![1];

  await page.goto(`/rates/${draftId}`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText(/is now active/)).toBeVisible();
  await page.goto("/rates");
  await expect(page.getByRole("heading", { name: new RegExp(`Active: v${version} `) })).toBeVisible();

  await page.goto("/audit?entity=rate_card&action=rate_card.activate");
  await expect(page.getByRole("cell", { name: "rate_card.activate" }).first()).toBeVisible();
  await page.getByRole("link", { name: /^View/ }).first().click();
  await expect(page.getByRole("heading", { name: "rate_card.activate" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Changed" }).or(page.getByRole("cell", { name: "Added" })).first()).toBeVisible();
});

test("Admin: create an Operations user, deactivate them; audit lists both; Sales gets 403 on /audit", async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto("/users");
  await page.getByRole("button", { name: "New user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill(TRAINEE.name);
  await dialog.getByLabel("Display name").fill(TRAINEE.display);
  await dialog.getByLabel("Email").fill(TRAINEE.email);
  await dialog.getByLabel("Role").click();
  await page.getByRole("option", { name: "Operations" }).click();
  await dialog.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByTestId("temporary-password")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  const row = page.getByTestId(`user-row-${TRAINEE.email}`);
  await expect(row).toContainText("Operations");

  await page.getByRole("button", { name: `Actions for ${TRAINEE.display}` }).click();
  await page.getByRole("menuitem", { name: "Deactivate" }).click();
  await expect(page.getByText(`${TRAINEE.display} deactivated`)).toBeVisible();

  // Admin cannot manage Admins (no action menu on Super Admin / Admin rows).
  await expect(page.getByRole("button", { name: "Actions for Olivia" })).toHaveCount(0);

  await page.goto("/audit?entity=user");
  await expect(page.getByRole("cell", { name: "user.deactivate" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "user.create" }).first()).toBeVisible();

  await signIn(page, SALES.email, SALES.password);
  const res = await page.goto("/audit");
  expect(res?.status()).toBe(403);
});

// Accessibility: no serious or critical WCAG 2.x A/AA violations on the main flows.
const A11Y_PAGES: { who: "owner" | "sales" | "ops" | "public"; path: string }[] = [
  { who: "public", path: "/login" },
  { who: "public", path: "/book" },
  { who: "sales", path: "/dashboard" },
  { who: "sales", path: "/quotes" },
  { who: "sales", path: "/quotes/new" },
  { who: "sales", path: "/bookings" },
  { who: "sales", path: "/clients" },
  { who: "sales", path: "/inquiries" },
  { who: "ops", path: "/board" },
  { who: "ops", path: "/calendar" },
  { who: "ops", path: "/roster" },
  { who: "owner", path: "/users" },
  { who: "owner", path: "/settings" },
  { who: "owner", path: "/audit" },
];

test("accessibility: main pages have no serious or critical axe violations", async ({ page }, info) => {
  const creds = { owner: OWNER, sales: SALES, ops: OPS } as const;
  const failures: string[] = [];
  for (const p of A11Y_PAGES) {
    if (p.who === "public") await page.context().clearCookies();
    else await signIn(page, creds[p.who].email, creds[p.who].password);
    await page.goto(p.path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    for (const v of bad) failures.push(`${p.path}: ${v.id} (${v.impact}) — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
  }
  await info.attach("axe-failures.txt", { body: failures.join("\n") || "none", contentType: "text/plain" });
  expect(failures).toEqual([]);
});

test("keyboard: the login form and the staff menu work without a mouse", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  // Tab from the top of the page reaches the Email field within a few stops (theme toggle may come first).
  const email = page.getByLabel("Email");
  for (let i = 0; i < 5 && !(await email.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(email).toBeFocused();
  await page.keyboard.type(SALES.email);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.type(SALES.password);
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.pathname !== "/login");
  sessions.set(SALES.email, await page.context().cookies());

  // Tab reaches the Quotations link in the menu and Enter opens it.
  const link = page.getByRole("link", { name: "Quotations" });
  for (let i = 0; i < 30 && !(await link.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/quotes$/);
});

test("performance: board and calendar under 1.5 s, quotation PDF under 2 s", async ({ page }, info) => {
  await signIn(page, OPS.email, OPS.password);
  const timings: Record<string, number> = {};
  for (const path of ["/board", "/calendar"]) {
    await page.goto(path); // warm (first compile of the route on this server)
    const t0 = Date.now();
    await page.goto(path);
    await page.waitForLoadState("load");
    timings[path] = Date.now() - t0;
  }
  await signIn(page, SALES.email, SALES.password);
  await page.goto("/quotes?kind=formal&status=issued");
  const href = await page.getByRole("link", { name: /^QTN-/ }).first().getAttribute("href");
  const id = href!.split("/").pop();
  await page.request.get(`/api/quotations/${id}/pdf`); // warm fonts
  const t0 = Date.now();
  const pdf = await page.request.get(`/api/quotations/${id}/pdf`);
  timings.pdf = Date.now() - t0;
  expect(pdf.status()).toBe(200);
  await info.attach("timings.json", { body: JSON.stringify(timings, null, 2), contentType: "application/json" });
  expect(timings["/board"]).toBeLessThan(1500);
  expect(timings["/calendar"]).toBeLessThan(1500);
  expect(timings.pdf).toBeLessThan(2000);
});

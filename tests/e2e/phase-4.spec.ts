import { createServer } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

/**
 * Phase 4: public booking page → inquiry in the staff inbox → Rework outbox
 * row with the mapped payload (Rework itself is not called: no worker runs
 * in e2e). Turnstile uses Cloudflare's published test keys (always passes).
 * Runs after the earlier specs (same database: active rate card, Sales user).
 * Invented data only.
 */
const SALES = { email: "sam.sales@example.test", password: "sales-password-456" };
const CAR = "Publicar Primo TST 9001";
// Company-site origins for the embed test (served by a local http server in the test).
const ALLOWED = "http://127.0.0.1:3199";
const OTHER = "http://127.0.0.1:3198";

test.describe.configure({ mode: "serial", timeout: 180_000 });

function manilaDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const START = manilaDate(40);
const END = manilaDate(42);

const sql = postgres(process.env.E2E_DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
test.afterAll(async () => {
  await sql.end({ timeout: 5 });
});

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
  await expect(page).not.toHaveURL(/\/login$/);
}

let reference = "";

test("a client books on the public page: available car with price → details → Turnstile → reference", async ({ browser }) => {
  // A sedan with a rate category (only those are priced publicly).
  await sql`insert into vehicles (display_name, plate, body_type, category, fuel_type, seats, transmission, sort_order)
            values (${CAR}, 'TST 9001', 'sedan', 'primo', 'gasoline', 5, 'AT', 1) on conflict (plate) do nothing`;

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); // signed out, phone size
  const page = await context.newPage();
  await page.goto(`/book?utm_source=e2e&utm_campaign=phase4&fbclid=IwAR-e2e`);
  await expect(page.getByRole("heading", { name: "Book a car" })).toBeVisible();
  await page.getByRole("button", { name: /Self-Drive/ }).click();

  await page.getByLabel("Pick-up date").fill(START);
  await page.getByLabel("Pick-up time").selectOption("09:00");
  await page.getByLabel("Return date").fill(END);
  await page.getByLabel("Return time").selectOption("09:00");
  await page.getByRole("button", { name: "Show available cars" }).click();

  const option = page.getByTestId("car-option").filter({ hasText: "Publicar Primo" });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await expect(option).not.toContainText("TST 9001"); // plates are never shown
  // Sedan Primo 24h × 2 days + carwash (rate card v1, no new-client discount on the page).
  await expect(option.getByTestId("car-price")).toHaveText("₱3,980.00");
  await option.click();

  await page.getByLabel("Full name").fill("Petra Public");
  await page.getByLabel("Mobile number").fill("0917 777 0404");
  await page.getByLabel("Email (optional)").fill("petra.public@example.test");
  await page.getByLabel("Deliver the car to (optional)").fill("Door 4, Invented Road, Davao City");
  await page.getByLabel("Passport").check();
  await page.getByLabel("Payment preference").selectOption("gcash");
  await page.getByRole("button", { name: "Review request" }).click();

  const summary = page.getByTestId("summary");
  await expect(summary).toBeVisible();
  await expect(summary.getByText("Delivery fee")).toBeVisible();
  await expect(summary.getByText("to be confirmed")).toBeVisible();
  await expect(summary.getByText("New clients get 5% off — applied on your formal quotation.")).toBeVisible();
  await expect(summary.getByTestId("summary-total")).toHaveText("₱5,980.00"); // + ₱2,000 deposit

  // Consent is required.
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page.getByText("Please agree to the privacy notice.")).toBeVisible();
  await page.getByTestId("consent").check();
  // Turnstile test key: the widget passes on its own and fills its hidden input.
  await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue("", { timeout: 30_000 });
  await page.getByRole("button", { name: "Send booking request" }).click();

  await expect(page.getByTestId("thank-you")).toBeVisible({ timeout: 20_000 });
  reference = (await page.getByTestId("request-reference").textContent())!.trim();
  expect(reference).toMatch(/^REQ-\d{4}-\d{4}$/);
  await expect(page.getByTestId("thank-you").getByText(/Mobile:/)).toBeVisible();
  await context.close();

  // Nothing holds the car; the Rework lead is queued with the mapped payload.
  const [inq] = await sql`select id, status, utm, quotation_id from inquiries where reference = ${reference}`;
  expect(inq.status).toBe("new");
  expect(inq.utm).toMatchObject({ utm_source: "e2e", utm_campaign: "phase4", fbclid: "IwAR-e2e" });
  const holds = await sql`select h.id from vehicle_holds h join vehicles v on v.id = h.vehicle_id where v.plate = 'TST 9001'`;
  expect(holds).toHaveLength(0);
  const [row] = await sql`select kind, status, payload from outbox where entity = 'inquiry' and entity_id = ${inq.id}`;
  expect(row).toMatchObject({ kind: "rework_lead", status: "pending" });
  expect(row.payload.lead).toMatchObject({
    name: "Petra Public",
    phone: "+639177770404",
    email: "petra.public@example.test",
    labels: ["Self-Drive"],
    custom_services: "Self-Drive",
    custom_car_type: "Sedan",
    custom_delivery_address: "Door 4, Invented Road, Davao City",
    custom_government_id: "Passport",
    custom_mode_of_payment: "GCash",
    custom_deal_sources: "Website Booking Page",
    utm_source: "e2e",
    utm_campaign: "phase4",
    fbclid: "IwAR-e2e",
  });
  expect(typeof row.payload.lead.custom_start_time).toBe("number");
});

test("the request appears in the staff inbox with a badge and a prefilled draft", async ({ page }) => {
  expect(reference).not.toBe("");
  await signIn(page, SALES.email, SALES.password);
  await expect(page.getByTestId("nav-badge-inquiries")).toBeVisible();
  await page.goto("/inquiries");
  await page.getByRole("link", { name: reference }).click();
  await expect(page.getByRole("heading", { name: reference })).toBeVisible();
  await expect(page.getByText("Petra Public").first()).toBeVisible();
  await expect(page.getByTestId("rework-delivery")).toContainText("Lead pending");
  await page.getByRole("link", { name: "Review quotation" }).click();
  await expect(page.getByRole("heading", { name: "Draft quotation" })).toBeVisible();
  await expect(page.getByTestId("from-request")).toContainText(reference);
});

test("embedding: allowed on the configured origin, refused on others", async ({ browser, request }) => {
  const res = await request.get("/book?embed=1");
  expect(res.headers()["content-security-policy"]).toContain(`frame-ancestors 'self' ${ALLOWED}`);
  const staff = await request.get("/login");
  expect(staff.headers()["content-security-policy"]).toMatch(/frame-ancestors 'self'(;|$)/);

  const base = test.info().project.use.baseURL!;
  for (const [origin, allowed] of [
    [ALLOWED, true],
    [OTHER, false],
  ] as const) {
    // A real local "company site" (a route-fulfilled page is not local, and
    // Chrome's Local Network Access checks would block it from framing localhost).
    const site = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><title>Company site</title><iframe id="f" src="${base}/book?embed=1" style="width:100%;height:600px"></iframe>`);
    });
    await new Promise<void>((resolve) => site.listen(Number(new URL(origin).port), "127.0.0.1", resolve));
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    const wizard = page.frameLocator("#f").getByTestId("booking-wizard");
    if (allowed) {
      await expect(wizard).toBeVisible({ timeout: 15_000 });
      // Embedded: no page header/footer.
      await expect(page.frameLocator("#f").getByText("Privacy notice", { exact: true })).toHaveCount(0);
    } else {
      await page.waitForTimeout(3_000);
      await expect(wizard).toHaveCount(0);
    }
    await context.close();
    await new Promise((resolve) => site.close(resolve));
  }
});

test("public host: pages come from /book, staff routes are not served", async ({ request }) => {
  const home = await request.get("/", { headers: { host: "book.e2e.test" } });
  expect(home.status()).toBe(200);
  expect(await home.text()).toContain("Book a car");
  const login = await request.get("/login", { headers: { host: "book.e2e.test" } });
  expect(login.status()).toBe(404);
  const auth = await request.get("/api/auth/get-session", { headers: { host: "book.e2e.test" } });
  expect(auth.status()).toBe(404);
  const privacy = await request.get("/privacy", { headers: { host: "book.e2e.test" } });
  expect(await privacy.text()).toContain("Data Privacy Act of 2012");
});

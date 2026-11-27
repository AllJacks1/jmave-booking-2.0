/**
 * Staging seed (Phase 5): invented data only — no real clients, phones,
 * plates or emails. Everything below is made up; phones use the
 * +63 917 000 xxxx range and emails `@example.test` / `@staging.jmave.test`.
 *
 * Bookings go through the real services (issue → convert → payment →
 * confirm → release → return), so staging exercises the same code paths
 * and audit rows as production. Dates are relative to "today" in Manila.
 *
 * Run with `pnpm db:seed:staging` (scripts/seed-staging.ts adds the guards).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, drivers, holidays, numberSequences, rateCards, shiftTemplates, vehicles } from "@/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { saveBlock } from "@/lib/bookings/blocks";
import { addPayment, confirmBooking, convertToBooking } from "@/lib/bookings/service";
import { recordRelease, recordReturn } from "@/lib/check-in/service";
import { EXPECTED_RATE_CARD_V1 } from "@/lib/pricing";
import { FUEL, WD1_FORM } from "@/lib/quotes/fixtures";
import type { QuoteFormInput } from "@/lib/quotes/schema";
import { issueQuotation, saveDraft, saveQuick } from "@/lib/quotes/service";
import { setShift } from "@/lib/roster/service";
import { ensureDefaultSettings } from "@/lib/settings/service";
import { addDaysToKey, manilaDateKey, manilaYear } from "@/lib/time";
import { insertUserWithPassword } from "@/lib/users/service";
import type { Role } from "@/db/schema";

type R<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
function ok<T>(label: string, r: R<T>): T {
  if (!r.ok) throw new Error(`seed: ${label} failed (${r.status}): ${r.error}`);
  return r.data;
}

export const STAGING_USERS: { role: Role; name: string; email: string }[] = [
  { role: "super_admin", name: "Stella Owner", email: "owner@staging.jmave.test" },
  { role: "admin", name: "Arturo Admin", email: "admin@staging.jmave.test" },
  { role: "sales", name: "Sofia Sales", email: "sales1@staging.jmave.test" },
  { role: "sales", name: "Samuel Sales", email: "sales2@staging.jmave.test" },
  { role: "operations", name: "Olivia Ops", email: "ops1@staging.jmave.test" },
  { role: "operations", name: "Oscar Ops", email: "ops2@staging.jmave.test" },
];

const FIRST = ["Andrea", "Benjo", "Carla", "Dindo", "Elena", "Ferdie", "Gina", "Hector", "Ines", "Jomar", "Karla", "Lito", "Mika", "Nonoy", "Ofelia", "Paolo", "Queenie", "Rodel", "Sheila", "Tonyo"];
const LAST = ["Testa", "Ejemplo", "Muestra", "Prueba", "Sample", "Demo", "Fiktibo", "Halimbawa", "Kunwari", "Placido"];

const FLEET = [
  { displayName: "Wigo Red AT TST 1001", plate: "TST 1001", make: "Toyota", model: "Wigo", color: "Red", bodyType: "compact", fuelType: "gasoline", tankCapacityL: 33, seats: 5 },
  { displayName: "Mirage Blue AT TST 1002", plate: "TST 1002", make: "Mitsubishi", model: "Mirage", color: "Blue", bodyType: "compact", fuelType: "gasoline", tankCapacityL: 35, seats: 5 },
  { displayName: "Vios Silver AT TST 2001", plate: "TST 2001", make: "Toyota", model: "Vios", color: "Silver", bodyType: "sedan", category: "primo", fuelType: "gasoline", tankCapacityL: 42, seats: 5 },
  { displayName: "City White AT TST 2002", plate: "TST 2002", make: "Honda", model: "City", color: "White", bodyType: "sedan", category: "premium", fuelType: "gasoline", tankCapacityL: 40, seats: 5 },
  { displayName: "Avanza Grey AT TST 3001", plate: "TST 3001", make: "Toyota", model: "Avanza", color: "Grey", bodyType: "mpv", category: "primo", fuelType: "gasoline", tankCapacityL: 43, seats: 7 },
  { displayName: "Fortuner Black AT TST 4001", plate: "TST 4001", make: "Toyota", model: "Fortuner", color: "Black", bodyType: "suv", category: "primo", fuelType: "diesel", tankCapacityL: 80, seats: 7 },
  { displayName: "Hilux White MT TST 5001", plate: "TST 5001", make: "Toyota", model: "Hilux", color: "White", bodyType: "pickup", fuelType: "diesel", tankCapacityL: 80, seats: 5 },
  { displayName: "Hiace Silver MT TST 6001", plate: "TST 6001", make: "Toyota", model: "Hiace", color: "Silver", bodyType: "van", fuelType: "diesel", tankCapacityL: 70, seats: 15 },
] as const;

export type SeedSummary = { users: number; vehicles: number; clients: number; bookings: number; quotations: number };

export async function seedStaging(opts: { password: string; now?: Date }): Promise<SeedSummary> {
  if (opts.password.length < 12) throw new Error("seed: password must be at least 12 characters");
  const now = opts.now ?? new Date();
  const today = manilaDateKey(now);
  const d = (n: number) => addDaysToKey(today, n);

  const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from "user"`);
  if (n > 0) throw new Error("seed: the database already has users; reset it first (--reset)");

  await ensureDefaultSettings();
  const actors: Record<string, CurrentUser> = {};
  for (const u of STAGING_USERS) {
    const row = await insertUserWithPassword(db, { name: u.name, displayName: u.name.split(" ")[0], email: u.email, role: u.role, password: opts.password, mustChangePassword: false });
    actors[u.email] = { id: row.id, email: row.email, name: row.name, displayName: row.displayName, role: row.role, active: true, mustChangePassword: false };
  }
  const owner = actors["owner@staging.jmave.test"];
  const sales = actors["sales1@staging.jmave.test"];
  const ops = actors["ops1@staging.jmave.test"];

  await db.insert(rateCards).values({ version: 1, name: "Staging rate card (pricing.md values)", status: "active", data: EXPECTED_RATE_CARD_V1, source: "staging-seed", effectiveFrom: now });
  await db.insert(numberSequences).values([
    { key: `QTN-${manilaYear(now)}`, lastValue: 100 },
    { key: `QTN-WD${manilaYear(now)}`, lastValue: 10 },
  ]);
  const year = Number(today.slice(0, 4));
  await db.insert(holidays).values([
    { date: `${year}-12-25`, name: "Christmas Day" },
    { date: `${year}-12-30`, name: "Rizal Day" },
    { date: `${year + 1}-01-01`, name: "New Year's Day" },
  ]);
  const cars = await db
    .insert(vehicles)
    .values(FLEET.map((v, i) => ({ ...v, ownership: "owned" as const, sortOrder: i, active: true })))
    .returning({ id: vehicles.id, plate: vehicles.plate });
  const car = (plate: string) => cars.find((c) => c.plate === plate)!.id;
  await db.insert(drivers).values([
    { name: "Dante Drayber", phone: "+639170009001" },
    { name: "Romy Ruta", phone: "+639170009002" },
  ]);

  const clientRows = await db
    .insert(clients)
    .values(
      FIRST.map((f, i) => ({
        fullName: `${f} ${LAST[i % LAST.length]}`,
        fbName: `${f} ${LAST[i % LAST.length][0]}.`,
        phone: `+63917000${String(1000 + i).padStart(4, "0")}`,
        email: `${f.toLowerCase()}.${LAST[i % LAST.length].toLowerCase()}@example.test`,
        address: `${i + 1} Sample Street, Davao City`,
        clientType: i % 7 === 6 ? ("corporate" as const) : ("individual" as const),
        companyName: i % 7 === 6 ? `${LAST[i % LAST.length]} Demo Corp.` : null,
        source: "staging-seed",
        isBlacklisted: i === 19,
        blacklistReason: i === 19 ? "Invented: unpaid damage (staging example)" : null,
      })),
    )
    .returning({ id: clients.id });

  const sd = (o: { client: number; plate: string; start: string; startTime?: string; end: string; endTime?: string; bodyType: QuoteFormInput["bodyType"]; category?: QuoteFormInput["category"] }): QuoteFormInput => ({
    service: "self_drive",
    bodyType: o.bodyType,
    category: o.category,
    repeat: "new",
    clientId: clientRows[o.client].id,
    vehicleId: car(o.plate),
    startDate: o.start,
    startTime: o.startTime ?? "09:00",
    endDate: o.end,
    endTime: o.endTime ?? "09:00",
    deliveryFee: 0,
    reservationFee: 50_000,
    deposit: 200_000,
    fuelPrices: FUEL,
  });

  let bookingsMade = 0;
  let quotations = 0;
  async function book(form: QuoteFormInput, steps: { confirm?: boolean; release?: { date: string; time: string; km: number }; ret?: { date: string; time: string; km: number; fuel: number } }) {
    const { id } = ok("draft", await saveDraft(sales, { id: null, form }));
    const q = ok("issue", await issueQuotation(sales, { id, form, overrideReason: "" }));
    quotations++;
    const b = ok("convert", await convertToBooking(sales, { quotationId: q.id }));
    bookingsMade++;
    if (steps.confirm) {
      ok("payment", await addPayment(sales, { bookingId: b.id, type: "reservation_fee", amountCentavos: 50_000, method: "gcash", reference: "TEST-REF", collectedByUserId: sales.id, paidDate: d(-12), paidTime: "10:00" }));
      ok("confirm", await confirmBooking(sales, { id: b.id }));
    }
    if (steps.release) ok("release", await recordRelease(ops, { bookingId: b.id, actualDate: steps.release.date, actualTime: steps.release.time, odometerKm: steps.release.km, fuelLevelEighths: 8 }));
    if (steps.ret) ok("return", await recordReturn(ops, { bookingId: b.id, actualDate: steps.ret.date, actualTime: steps.ret.time, odometerKm: steps.ret.km, fuelLevelEighths: steps.ret.fuel }));
    return b;
  }

  // Returned last week (charges + points), out now, confirmed upcoming, pending reservation.
  await book(sd({ client: 0, plate: "TST 2001", bodyType: "sedan", category: "primo", start: d(-10), end: d(-8) }), {
    confirm: true,
    release: { date: d(-10), time: "09:10", km: 20_000 },
    ret: { date: d(-8), time: "10:30", km: 20_420, fuel: 7 },
  });
  await book(sd({ client: 1, plate: "TST 1001", bodyType: "compact", start: d(-1), startTime: "10:00", end: d(1), endTime: "10:00" }), {
    confirm: true,
    release: { date: d(-1), time: "10:05", km: 31_500 },
  });
  await book(sd({ client: 2, plate: "TST 3001", bodyType: "mpv", category: "primo", start: d(2), end: d(4) }), { confirm: true });
  await book(sd({ client: 3, plate: "TST 1002", bodyType: "compact", start: d(3), startTime: "13:00", end: d(5), endTime: "13:00" }), {});
  await book(sd({ client: 4, plate: "TST 2002", bodyType: "sedan", category: "premium", start: d(0), startTime: "15:00", end: d(1), endTime: "15:00" }), { confirm: true });
  // With Driver day trip.
  await book({ ...WD1_FORM, clientId: clientRows[5].id, vehicleId: car("TST 4001"), startDate: d(5), endDate: d(5), repeat: "new" }, { confirm: true });

  // An issued quotation not yet converted, and a quick estimate.
  {
    const form = sd({ client: 6, plate: "TST 6001", bodyType: "van", start: d(7), end: d(9) });
    const { id } = ok("draft", await saveDraft(sales, { id: null, form }));
    ok("issue", await issueQuotation(sales, { id, form, overrideReason: "" }));
    quotations++;
    ok("quick", await saveQuick(sales, { id: null, form: { ...form, clientId: undefined, vehicleId: undefined } }));
    quotations++;
  }

  ok("block", await saveBlock(owner, { vehicleId: car("TST 5001"), kind: "maintenance", startDate: d(6), startTime: "08:00", endDate: d(7), endTime: "17:00", reason: "Change oil (staging example)" }));

  // Roster: this week and next for both Ops users.
  const templates = await db.select({ id: shiftTemplates.id, name: shiftTemplates.name }).from(shiftTemplates);
  const day = templates.find((t) => t.name.startsWith("8"))?.id ?? templates[0].id;
  const night = templates.find((t) => t.name.startsWith("9PM"))?.id ?? templates[templates.length - 1].id;
  for (let i = -3; i < 11; i++) {
    ok("shift", await setShift(owner, { date: d(i), userId: ops.id, templateId: i % 7 === 6 ? null : day, duty: "operations" }));
    ok("shift", await setShift(owner, { date: d(i), userId: actors["ops2@staging.jmave.test"].id, templateId: i % 7 === 5 ? null : night, duty: "operations" }));
  }

  return { users: STAGING_USERS.length, vehicles: cars.length, clients: clientRows.length, bookings: bookingsMade, quotations };
}

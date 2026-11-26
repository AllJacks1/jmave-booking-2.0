import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Role } from "@/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { insertUserWithPassword } from "@/lib/users/service";

/** Wipe app data between tests (keeps the schema). */
export async function truncateAll() {
  await db.execute(
    sql`truncate table "outbox", "points_ledger", "loyalty_accounts", "vehicle_holds", "payments", "booking_charges", "bookings", "vehicle_blocks", "drivers", "quotations", "import_runs", "clients", "vehicles", "rate_cards", "holidays", "number_sequences", "audit_log", "settings", "shift_assignments", "movement_events", "session", "account", "verification", "rate_limit", "user" restart identity cascade`,
  );
}

let counter = 0;

/** Create a user directly and return the actor shape actions receive. */
export async function makeUser(role: Role, overrides: Partial<{ active: boolean }> = {}) {
  counter += 1;
  const row = await insertUserWithPassword(db, {
    name: `Test ${role} ${counter}`,
    displayName: `Test ${role} ${counter}`,
    email: `${role}.${counter}@example.test`,
    role,
    password: "correct-horse-battery",
    mustChangePassword: false,
  });
  if (overrides.active === false) {
    await db.execute(sql`update "user" set active = false where id = ${row.id}`);
  }
  const actor: CurrentUser = {
    id: row.id,
    email: row.email,
    name: row.name,
    displayName: row.displayName,
    role: row.role,
    active: overrides.active ?? true,
    mustChangePassword: false,
  };
  return actor;
}

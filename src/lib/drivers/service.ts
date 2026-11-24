/**
 * Drivers (bookings-and-movement.md §8): name, phone, active. Not system users.
 */
import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { drivers } from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { driverSchema } from "@/lib/bookings/schema";

export async function listDrivers(opts: { activeOnly?: boolean } = {}) {
  const q = db.select().from(drivers);
  return (opts.activeOnly ? q.where(eq(drivers.active, true)) : q).orderBy(desc(drivers.active), asc(sql`lower(${drivers.name})`));
}

export const saveDriver = defineAction({
  permission: "drivers.manage",
  input: driverSchema,
  handler: async (actor, { id, ...values }) => {
    return db.transaction(async (tx) => {
      const [dup] = await tx
        .select({ id: drivers.id })
        .from(drivers)
        .where(sql`lower(${drivers.name}) = lower(${values.name})${id ? sql` and ${drivers.id} <> ${id}` : sql``}`);
      if (dup) throw new ActionError(409, "A driver with this name already exists.", { name: ["Already exists"] });
      if (id) {
        const [cur] = await tx.select().from(drivers).where(eq(drivers.id, id)).for("update");
        if (!cur) throw new ActionError(404, "Driver not found.");
        await tx.update(drivers).set(values).where(eq(drivers.id, id));
        await withAudit(actor, "driver.updated", "driver", id, cur, values, tx);
        return { id };
      }
      const [row] = await tx.insert(drivers).values({ ...values, source: "manual" }).returning();
      await withAudit(actor, "driver.created", "driver", row.id, null, values, tx);
      return { id: row.id };
    });
  },
});

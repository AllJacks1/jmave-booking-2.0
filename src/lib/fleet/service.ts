import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { vehicles, type VehicleRow } from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { updateVehicleSchema, vehicleSchema } from "./schema";

export async function listVehicles(): Promise<VehicleRow[]> {
  return db.select().from(vehicles).orderBy(asc(vehicles.sortOrder), asc(vehicles.displayName));
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export const createVehicle = defineAction({
  permission: "fleet.edit",
  input: vehicleSchema,
  handler: async (actor, input) => {
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx.insert(vehicles).values(input).returning();
        await withAudit(actor, "vehicle.create", "vehicle", row.id, null, input, tx);
        return { id: row.id };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ActionError(409, "Another vehicle has this plate.", { plate: ["Already used"] });
      throw err;
    }
  },
});

export const updateVehicle = defineAction({
  permission: "fleet.edit",
  input: updateVehicleSchema,
  handler: async (actor, { id, vehicle }) => {
    try {
      return await db.transaction(async (tx) => {
        const [before] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).for("update");
        if (!before) throw new ActionError(404, "Vehicle not found.");
        const [after] = await tx.update(vehicles).set(vehicle).where(eq(vehicles.id, id)).returning();
        await withAudit(actor, "vehicle.update", "vehicle", id, before, after, tx);
        return { id };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ActionError(409, "Another vehicle has this plate.", { "vehicle.plate": ["Already used"] });
      throw err;
    }
  },
});

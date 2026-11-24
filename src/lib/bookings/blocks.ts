/**
 * Vehicle blocks (bookings-and-movement.md §7): owner use, maintenance,
 * hired out, manual hold, other. Each block owns a vehicle hold, so it
 * prevents double booking exactly like a confirmed booking. No turnaround
 * buffer is added to a block.
 */
import "server-only";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { vehicleBlocks, vehicles } from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { releaseHold, setHold, VehicleConflictError } from "@/lib/holds";
import { manilaToUtc } from "@/lib/time";
import { blockSchema, bookingIdSchema } from "./schema";

export const saveBlock = defineAction({
  permission: "vehicle_blocks.manage",
  input: blockSchema,
  handler: async (actor, input) => {
    const startAt = manilaToUtc(input.startDate, input.startTime);
    const endAt = manilaToUtc(input.endDate, input.endTime);
    if (!(endAt > startAt)) throw new ActionError(400, "End must be after start.", { endTime: ["End must be after start"] });
    return db.transaction(async (tx) => {
      const [v] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, input.vehicleId));
      if (!v) throw new ActionError(400, "Vehicle not found.", { vehicleId: ["Vehicle not found"] });
      const values = { vehicleId: input.vehicleId, kind: input.kind, startAt, endAt, reason: input.reason };
      let id: string;
      let before: unknown = null;
      if (input.id) {
        const [cur] = await tx.select().from(vehicleBlocks).where(eq(vehicleBlocks.id, input.id)).for("update");
        if (!cur) throw new ActionError(404, "Block not found.");
        if (cur.cancelledAt) throw new ActionError(409, "This block was removed.");
        before = cur;
        await tx.update(vehicleBlocks).set(values).where(eq(vehicleBlocks.id, cur.id));
        id = cur.id;
      } else {
        const [row] = await tx.insert(vehicleBlocks).values({ ...values, createdBy: actor.id }).returning();
        id = row.id;
      }
      try {
        await setHold(tx, { blockId: id }, { vehicleId: input.vehicleId, startAt, endAt, bufferMinutes: 0 });
      } catch (err) {
        if (err instanceof VehicleConflictError) throw new ActionError(409, err.message);
        throw err;
      }
      await withAudit(actor, input.id ? "block.updated" : "block.created", "vehicle_block", id, before, values, tx);
      return { id };
    });
  },
});

/**
 * End a block now. A block that has not started yet is removed (hold
 * inactive); a running one ends at the current time.
 */
export const endBlock = defineAction({
  permission: "vehicle_blocks.manage",
  input: bookingIdSchema,
  handler: async (actor, { id }) => {
    return db.transaction(async (tx) => {
      const [cur] = await tx.select().from(vehicleBlocks).where(eq(vehicleBlocks.id, id)).for("update");
      if (!cur) throw new ActionError(404, "Block not found.");
      const now = new Date();
      if (cur.cancelledAt || cur.endAt <= now) throw new ActionError(409, "This block has already ended.");
      if (cur.startAt >= now) {
        await tx.update(vehicleBlocks).set({ cancelledAt: now }).where(eq(vehicleBlocks.id, id));
        await releaseHold(tx, { blockId: id });
        await withAudit(actor, "block.removed", "vehicle_block", id, cur, { cancelledAt: now.toISOString() }, tx);
      } else {
        await tx.update(vehicleBlocks).set({ endAt: now }).where(eq(vehicleBlocks.id, id));
        await setHold(tx, { blockId: id }, { vehicleId: cur.vehicleId, startAt: cur.startAt, endAt: now, bufferMinutes: 0 });
        await withAudit(actor, "block.ended", "vehicle_block", id, { endAt: cur.endAt.toISOString() }, { endAt: now.toISOString() }, tx);
      }
      return { id };
    });
  },
});

/** Live blocks overlapping [from, to). */
export async function blocksInRange(from: Date, to: Date) {
  return db
    .select()
    .from(vehicleBlocks)
    .where(and(isNull(vehicleBlocks.cancelledAt), lt(vehicleBlocks.startAt, to), gt(vehicleBlocks.endAt, from)));
}

export async function getBlock(id: string) {
  const [row] = await db.select().from(vehicleBlocks).where(eq(vehicleBlocks.id, id));
  return row ?? null;
}

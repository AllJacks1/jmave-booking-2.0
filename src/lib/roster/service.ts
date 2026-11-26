/**
 * Shift roster (bookings-and-movement.md §9): week grid, edit (Admin+),
 * copy previous week, on-duty lookups for the board and dashboard.
 */
import "server-only";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { shiftAssignments, shiftTemplates, user } from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { DUTIES, type Duty } from "@/lib/bookings/constants";
import { addDaysToKey, isDateKey, manilaDateKey, type DateKey } from "@/lib/time";
import { copyWeekPlan, hhmm, onDutyAt, weekDays, weekStart, type ShiftTemplate } from "./shifts";

const dateKey = z.string().refine(isDateKey, "Enter a valid date");

export const setShiftSchema = z.object({
  date: dateKey,
  userId: z.uuid(),
  /** null = off that day. */
  templateId: z.uuid().nullable(),
  duty: z.enum(DUTIES).default("operations"),
});
export type SetShiftInput = z.input<typeof setShiftSchema>;

export const copyWeekSchema = z.object({ week: dateKey });

export async function listTemplates(executor: DbOrTx = db): Promise<ShiftTemplate[]> {
  const rows = await executor
    .select({ id: shiftTemplates.id, name: shiftTemplates.name, startTime: shiftTemplates.startTime, endTime: shiftTemplates.endTime })
    .from(shiftTemplates)
    .where(eq(shiftTemplates.active, true))
    .orderBy(asc(shiftTemplates.sortOrder), asc(shiftTemplates.startTime));
  return rows.map((r) => ({ ...r, startTime: hhmm(r.startTime), endTime: hhmm(r.endTime) }));
}

export type RosterEntry = {
  id: string;
  date: DateKey;
  userId: string;
  userName: string;
  role: string;
  templateId: string;
  duty: Duty;
};

/** Assignments between two dates (inclusive), with names. */
export async function assignmentsBetween(from: DateKey, to: DateKey, executor: DbOrTx = db): Promise<RosterEntry[]> {
  return executor
    .select({
      id: shiftAssignments.id,
      date: shiftAssignments.date,
      userId: shiftAssignments.userId,
      userName: user.displayName,
      role: user.role,
      templateId: shiftAssignments.templateId,
      duty: shiftAssignments.duty,
    })
    .from(shiftAssignments)
    .innerJoin(user, eq(user.id, shiftAssignments.userId))
    .where(and(gte(shiftAssignments.date, from), lte(shiftAssignments.date, to)))
    .orderBy(asc(shiftAssignments.date), asc(user.displayName));
}

/** Week grid: Monday-start days, templates, staff (active, plus anyone already rostered), entries. */
export async function rosterWeek(anchor: DateKey) {
  const monday = weekStart(anchor);
  const days = weekDays(monday);
  const [templates, entries, staff] = await Promise.all([
    listTemplates(),
    assignmentsBetween(days[0], days[6]),
    db
      .select({ id: user.id, name: user.displayName, role: user.role, active: user.active })
      .from(user)
      .orderBy(asc(user.displayName)),
  ]);
  const rostered = new Set(entries.map((e) => e.userId));
  const people = staff.filter((s) => s.active || rostered.has(s.id));
  return { monday, days, templates, entries, people };
}

/** Who works on a day (the board's roster block): that day's shifts plus last night's overnight shift. */
export async function rosterForDay(date: DateKey) {
  const [templates, entries] = await Promise.all([listTemplates(), assignmentsBetween(addDaysToKey(date, -1), date)]);
  const byId = new Map(templates.map((t) => [t.id, t]));
  const overnight = (id: string) => {
    const t = byId.get(id);
    return t ? t.endTime <= t.startTime : false;
  };
  const today = entries.filter((e) => e.date === date);
  const carried = entries.filter((e) => e.date !== date && overnight(e.templateId));
  return { templates, today, carried };
}

/** People on duty right now (dashboard "On duty now"). */
export async function onDutyNow(now = new Date()) {
  const today = manilaDateKey(now);
  const [templates, entries] = await Promise.all([listTemplates(), assignmentsBetween(addDaysToKey(today, -1), today)]);
  const byId = new Map(templates.map((t) => [t.id, t]));
  return onDutyAt(entries, templates, now).map((e) => ({ ...e, template: byId.get(e.templateId)! }));
}

export const setShift = defineAction({
  permission: "roster.edit",
  input: setShiftSchema,
  handler: async (actor, { date, userId, templateId, duty }) => {
    return db.transaction(async (tx) => {
      const [u] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId));
      if (!u) throw new ActionError(404, "Staff member not found.");
      const [before] = await tx
        .select()
        .from(shiftAssignments)
        .where(and(eq(shiftAssignments.date, date), eq(shiftAssignments.userId, userId)))
        .for("update");
      if (!templateId) {
        if (before) {
          await tx.delete(shiftAssignments).where(eq(shiftAssignments.id, before.id));
          await withAudit(actor, "roster.cleared", "shift_assignment", before.id, before, null, tx);
        }
        return { id: null };
      }
      const [t] = await tx.select({ id: shiftTemplates.id }).from(shiftTemplates).where(eq(shiftTemplates.id, templateId));
      if (!t) throw new ActionError(400, "Shift not found.", { templateId: ["Shift not found"] });
      const [row] = await tx
        .insert(shiftAssignments)
        .values({ date, userId, templateId, duty, createdBy: actor.id })
        .onConflictDoUpdate({
          target: [shiftAssignments.date, shiftAssignments.userId],
          set: { templateId, duty, updatedAt: new Date() },
        })
        .returning();
      await withAudit(actor, before ? "roster.updated" : "roster.assigned", "shift_assignment", row.id, before ?? null, { date, userId, templateId, duty }, tx);
      return { id: row.id };
    });
  },
});

/** Fill this week from the previous one. Cells already set are kept. */
export const copyPreviousWeek = defineAction({
  permission: "roster.edit",
  input: copyWeekSchema,
  handler: async (actor, { week }) => {
    const monday = weekStart(week);
    const prevMonday = addDaysToKey(monday, -7);
    return db.transaction(async (tx) => {
      const [prev, cur] = await Promise.all([
        assignmentsBetween(prevMonday, addDaysToKey(prevMonday, 6), tx),
        assignmentsBetween(monday, addDaysToKey(monday, 6), tx),
      ]);
      // Only people who are still active.
      const ids = [...new Set(prev.map((p) => p.userId))];
      const active = new Set(
        ids.length ? (await tx.select({ id: user.id }).from(user).where(and(inArray(user.id, ids), eq(user.active, true)))).map((u) => u.id) : [],
      );
      const rows = copyWeekPlan(
        prev.filter((p) => active.has(p.userId)),
        cur,
      );
      let added = 0;
      if (rows.length) {
        added = (
          await tx
          .insert(shiftAssignments)
          .values(rows.map((r) => ({ date: r.date, userId: r.userId, templateId: r.templateId, duty: r.duty, createdBy: actor.id })))
          .onConflictDoNothing()
            .returning({ id: shiftAssignments.id })
        ).length;
      }
      await withAudit(actor, "roster.copied_week", "shift_assignment", null, { from: prevMonday }, { to: monday, added }, tx);
      return { added };
    });
  },
});

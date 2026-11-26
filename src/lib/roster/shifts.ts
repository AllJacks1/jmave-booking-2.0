/**
 * Shift roster helpers (bookings-and-movement.md §9). Pure.
 * Shift times are Manila wall-clock; a template whose end is not after its
 * start (9PM–6AM) ends the next day.
 */
import type { Duty } from "@/lib/bookings/constants";
import { addDaysToKey, manilaToUtc, type DateKey } from "@/lib/time";
import { weekdayIndex } from "@/lib/calendar/layout";

export type ShiftTemplate = { id: string; name: string; startTime: string; endTime: string };
export type ShiftAssignment = { date: DateKey; userId: string; templateId: string; duty: Duty };

/** `HH:mm:ss` or `HH:mm` → `HH:mm`. */
export function hhmm(t: string): string {
  return t.slice(0, 5);
}

export function crossesMidnight(t: Pick<ShiftTemplate, "startTime" | "endTime">): boolean {
  return hhmm(t.endTime) <= hhmm(t.startTime);
}

/** UTC [start, end) of a shift on a Manila date. */
export function shiftWindow(date: DateKey, t: Pick<ShiftTemplate, "startTime" | "endTime">): { start: Date; end: Date } {
  const start = manilaToUtc(date, hhmm(t.startTime));
  const end = manilaToUtc(crossesMidnight(t) ? addDaysToKey(date, 1) : date, hhmm(t.endTime));
  return { start, end };
}

/** Monday of the week containing `date`. */
export function weekStart(date: DateKey): DateKey {
  return addDaysToKey(date, -weekdayIndex(date));
}

export function weekDays(monday: DateKey): DateKey[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(monday, i));
}

/** Assignments whose shift is running at `now` (today's, plus last night's overnight shift). */
export function onDutyAt<A extends ShiftAssignment>(assignments: readonly A[], templates: readonly ShiftTemplate[], now: Date): A[] {
  const byId = new Map(templates.map((t) => [t.id, t]));
  return assignments.filter((a) => {
    const t = byId.get(a.templateId);
    if (!t) return false;
    const w = shiftWindow(a.date, t);
    return now >= w.start && now < w.end;
  });
}

/**
 * Copy the previous week into this one: each assignment moves 7 days on,
 * skipping a person who already has a shift that day. Returns rows to insert.
 */
export function copyWeekPlan(previous: readonly ShiftAssignment[], current: readonly ShiftAssignment[]): ShiftAssignment[] {
  const taken = new Set(current.map((a) => `${a.date}|${a.userId}`));
  const out: ShiftAssignment[] = [];
  for (const a of previous) {
    const date = addDaysToKey(a.date, 7);
    const key = `${date}|${a.userId}`;
    if (taken.has(key)) continue;
    taken.add(key);
    out.push({ ...a, date });
  }
  return out;
}

/** "8AM–5PM" style label from times when a template has no name. */
export function shiftLabel(t: Pick<ShiftTemplate, "name" | "startTime" | "endTime">): string {
  return t.name || `${hhmm(t.startTime)}–${hhmm(t.endTime)}`;
}

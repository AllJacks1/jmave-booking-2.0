/**
 * Rental schedule from dates (Phase 1c quotation forms). Pure.
 *
 * Self-Drive: release → return gives days, hours tier and an extra 8h/12h
 * block, plus the OT premium slot (PLAN Q10). Staff can override all of it.
 * With Driver: the first day's window gives contract hours (pricing.md §3.1).
 */
import { addDaysToKey, manilaParts, manilaToUtc, type DateKey } from "@/lib/time";
import type { OtSlot } from "./inputs";
import { PricingInputError } from "./types";

const MINUTE_MS = 60_000;
const DAY_MIN = 24 * 60;

export type SelfDriveSchedule = {
  minutes: number;
  days: number;
  hoursTier: 8 | 12 | 24;
  additionalHoursBlock: 8 | 12 | null;
};

/**
 * Up to 24 h: one day on the smallest tier (8, 12, 24) that covers it.
 * Longer: whole 24 h days; a remainder up to 8 h or 12 h becomes that block,
 * a longer remainder one more day.
 */
export function selfDriveSchedule(start: Date, end: Date): SelfDriveSchedule {
  const minutes = Math.round((end.getTime() - start.getTime()) / MINUTE_MS);
  if (minutes <= 0) throw new PricingInputError("Return must be after release.");
  if (minutes <= DAY_MIN) {
    const hoursTier = minutes <= 8 * 60 ? 8 : minutes <= 12 * 60 ? 12 : 24;
    return { minutes, days: 1, hoursTier, additionalHoursBlock: null };
  }
  let days = Math.floor(minutes / DAY_MIN);
  const rest = minutes - days * DAY_MIN;
  let additionalHoursBlock: 8 | 12 | null = null;
  if (rest > 12 * 60) days += 1;
  else if (rest > 8 * 60) additionalHoursBlock = 12;
  else if (rest > 0) additionalHoursBlock = 8;
  return { minutes, days, hoursTier: 24, additionalHoursBlock };
}

/** Manila minute of day → OT slot: 19:01–01:00 evening, 01:01–06:00 overnight. */
export function otSlotAt(d: Date): OtSlot {
  const p = manilaParts(d);
  const m = p.hour * 60 + p.minute;
  if (m >= 19 * 60 + 1 || m <= 60) return "evening";
  if (m >= 61 && m <= 6 * 60) return "overnight";
  return "none";
}

/** OT premium is charged once: the release slot, else the return slot (PLAN Q10). */
export function otSlotFor(start: Date, end: Date): OtSlot {
  const release = otSlotAt(start);
  return release !== "none" ? release : otSlotAt(end);
}

export type WithDriverWindow = {
  /** First day's contract window. */
  startAt: Date;
  firstDayEndAt: Date;
  contractMinutes: number;
  /** End of the last day's window (start + days − 1 days + window). */
  endAt: Date;
};

/**
 * With Driver first-day window: the end time is on the start date, or the
 * next day when it is not after the start time (e.g. 21:00 → 06:00).
 */
export function withDriverWindow(startDate: DateKey, startTime: string, endTime: string, days: number): WithDriverWindow {
  const startAt = manilaToUtc(startDate, startTime);
  const endDate = endTime > startTime ? startDate : addDaysToKey(startDate, 1);
  const firstDayEndAt = manilaToUtc(endDate, endTime);
  const contractMinutes = Math.round((firstDayEndAt.getTime() - startAt.getTime()) / MINUTE_MS);
  const extraDays = Math.max(0, Math.floor(days) - 1);
  const endAt = new Date(firstDayEndAt.getTime() + extraDays * DAY_MIN * MINUTE_MS);
  return { startAt, firstDayEndAt, contractMinutes, endAt };
}

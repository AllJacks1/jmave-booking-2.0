/**
 * Fleet calendar layout (bookings-and-movement.md §4). Pure.
 * Days are Asia/Manila calendar days; bars are positioned as percentages of
 * the visible range so the grid needs no per-cell elements for bars.
 */
import { addDaysToKey, isDateKey, manilaToUtc, type DateKey } from "@/lib/time";

export const CALENDAR_VIEWS = ["week", "month"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

function parts(key: DateKey) {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(key: DateKey): number {
  const { y, m, d } = parts(key);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function daysInMonth(key: DateKey): number {
  const { y, m } = parts(key);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Visible days: Monday-start week, or the whole month. */
export function calendarDays(view: CalendarView, anchor: DateKey): DateKey[] {
  if (view === "week") {
    const monday = addDaysToKey(anchor, -weekdayIndex(anchor));
    return Array.from({ length: 7 }, (_, i) => addDaysToKey(monday, i));
  }
  const first = `${anchor.slice(0, 7)}-01`;
  return Array.from({ length: daysInMonth(anchor) }, (_, i) => addDaysToKey(first, i));
}

/** UTC instants bounding the visible days: [first 00:00, day after last 00:00). */
export function calendarBounds(days: DateKey[]): { from: Date; to: Date } {
  return { from: manilaToUtc(days[0], "00:00"), to: manilaToUtc(addDaysToKey(days[days.length - 1], 1), "00:00") };
}

/** Anchor of the previous / next page. */
export function shiftAnchor(view: CalendarView, anchor: DateKey, dir: -1 | 1): DateKey {
  if (view === "week") return addDaysToKey(anchor, 7 * dir);
  const { y, m } = parts(anchor);
  const month = m - 1 + dir;
  const ny = y + Math.floor(month / 12);
  const nm = ((month % 12) + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, "0")}-01`;
}

export function parseAnchor(v: string | undefined, today: DateKey): DateKey {
  return v && isDateKey(v) ? v : today;
}

export type BarInput = { start: Date; end: Date };
export type PlacedBar<T extends BarInput> = T & {
  leftPct: number;
  widthPct: number;
  lane: number;
  /** The bar continues before / after the visible range. */
  clippedStart: boolean;
  clippedEnd: boolean;
};

/**
 * Position bars in one vehicle row. Overlapping bars (e.g. a pending
 * reservation over a confirmed booking) go to separate lanes.
 */
export function placeBars<T extends BarInput>(items: readonly T[], from: Date, to: Date): { bars: PlacedBar<T>[]; lanes: number } {
  const span = to.getTime() - from.getTime();
  const visible = items
    .filter((i) => i.end > from && i.start < to && i.end > i.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
  const laneEnds: number[] = [];
  const bars = visible.map((item) => {
    const s = Math.max(item.start.getTime(), from.getTime());
    const e = Math.min(item.end.getTime(), to.getTime());
    let lane = laneEnds.findIndex((end) => end <= item.start.getTime());
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end.getTime());
    } else {
      laneEnds[lane] = item.end.getTime();
    }
    return {
      ...item,
      leftPct: ((s - from.getTime()) / span) * 100,
      widthPct: ((e - s) / span) * 100,
      lane,
      clippedStart: item.start < from,
      clippedEnd: item.end > to,
    };
  });
  return { bars, lanes: Math.max(1, laneEnds.length) };
}

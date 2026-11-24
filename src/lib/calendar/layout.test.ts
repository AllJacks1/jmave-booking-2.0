import { describe, expect, it } from "vitest";
import { manilaToUtc } from "@/lib/time";
import { calendarBounds, calendarDays, placeBars, shiftAnchor, weekdayIndex } from "./layout";

describe("calendar layout", () => {
  it("week starts Monday; month has every day", () => {
    expect(weekdayIndex("2026-11-23")).toBe(0); // Monday
    expect(calendarDays("week", "2026-11-26")).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(calendarDays("month", "2026-02-10")).toHaveLength(28);
    expect(calendarDays("month", "2028-02-10")).toHaveLength(29);
    expect(calendarDays("month", "2026-12-31")[0]).toBe("2026-12-01");
  });

  it("bounds are Manila midnights", () => {
    const { from, to } = calendarBounds(calendarDays("week", "2026-11-26"));
    expect(from.toISOString()).toBe("2026-11-22T16:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-29T16:00:00.000Z");
  });

  it("shifts by week and month across years", () => {
    expect(shiftAnchor("week", "2026-12-28", 1)).toBe("2027-01-04");
    expect(shiftAnchor("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftAnchor("month", "2026-01-15", -1)).toBe("2025-12-01");
  });

  it("places bars by percentage and clips at the edges", () => {
    const days = calendarDays("week", "2026-11-23");
    const { from, to } = calendarBounds(days);
    const { bars, lanes } = placeBars(
      [
        { id: "a", start: manilaToUtc("2026-11-23", "12:00"), end: manilaToUtc("2026-11-24", "12:00") },
        { id: "b", start: manilaToUtc("2026-11-20", "08:00"), end: manilaToUtc("2026-11-23", "06:00") },
        { id: "c", start: manilaToUtc("2026-12-20", "08:00"), end: manilaToUtc("2026-12-21", "08:00") },
      ],
      from,
      to,
    );
    expect(lanes).toBe(1);
    expect(bars.map((b) => b.id)).toEqual(["b", "a"]);
    const a = bars.find((b) => b.id === "a")!;
    expect(a.leftPct).toBeCloseTo((0.5 / 7) * 100);
    expect(a.widthPct).toBeCloseTo((1 / 7) * 100);
    const b = bars.find((x) => x.id === "b")!;
    expect(b).toMatchObject({ leftPct: 0, clippedStart: true, clippedEnd: false });
  });

  it("overlapping bars go to separate lanes; touching ones share", () => {
    const { from, to } = calendarBounds(calendarDays("week", "2026-11-23"));
    const { bars, lanes } = placeBars(
      [
        { id: "x", start: manilaToUtc("2026-11-23", "08:00"), end: manilaToUtc("2026-11-25", "08:00") },
        { id: "pending", start: manilaToUtc("2026-11-24", "08:00"), end: manilaToUtc("2026-11-26", "08:00") },
        { id: "next", start: manilaToUtc("2026-11-25", "08:00"), end: manilaToUtc("2026-11-26", "08:00") },
      ],
      from,
      to,
    );
    expect(lanes).toBe(2);
    expect(Object.fromEntries(bars.map((b) => [b.id, b.lane]))).toEqual({ x: 0, pending: 1, next: 0 });
  });

  it("20 vehicles × a month of bars lays out quickly", () => {
    const days = calendarDays("month", "2026-12-01");
    const { from, to } = calendarBounds(days);
    const t0 = performance.now();
    for (let v = 0; v < 20; v++) {
      const items = days.map((d, i) => ({ id: `${v}-${i}`, start: manilaToUtc(d, "08:00"), end: manilaToUtc(d, "20:00") }));
      expect(placeBars(items, from, to).bars).toHaveLength(31);
    }
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

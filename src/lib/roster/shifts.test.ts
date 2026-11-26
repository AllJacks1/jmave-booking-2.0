import { describe, expect, it } from "vitest";
import { manilaToUtc } from "@/lib/time";
import { copyWeekPlan, crossesMidnight, onDutyAt, shiftWindow, weekDays, weekStart, type ShiftAssignment, type ShiftTemplate } from "./shifts";

const day: ShiftTemplate = { id: "t2", name: "8AM–5PM", startTime: "08:00:00", endTime: "17:00:00" };
const night: ShiftTemplate = { id: "t5", name: "9PM–6AM", startTime: "21:00:00", endTime: "06:00:00" };

describe("roster", () => {
  it("shift windows in Manila time; 9PM–6AM ends the next morning", () => {
    expect(crossesMidnight(night)).toBe(true);
    expect(crossesMidnight(day)).toBe(false);
    expect(shiftWindow("2026-12-10", day)).toEqual({ start: manilaToUtc("2026-12-10", "08:00"), end: manilaToUtc("2026-12-10", "17:00") });
    expect(shiftWindow("2026-12-10", night)).toEqual({ start: manilaToUtc("2026-12-10", "21:00"), end: manilaToUtc("2026-12-11", "06:00") });
  });

  it("weeks start on Monday", () => {
    expect(weekStart("2026-12-13")).toBe("2026-12-07"); // Sunday → Monday before
    expect(weekStart("2026-12-14")).toBe("2026-12-14");
    expect(weekDays("2026-12-14")).toHaveLength(7);
    expect(weekDays("2026-12-14")[6]).toBe("2026-12-20");
  });

  it("on duty now includes last night's overnight shift", () => {
    const rows: ShiftAssignment[] = [
      { date: "2026-12-09", userId: "u1", templateId: "t5", duty: "operations" },
      { date: "2026-12-10", userId: "u2", templateId: "t2", duty: "sales" },
      { date: "2026-12-10", userId: "u3", templateId: "t5", duty: "operations" },
    ];
    const at = (t: string) => onDutyAt(rows, [day, night], manilaToUtc("2026-12-10", t)).map((r) => r.userId);
    expect(at("05:59")).toEqual(["u1"]);
    expect(at("06:00")).toEqual([]);
    expect(at("08:00")).toEqual(["u2"]);
    expect(at("17:00")).toEqual([]);
    expect(at("23:00")).toEqual(["u3"]);
  });

  it("copy previous week moves dates 7 days on and keeps existing cells", () => {
    const prev: ShiftAssignment[] = [
      { date: "2026-12-07", userId: "u1", templateId: "t2", duty: "sales" },
      { date: "2026-12-08", userId: "u1", templateId: "t5", duty: "operations" },
    ];
    const cur: ShiftAssignment[] = [{ date: "2026-12-15", userId: "u1", templateId: "t2", duty: "sales" }];
    expect(copyWeekPlan(prev, cur)).toEqual([{ date: "2026-12-14", userId: "u1", templateId: "t2", duty: "sales" }]);
  });
});

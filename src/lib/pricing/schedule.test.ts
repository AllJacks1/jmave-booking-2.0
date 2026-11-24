import { describe, expect, it } from "vitest";
import { manilaToUtc } from "@/lib/time";
import { otSlotAt, otSlotFor, selfDriveSchedule, withDriverWindow } from "./schedule";
import { PricingInputError } from "./types";

const at = (d: string, t: string) => manilaToUtc(d, t);

describe("selfDriveSchedule", () => {
  it.each([
    ["08:00", "2026-11-22", "16:00", { days: 1, hoursTier: 8, additionalHoursBlock: null }],
    ["08:00", "2026-11-22", "16:01", { days: 1, hoursTier: 12, additionalHoursBlock: null }],
    ["08:00", "2026-11-22", "20:00", { days: 1, hoursTier: 12, additionalHoursBlock: null }],
    ["08:00", "2026-11-22", "20:01", { days: 1, hoursTier: 24, additionalHoursBlock: null }],
    ["11:30", "2026-11-23", "11:30", { days: 1, hoursTier: 24, additionalHoursBlock: null }], // SD-2
    ["11:30", "2026-11-23", "11:31", { days: 1, hoursTier: 24, additionalHoursBlock: 8 }],
    ["11:30", "2026-11-23", "19:30", { days: 1, hoursTier: 24, additionalHoursBlock: 8 }],
    ["11:30", "2026-11-23", "19:31", { days: 1, hoursTier: 24, additionalHoursBlock: 12 }],
    ["11:30", "2026-11-23", "23:30", { days: 1, hoursTier: 24, additionalHoursBlock: 12 }],
    ["11:30", "2026-11-23", "23:31", { days: 2, hoursTier: 24, additionalHoursBlock: null }],
    ["09:00", "2026-11-29", "09:00", { days: 7, hoursTier: 24, additionalHoursBlock: null }],
  ] as const)("Nov 22 %s → %s %s", (startTime, endDate, endTime, expected) => {
    expect(selfDriveSchedule(at("2026-11-22", startTime), at(endDate, endTime))).toMatchObject(expected);
  });

  it("rejects a return before release", () => {
    expect(() => selfDriveSchedule(at("2026-11-22", "10:00"), at("2026-11-22", "10:00"))).toThrow(PricingInputError);
  });
});

describe("OT slot (PLAN Q10)", () => {
  it.each([
    ["19:00", "none"],
    ["19:01", "evening"],
    ["23:59", "evening"],
    ["00:00", "evening"],
    ["01:00", "evening"],
    ["01:01", "overnight"],
    ["06:00", "overnight"],
    ["06:01", "none"],
    ["11:30", "none"],
  ] as const)("%s → %s", (time, slot) => {
    expect(otSlotAt(at("2026-11-22", time))).toBe(slot);
  });

  it("release slot wins, else return slot", () => {
    expect(otSlotFor(at("2026-11-22", "20:00"), at("2026-11-23", "02:00"))).toBe("evening");
    expect(otSlotFor(at("2026-11-22", "10:00"), at("2026-11-23", "02:00"))).toBe("overnight");
    expect(otSlotFor(at("2026-11-22", "10:00"), at("2026-11-23", "10:00"))).toBe("none");
  });
});

describe("withDriverWindow", () => {
  it("same-day window (WD-1: 08:30–18:30 = 10 h)", () => {
    const w = withDriverWindow("2026-11-22", "08:30", "18:30", 1);
    expect(w.contractMinutes).toBe(600);
    expect(w.endAt.toISOString()).toBe("2026-11-22T10:30:00.000Z");
  });

  it("crosses midnight and spans days", () => {
    const w = withDriverWindow("2026-11-22", "21:00", "06:00", 3);
    expect(w.contractMinutes).toBe(540);
    expect(w.firstDayEndAt.toISOString()).toBe("2026-11-22T22:00:00.000Z");
    expect(w.endAt.toISOString()).toBe("2026-11-24T22:00:00.000Z");
  });

  it("equal times = 24 h", () => {
    expect(withDriverWindow("2026-11-22", "08:00", "08:00", 1).contractMinutes).toBe(1440);
  });
});

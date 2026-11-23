import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  excelDateToDateKey,
  excelFractionToTime,
  excelSerialToDateKey,
  excelSerialToUtc,
  formatManilaDate,
  formatManilaDateTime,
  isDateKey,
  manilaDateKey,
  manilaTime,
  manilaToUtc,
  manilaYear,
  startOfManilaDay,
} from "./time";

describe("time (Asia/Manila)", () => {
  it("manilaToUtc applies +08:00", () => {
    expect(manilaToUtc("2026-11-23", "08:30").toISOString()).toBe("2026-11-23T00:30:00.000Z");
    expect(manilaToUtc("2026-11-23").toISOString()).toBe("2026-11-22T16:00:00.000Z");
  });

  it("date key and time of a UTC instant", () => {
    const d = new Date("2026-12-31T16:30:00Z"); // Jan 1 00:30 Manila
    expect(manilaDateKey(d)).toBe("2027-01-01");
    expect(manilaTime(d)).toBe("00:30");
    expect(manilaYear(d)).toBe(2027);
    expect(startOfManilaDay(d).toISOString()).toBe("2026-12-31T16:00:00.000Z");
  });

  it("validates date keys", () => {
    expect(isDateKey("2026-02-28")).toBe(true);
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("26-1-1")).toBe(false);
    expect(() => manilaToUtc("2026-13-01")).toThrow();
    expect(() => manilaToUtc("2026-01-01", "24:00")).toThrow();
  });

  it("adds days across month and year ends", () => {
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("Excel serials", () => {
    expect(excelSerialToDateKey(46349)).toBe("2026-11-23");
    expect(excelSerialToDateKey(1)).toBe("1899-12-31");
    expect(excelSerialToDateKey(0)).toBeNull();
    expect(excelSerialToDateKey(Number.NaN)).toBeNull();
    expect(excelFractionToTime(0.3541666667)).toBe("08:30");
    expect(excelFractionToTime(0.7708333333)).toBe("18:30");
    expect(excelFractionToTime(0.99999)).toBe("00:00");
    expect(excelSerialToUtc(46349.3541666667)?.toISOString()).toBe("2026-11-23T00:30:00.000Z");
  });

  it("exceljs dates read as wall-clock", () => {
    expect(excelDateToDateKey(new Date(Date.UTC(2026, 10, 23)))).toBe("2026-11-23");
    expect(excelDateToDateKey(new Date(Number.NaN))).toBeNull();
  });

  it("formats in Manila regardless of server zone", () => {
    expect(formatManilaDate("2026-11-23")).toBe("Nov 23, 2026");
    expect(formatManilaDateTime(new Date("2026-11-23T00:30:00Z"))).toMatch(/Nov 23, 2026,? 8:30\s?AM/);
  });
});

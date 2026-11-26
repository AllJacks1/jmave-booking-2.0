import { describe, expect, it } from "vitest";
import { normaliseCardNo, rentalStartFromCell, tierFromCell } from "./loyalty";

describe("Loyalty Log cells (import-map.md Phase 3)", () => {
  it("reads the first day of rental-date text", () => {
    expect(rentalStartFromCell("Aug 1-2, 2025")).toBe("2025-08-01");
    expect(rentalStartFromCell("Sep 13 - 15, 2025")).toBe("2025-09-13");
    expect(rentalStartFromCell("Aug 30 - Sep 2, 2025")).toBe("2025-08-30");
    expect(rentalStartFromCell("Dec 30 - Jan 2, 2026")).toBe("2025-12-30");
    expect(rentalStartFromCell("Dec 30, 2025 - Jan 2, 2026")).toBe("2025-12-30");
    expect(rentalStartFromCell("Sept 5-6, 2025")).toBe("2025-09-05");
    expect(rentalStartFromCell(new Date(Date.UTC(2025, 7, 17)))).toBe("2025-08-17");
    expect(rentalStartFromCell("sometime")).toBeNull();
    expect(rentalStartFromCell("Feb 30-31, 2025")).toBeNull();
    expect(rentalStartFromCell(null)).toBeNull();
  });

  it("normalises card numbers", () => {
    expect(normaliseCardNo("JMV-0001")).toBe("JMV-0001");
    expect(normaliseCardNo(" jmv 24 ")).toBe("JMV-0024");
    expect(normaliseCardNo("JMV00012")).toBe("JMV-0012");
    expect(normaliseCardNo("JMV-12345")).toBe("JMV-12345");
    expect(normaliseCardNo("VRA2025318")).toBeNull();
    expect(normaliseCardNo(null)).toBeNull();
  });

  it("reads the tier from a number or a sentence", () => {
    expect(tierFromCell(2)).toBe(2);
    expect(tierFromCell("1")).toBe(1);
    expect(tierFromCell("Congratulations! You are now an official Tier 1 Client!")).toBe(1);
    expect(tierFromCell("You are now a Tier 2 Client — Thank you for your loyalty.")).toBe(2);
    expect(tierFromCell("Gold")).toBeNull();
    expect(tierFromCell(null)).toBeNull();
  });
});

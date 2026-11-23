import { describe, expect, it } from "vitest";
import { formatPhPhone, normalisePhPhone } from "./phone";

describe("normalisePhPhone", () => {
  it.each([
    ["0917 123 4567", "+639171234567"],
    ["09171234567", "+639171234567"],
    ["9171234567", "+639171234567"],
    ["+63 917 123 4567", "+639171234567"],
    ["639171234567", "+639171234567"],
    ["(082) 123-4567", "+63821234567"],
    ["(02) 8123-4567", "+63281234567"],
  ])("%s → %s", (input, expected) => {
    expect(normalisePhPhone(input)).toBe(expected);
  });

  it.each(["", "abc", "12345", "+1 415 555 0100", "0917123456"])(
    "rejects %j",
    (input) => {
      expect(normalisePhPhone(input)).toBeNull();
    },
  );
});

describe("formatPhPhone", () => {
  it.each([
    ["+639171234567", "0917 123 4567"],
    ["+63821234567", "(082) 123-4567"],
    ["+63281234567", "(02) 8123-4567"],
  ])("%s → %s", (input, expected) => {
    expect(formatPhPhone(input)).toBe(expected);
  });
});

import { describe, expect, it } from "vitest";
import { centavosToInput, formatPeso, parsePesoToCentavos } from "./money";

describe("money", () => {
  it.each([
    [158000, "₱1,580.00"],
    [9400, "₱94.00"],
    [5, "₱0.05"],
    [-2500, "-₱25.00"],
  ])("formatPeso(%i) = %s", (c, s) => expect(formatPeso(c)).toBe(s));

  it.each([
    ["1,580.00", 158000],
    ["1580.5", 158050],
    ["₱94", 9400],
    ["0.05", 5],
    [94.5, 9450],
  ] as const)("parsePesoToCentavos(%j) = %i", (s, c) =>
    expect(parsePesoToCentavos(s)).toBe(c),
  );

  it.each(["", "abc", "1.234", "1..2"])("rejects %j", (s) =>
    expect(parsePesoToCentavos(s)).toBeNull(),
  );

  it("centavosToInput", () => expect(centavosToInput(158050)).toBe("1580.50"));
});

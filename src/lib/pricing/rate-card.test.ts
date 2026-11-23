import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_RATE_CARD_V1 } from "./expected-v1";
import { diffRateCards, flattenRateCard, rateCardDataSchema } from "./rate-card";

describe("RateCardData", () => {
  it("expected v1 card validates", () => {
    expect(rateCardDataSchema.safeParse(EXPECTED_RATE_CARD_V1).success).toBe(true);
  });

  it("rejects a missing rate row and fractional centavos", () => {
    const bad = structuredClone(EXPECTED_RATE_CARD_V1) as Record<string, unknown>;
    const sd = bad.selfDrive as { daily: Record<string, unknown> };
    delete sd.daily.van;
    expect(rateCardDataSchema.safeParse(bad).success).toBe(false);

    const frac = structuredClone(EXPECTED_RATE_CARD_V1);
    frac.vehicleClasses.compact.carwash = 100.5;
    expect(rateCardDataSchema.safeParse(frac).success).toBe(false);
  });

  it("rejects driver bands that do not go up", () => {
    const bad = structuredClone(EXPECTED_RATE_CARD_V1);
    bad.withDriver.driverFee.bandMaxKm[3] = 10;
    expect(rateCardDataSchema.safeParse(bad).success).toBe(false);
  });

  it("diff lists changed leaves only", () => {
    const b = structuredClone(EXPECTED_RATE_CARD_V1);
    b.selfDrive.daily.compact.h24 = 160000;
    b.withDriver.driverFee.h8[0] = 65000;
    expect(diffRateCards(EXPECTED_RATE_CARD_V1, b)).toEqual([
      { path: "selfDrive.daily.compact.h24", before: 158000, after: 160000 },
      { path: "withDriver.driverFee.h8[0]", before: 60000, after: 65000 },
    ]);
    expect(diffRateCards(EXPECTED_RATE_CARD_V1, structuredClone(EXPECTED_RATE_CARD_V1))).toEqual([]);
  });

  it("flatten gives stable paths", () => {
    const flat = flattenRateCard(EXPECTED_RATE_CARD_V1);
    expect(flat.get("vehicleClasses.van.kmPerLiter")).toBe(7);
    expect(flat.get("withDriver.longTerm.wagon.within_davao_city.d30")).toBe(220000);
  });
});

describe("engine purity", () => {
  it("no file in src/lib/pricing imports the database", () => {
    const dir = import.meta.dirname;
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/from\s+["'](@\/db|drizzle-orm|postgres|server-only)/);
    }
  });
});

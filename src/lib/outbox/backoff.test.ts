import { describe, expect, it } from "vitest";
import { afterAttempt, backoffMs, errorText, OUTBOX_MAX_ATTEMPTS } from "./backoff";

describe("outbox backoff (PLAN §6.6)", () => {
  it("doubles from 30 s", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000]);
  });

  it("fails for good after the 8th attempt", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    expect(OUTBOX_MAX_ATTEMPTS).toBe(8);
    expect(afterAttempt(7, false, now)).toEqual({ status: "pending", nextAttemptAt: new Date(now.getTime() + 1_920_000) });
    expect(afterAttempt(8, false, now)).toEqual({ status: "failed" });
    expect(afterAttempt(8, true, now)).toEqual({ status: "sent" });
  });

  it("redacts tokens and keys from errors", () => {
    expect(errorText(new Error("GET https://x.test/a?token=abc123&b=1 failed"))).toBe("GET https://x.test/a?token=[redacted]&b=1 failed");
    expect(errorText("Authorization: Bearer re_secret\nnext")).toBe("Authorization: Bearer [redacted] next");
    expect(errorText("x".repeat(2000))).toHaveLength(1000);
  });
});

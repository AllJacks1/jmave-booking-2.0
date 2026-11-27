import { describe, expect, it } from "vitest";
import { redactedUrl, redactToken, reworkConfigStatus, reworkRequestUrl } from "./endpoint";

const TOKEN = "tok_InventedSecret+/=123";
const ENV = { REWORK_WEBHOOK_URL: "https://webhooks.rework.test/leads/source/leadgen", REWORK_WEBHOOK_TOKEN: TOKEN };

describe("Rework endpoint (rework.md §1)", () => {
  it("reports set / not set without values", () => {
    expect(reworkConfigStatus({})).toEqual({ urlSet: false, tokenSet: false, ready: false, redactedUrl: null });
    expect(reworkConfigStatus(ENV)).toEqual({ urlSet: true, tokenSet: true, ready: true, redactedUrl: "https://webhooks.rework.test/leads/source/leadgen?token=***" });
    expect(reworkConfigStatus({ REWORK_WEBHOOK_URL: "not a url", REWORK_WEBHOOK_TOKEN: "x" }).urlSet).toBe(false);
  });

  it("builds the request URL with the token as a parameter", () => {
    const u = reworkRequestUrl(ENV);
    expect(u.searchParams.get("token")).toBe(TOKEN);
    expect(redactedUrl(u.toString())).toBe("https://webhooks.rework.test/leads/source/leadgen?token=***");
    expect(() => reworkRequestUrl({ REWORK_WEBHOOK_URL: ENV.REWORK_WEBHOOK_URL })).toThrow("REWORK_WEBHOOK_TOKEN is not set.");
  });

  it("redacts the raw, URL-encoded and query-parameter forms", () => {
    const u = reworkRequestUrl(ENV).toString();
    const text = `POST ${u} failed; token=${TOKEN}; raw ${TOKEN}; enc ${encodeURIComponent(TOKEN)}`;
    const out = redactToken(text, TOKEN);
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(encodeURIComponent(TOKEN));
    expect(out).toContain("?token=***");
    // Without knowing the token, any token= parameter is still hidden.
    expect(redactToken("https://x.test/a?b=1&token=abc", undefined)).toBe("https://x.test/a?b=1&token=***");
  });
});


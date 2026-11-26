import { describe, expect, it } from "vitest";
import { addYearsToKey } from "@/lib/time";
import { escapeHtml } from "./quotation-email";

describe("quotation email", () => {
  it("escapes HTML in names and messages", () => {
    expect(escapeHtml(`<b>"Ana" & 'Ben'</b>`)).toBe("&lt;b&gt;&quot;Ana&quot; &amp; &#39;Ben&#39;&lt;/b&gt;");
  });
});

describe("addYearsToKey (card expiry)", () => {
  it("keeps the day; 29 Feb becomes 28 Feb", () => {
    expect(addYearsToKey("2026-11-13", 1)).toBe("2027-11-13");
    expect(addYearsToKey("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYearsToKey("2027-02-28", 1)).toBe("2028-02-28");
  });
});

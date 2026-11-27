import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { SONNER_STYLE_HASH } from "./headers";

/** The CSP allows Sonner's injected stylesheet by hash; keep the hash in step with the installed Sonner. */
describe("Sonner stylesheet CSP hash", () => {
  it("matches the CSS the installed Sonner injects", () => {
    const file = createRequire(import.meta.url).resolve("sonner").replace(/index\.js$/, "index.mjs");
    const src = readFileSync(file, "utf8");
    const call = src.indexOf("__insertCSS(", src.indexOf("function __insertCSS") + 20);
    const start = call + "__insertCSS(".length;
    const quote = src[start];
    let end = start + 1;
    while (!(src[end] === quote && src[end - 1] !== "\\")) end++;
    const css = new Function(`return ${src.slice(start, end + 1)}`)() as string;
    expect(`sha256-${createHash("sha256").update(css, "utf8").digest("base64")}`).toBe(SONNER_STYLE_HASH);
  });
});

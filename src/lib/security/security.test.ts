/**
 * Phase 5 security checks that need no database: headers/CSP, CSRF origin
 * check, share tokens, request ids, log scrubbing, upload zip checks, and
 * static scans of server actions, route handlers and log calls.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkWorkbookZip, readZipDirectory } from "@/lib/import/zip-check";
import { formatLine } from "@/lib/log";
import { requestIdFrom } from "@/lib/observability/request-id";
import { scrubEvent, scrubString, scrubValue } from "@/lib/observability/scrub";
import { newShareToken, SHARE_TOKEN_PATTERN } from "@/lib/quotes/share-token";
import { bookingWorkbook } from "../../../tests/fixtures/workbooks";
import { contentSecurityPolicy, hstsHeader, makeNonce, referrerPolicyFor } from "./headers";
import { clientIp, deriveClientIp, ipFromForwardedFor } from "./client-ip";
import { isSameOriginRequest } from "./origin";

const SRC = path.resolve(import.meta.dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");

describe("CSP and security headers", () => {
  const env = { PUBLIC_EMBED_ORIGINS: "https://www.jmave.test" };
  it("uses a nonce with strict-dynamic and no unsafe-inline scripts in production", () => {
    const csp = contentSecurityPolicy({ pathname: "/dashboard", nonce: "abc123", env, dev: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
    expect(csp).toMatch(/style-src 'self' 'nonce-abc123' 'sha256-[^']+' 'sha256-47DEQpj8HBSa\+\/TImW\+5JCeuQeRkm5NMpJWZG3hSuFU='(;|$)/);
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toMatch(/frame-ancestors 'self'$/);
    expect(csp).toContain("frame-src 'self' https://challenges.cloudflare.com");
  });
  it("lets /book be framed by the embed origins only", () => {
    expect(contentSecurityPolicy({ pathname: "/book", nonce: "n", env, dev: false })).toMatch(/frame-ancestors 'self' https:\/\/www\.jmave\.test$/);
  });
  it("adds unsafe-eval only in development", () => {
    expect(contentSecurityPolicy({ pathname: "/", nonce: "n", env, dev: true })).toContain("'unsafe-eval'");
  });
  it("HSTS only over HTTPS; share links send no referrer", () => {
    expect(hstsHeader("https", "http://internal/")).toContain("max-age=31536000");
    expect(hstsHeader(null, "http://localhost:3000/")).toBeNull();
    expect(referrerPolicyFor("/q/abc")).toBe("no-referrer");
    expect(referrerPolicyFor("/quotes")).toBe("strict-origin-when-cross-origin");
  });
  it("nonces are random", () => {
    expect(new Set(Array.from({ length: 200 }, makeNonce)).size).toBe(200);
  });
});

describe("CSRF origin check for route handlers", () => {
  const url = "https://app.jmave.test/api/import";
  const h = (o: Record<string, string>) => new Headers(o);
  it("accepts same-origin and the APP_URL origin", () => {
    expect(isSameOriginRequest(h({ origin: "https://app.jmave.test" }), url, undefined)).toBe(true);
    expect(
      isSameOriginRequest(h({ origin: "https://app.jmave.test", "sec-fetch-site": "same-origin" }), "http://10.0.0.1:8080/api/import", "https://app.jmave.test"),
    ).toBe(true);
    expect(isSameOriginRequest(h({ origin: "https://app.jmave.test", host: "app.jmave.test", "x-forwarded-proto": "https" }), "http://10.0.0.1:8080/x", undefined)).toBe(true);
  });
  it("refuses other origins, null origin and cross-site fetches", () => {
    expect(isSameOriginRequest(h({ origin: "https://evil.test" }), url, "https://app.jmave.test")).toBe(false);
    expect(isSameOriginRequest(h({ origin: "null" }), url, undefined)).toBe(false);
    expect(isSameOriginRequest(h({ "sec-fetch-site": "cross-site" }), url, undefined)).toBe(false);
    expect(isSameOriginRequest(h({ "sec-fetch-site": "same-site", origin: "https://book.jmave.test" }), url, undefined)).toBe(false);
  });
  it("allows non-browser clients (no Origin, no Sec-Fetch-Site; no victim cookies)", () => {
    expect(isSameOriginRequest(h({}), url, undefined)).toBe(true);
  });
});

describe("share tokens", () => {
  it("are 32 random bytes, base64url, unique", () => {
    const tokens = Array.from({ length: 2000 }, newShareToken);
    for (const t of tokens) expect(t).toMatch(SHARE_TOKEN_PATTERN);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(Buffer.from(tokens[0], "base64url")).toHaveLength(32);
  });
  it("the quotation service uses the CSPRNG generator, and the column is unique", () => {
    expect(readFileSync(path.join(SRC, "lib/quotes/service.ts"), "utf8")).toMatch(/newShareToken\(\)/);
    expect(readFileSync(path.join(SRC, "db/schema.ts"), "utf8")).toMatch(/shareToken: text\("share_token"\)\.unique\(\)/);
  });
});

describe("client IP for rate limits", () => {
  it("takes the trusted (right-hand) end of x-forwarded-for, not the client-supplied start", () => {
    expect(ipFromForwardedFor("6.6.6.6, 203.0.113.7")).toBe("203.0.113.7");
    expect(ipFromForwardedFor("6.6.6.6, 203.0.113.7, 10.0.0.2", 2)).toBe("203.0.113.7");
    expect(ipFromForwardedFor("203.0.113.7")).toBe("203.0.113.7");
    expect(ipFromForwardedFor(null)).toBeNull();
    expect(deriveClientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }), { TRUSTED_PROXY_HOPS: "1" })).toBe("2.2.2.2");
  });
  it("app code prefers the proxy-stamped x-client-ip", () => {
    expect(clientIp(new Headers({ "x-client-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1" }))).toBe("203.0.113.9");
  });
});

describe("request ids", () => {
  it("keeps a valid incoming id, otherwise makes a UUID", () => {
    expect(requestIdFrom(new Headers({ "x-request-id": "edge-1234abcd" }))).toBe("edge-1234abcd");
    expect(requestIdFrom(new Headers({ "x-railway-request-id": "rw_12345678" }))).toBe("rw_12345678");
    expect(requestIdFrom(new Headers({ "x-request-id": "<script>" }))).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("PII and secret scrubbing", () => {
  const token = "rw-secret-token-ABC123";
  const share = "/q/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
  it("removes emails, PH phones, token params, share paths and literal secrets", () => {
    const s = scrubString(
      `client juan.dela.cruz@example.test 0917 123 4567 +639171234567 63-917-123-4567 https://webhooks.rework.test/leads?token=${token}&x=1 ${share} raw ${token}`,
      { secrets: [token] },
    );
    expect(s).not.toContain("example.test");
    expect(s).not.toContain("4567");
    expect(s).not.toContain(token);
    expect(s).toContain("token=[redacted]");
    expect(s).toContain("/q/[token]");
  });
  it("redacts secret and PII keys deep inside objects", () => {
    const v = scrubValue({ a: { password: "x", phone: "+639171234567", fullName: "Juan", n: 3 }, list: [{ email: "a@b.co" }] }) as {
      a: Record<string, unknown>;
      list: Record<string, unknown>[];
    };
    expect(v.a).toEqual({ password: "[redacted]", phone: "[redacted]", fullName: "[redacted]", n: 3 });
    expect(v.list[0].email).toBe("[redacted]");
  });
  it("drops cookies, bodies and unsafe headers from Sentry events; keeps only user id/role", () => {
    const e = scrubEvent(
      {
        request: {
          url: `https://app.jmave.test${share}?token=${token}`,
          cookies: { s: "1" },
          data: { phone: "0917" },
          headers: { cookie: "s=1", authorization: "Bearer x", "user-agent": "UA", "x-request-id": "r1" },
        },
        user: { id: "u1", email: "x@y.co", ip_address: "1.2.3.4", role: "sales" },
        exception: { values: [{ value: `failed for maria@example.test ${token}` }] },
      },
      { secrets: [token] },
    );
    expect(e.request).toEqual({ url: "https://app.jmave.test/q/[token]?token=[redacted]", headers: { "user-agent": "UA", "x-request-id": "r1" } });
    expect(e.user).toEqual({ id: "u1", role: "sales" });
    expect(JSON.stringify(e.exception)).not.toMatch(/maria|rw-secret/);
  });
  it("log lines are JSON and scrubbed", () => {
    const line = formatLine("web", "error", "send failed for a@b.co", { requestId: "r1", phone: "0917" }, new Date("2026-11-27T00:00:00Z"), [token]);
    expect(JSON.parse(line)).toEqual({
      at: "2026-11-27T00:00:00.000Z",
      svc: "web",
      level: "error",
      requestId: "r1",
      phone: "[redacted]",
      msg: "send failed for [email]",
    });
  });
});

describe("import upload validation", () => {
  it("accepts a real workbook and reads its directory", async () => {
    const bytes = new Uint8Array(await bookingWorkbook());
    expect(checkWorkbookZip(bytes)).toBeNull();
    expect(readZipDirectory(bytes)?.entries).toContain("xl/workbook.xml");
  });
  it("refuses a workbook that would expand past the limit", async () => {
    const bytes = new Uint8Array(await bookingWorkbook());
    expect(checkWorkbookZip(bytes, 1000)).toBe("The workbook is too large to import.");
  });
  it("refuses truncated files and zips that are not workbooks", async () => {
    const bytes = new Uint8Array(await bookingWorkbook());
    expect(checkWorkbookZip(bytes.subarray(0, bytes.length - 30))).toBe("The file is not a valid .xlsx workbook.");
    expect(checkWorkbookZip(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]))).toBe("The file is not a valid .xlsx workbook.");
  });
});

describe("static scans", () => {
  const appFiles = walk(path.join(SRC, "app"));

  it("every server action reads the session and goes through a permission-checked runner", () => {
    // Public by design: first-run setup (token + empty table + rate limit).
    const PUBLIC_ACTIONS = new Set(["setupAction"]);
    const problems: string[] = [];
    for (const f of appFiles.filter((p) => readFileSync(p, "utf8").startsWith('"use server"'))) {
      const parts = readFileSync(f, "utf8").split(/^export async function /m).slice(1);
      for (const part of parts) {
        const name = part.slice(0, part.indexOf("("));
        const end = part.search(/^}/m);
        const body = end > 0 ? part.slice(0, end) : part;
        if (PUBLIC_ACTIONS.has(name)) continue;
        if (!/getCurrentUser\(\)/.test(body)) problems.push(`${rel(f)}: ${name} does not read the session`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("every route handler checks permissions, except the listed public ones", () => {
    const PUBLIC_ROUTES = new Set([
      "app/api/auth/[...all]/route.ts", // Better Auth (own checks, rate limits)
      "app/api/health/route.ts",
      "app/api/public/quote/route.ts", // public booking page (rate-limited)
      "app/api/public/inquiries/route.ts", // public booking page (Turnstile, honeypot, rate-limited)
      "app/(public)/q/[token]/pdf/route.ts", // the share token is the credential
    ]);
    const routes = appFiles.filter((p) => p.endsWith("route.ts")).map(rel);
    const unchecked = routes
      .filter((r) => !PUBLIC_ROUTES.has(r))
      .filter((r) => !/\b(can|requirePermission)\(|previewUpload\(/.test(readFileSync(path.join(SRC, r), "utf8")));
    expect(unchecked).toEqual([]);
    expect([...PUBLIC_ROUTES].filter((r) => !routes.includes(r))).toEqual([]);
  });

  it("app code logs through src/lib/log.ts, not console.*", () => {
    const allowed = new Set(["lib/log.ts", "db/migrate.ts", "worker/index.ts"]);
    const stray = walk(SRC)
      .filter((p) => !/\.test\.tsx?$/.test(p))
      .filter((p) => !allowed.has(rel(p)))
      .filter((p) => /\bconsole\.(log|info|warn|error|debug)\(/.test(readFileSync(p, "utf8")))
      .map(rel);
    expect(stray).toEqual([]);
  });
});

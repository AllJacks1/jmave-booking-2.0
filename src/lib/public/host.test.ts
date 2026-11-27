import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { parseAttribution } from "./attribution";
import { embedOrigins, frameAncestors, isPublicHost, publicBookUrl, routePublicHost } from "./host";

describe("public host routing (Phase 4 brief §1)", () => {
  const env = { PUBLIC_BOOK_HOST: "book.example.test, https://reserve.example.test/" };

  it("recognises the public hosts (port and case ignored)", () => {
    expect(isPublicHost("book.example.test", env)).toBe(true);
    expect(isPublicHost("BOOK.example.test:443", env)).toBe(true);
    expect(isPublicHost("reserve.example.test", env)).toBe(true);
    expect(isPublicHost("app.example.test", env)).toBe(false);
    expect(isPublicHost("book.example.test", {})).toBe(false);
  });

  it("rewrites pages to /book and never serves staff routes", () => {
    expect(routePublicHost("/")).toEqual({ action: "rewrite", pathname: "/book" });
    expect(routePublicHost("/privacy")).toEqual({ action: "rewrite", pathname: "/book/privacy" });
    expect(routePublicHost("/login")).toEqual({ action: "rewrite", pathname: "/book/login" }); // → 404 page
    expect(routePublicHost("/dashboard")).toEqual({ action: "rewrite", pathname: "/book/dashboard" });
    expect(routePublicHost("/book")).toEqual({ action: "next" });
    expect(routePublicHost("/api/public/quote")).toEqual({ action: "next" });
    expect(routePublicHost("/api/health")).toEqual({ action: "next" });
    expect(routePublicHost("/_next/static/chunk.js")).toEqual({ action: "next" });
    expect(routePublicHost("/api/auth/sign-in/email")).toEqual({ action: "not_found" });
    expect(routePublicHost("/api/quotations/x/pdf")).toEqual({ action: "not_found" });
  });

  it("frame-ancestors: /book allows the embed origins, everything else only itself", () => {
    const e = { PUBLIC_EMBED_ORIGINS: "https://www.jmave.test, https://jmave.test/path ; bad" };
    expect(embedOrigins(e)).toEqual(["https://www.jmave.test", "https://jmave.test"]);
    expect(frameAncestors("/book", e)).toBe("frame-ancestors 'self' https://www.jmave.test https://jmave.test");
    expect(frameAncestors("/book/privacy", e)).toBe("frame-ancestors 'self' https://www.jmave.test https://jmave.test");
    expect(frameAncestors("/bookings", e)).toBe("frame-ancestors 'self'");
    expect(frameAncestors("/dashboard", e)).toBe("frame-ancestors 'self'");
    // Values that could break the header are dropped.
    expect(embedOrigins({ PUBLIC_EMBED_ORIGINS: "javascript:alert(1) 'unsafe-inline' https://ok.test" })).toEqual(["https://ok.test"]);
  });

  it("public booking URL", () => {
    expect(publicBookUrl({ PUBLIC_BOOK_HOST: "book.example.test" })).toBe("https://book.example.test/");
    expect(publicBookUrl({ APP_URL: "https://app.example.test/" })).toBe("https://app.example.test/book");
    expect(publicBookUrl({})).toBeNull();
  });
});

describe("proxy", () => {
  afterEach(() => vi.unstubAllEnvs());
  const req = (url: string, host?: string) => new NextRequest(url, { headers: host ? { host } : {} });

  it("on the public host: rewrites to /book, 404s staff APIs, sets frame-ancestors", () => {
    vi.stubEnv("PUBLIC_BOOK_HOST", "book.example.test");
    vi.stubEnv("PUBLIC_EMBED_ORIGINS", "https://www.jmave.test");
    const home = proxy(req("https://book.example.test/?embed=1&utm_source=fb", "book.example.test"));
    expect(home.headers.get("x-middleware-rewrite")).toBe("https://book.example.test/book?embed=1&utm_source=fb");
    expect(home.headers.get("content-security-policy")).toBe("frame-ancestors 'self' https://www.jmave.test");
    const login = proxy(req("https://book.example.test/login", "book.example.test"));
    expect(login.headers.get("x-middleware-rewrite")).toBe("https://book.example.test/book/login");
    expect(proxy(req("https://book.example.test/api/auth/get-session", "book.example.test")).status).toBe(404);
    expect(proxy(req("https://book.example.test/api/public/quote", "book.example.test")).headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("on the staff host: /book is public, staff pages need a session and may not be framed by others", () => {
    vi.stubEnv("PUBLIC_BOOK_HOST", "book.example.test");
    vi.stubEnv("PUBLIC_EMBED_ORIGINS", "https://www.jmave.test");
    const book = proxy(req("https://app.example.test/book", "app.example.test"));
    expect(book.status).toBe(200);
    expect(book.headers.get("content-security-policy")).toBe("frame-ancestors 'self' https://www.jmave.test");
    const dash = proxy(req("https://app.example.test/dashboard", "app.example.test"));
    expect(dash.status).toBe(307);
    expect(proxy(req("https://app.example.test/api/public/inquiries", "app.example.test")).status).toBe(200);
  });
});

describe("attribution (Phase 4 brief §7)", () => {
  it("reads UTM, click ids, ad ids, referrer and _fbp", () => {
    const a = parseAttribution(
      "?utm_source=facebook&utm_campaign=dec&fbclid=IwAR1&gbraid=g1&other=ignored",
      "https://www.google.test/search?q=x",
      "https://book.example.test/?utm_source=facebook",
      "a=1; _fbp=fb.1.123.456; b=2",
    );
    expect(a).toEqual({
      utm_source: "facebook",
      utm_campaign: "dec",
      fbclid: "IwAR1",
      gbraid: "g1",
      fbp: "fb.1.123.456",
      referral_url: "https://www.google.test/search?q=x",
      referral_domain: "www.google.test",
      landing_url: "https://book.example.test/?utm_source=facebook",
    });
  });

  it("inside the iframe: ref, landing and fbp come from the snippet's parameters", () => {
    const a = parseAttribution("?embed=1&ref=https%3A%2F%2Fm.facebook.test%2F&landing=https%3A%2F%2Fwww.jmave.test%2Fbook&fbp=fb.1.9", "https://www.jmave.test/book", "https://book.example.test/?embed=1", "");
    expect(a.referral_domain).toBe("m.facebook.test");
    expect(a.landing_url).toBe("https://www.jmave.test/book");
    expect(a.fbp).toBe("fb.1.9");
  });
});

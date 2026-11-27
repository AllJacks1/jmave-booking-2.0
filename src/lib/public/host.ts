/**
 * Host routing and framing for the public booking page (Phase 4 brief §1, §6).
 * Pure: `src/proxy.ts` passes the env and request facts in.
 *
 * - `PUBLIC_BOOK_HOST` (comma list, e.g. `book.jmavecars.com`): on that host
 *   every path is served from `/book/*` (`/` → `/book`, `/privacy` →
 *   `/book/privacy`); staff pages are never served there.
 * - `PUBLIC_EMBED_ORIGINS` (comma list of origins): who may iframe `/book`
 *   (CSP `frame-ancestors`). Everything else may only be framed by itself.
 */

export type HostEnv = Readonly<Record<string, string | undefined>>;

/** Paths served as-is on the public host (assets, the public API, health). */
const PUBLIC_HOST_PASSTHROUGH = ["/_next", "/api/public", "/api/health", "/brand", "/favicon.ico", "/robots.txt"];

export function hostname(hostHeader: string | null): string {
  return (hostHeader ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

export function publicHosts(env: HostEnv): string[] {
  return (env.PUBLIC_BOOK_HOST ?? "")
    .split(",")
    .map((h) => hostname(h.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "")))
    .filter(Boolean);
}

export function isPublicHost(hostHeader: string | null, env: HostEnv): boolean {
  const h = hostname(hostHeader);
  return h !== "" && publicHosts(env).includes(h);
}

export type PublicHostRoute = { action: "next" } | { action: "rewrite"; pathname: string } | { action: "not_found" };

/** What the public host does with a path. */
export function routePublicHost(pathname: string): PublicHostRoute {
  if (PUBLIC_HOST_PASSTHROUGH.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return { action: "next" };
  if (pathname === "/book" || pathname.startsWith("/book/")) return { action: "next" };
  // Any other API (auth, PDFs, import…) is staff-only.
  if (pathname === "/api" || pathname.startsWith("/api/")) return { action: "not_found" };
  return { action: "rewrite", pathname: pathname === "/" ? "/book" : `/book${pathname}` };
}

/** Valid `scheme://host[:port]` origins only (anything else is dropped, so the header cannot be broken). */
export function embedOrigins(env: HostEnv): string[] {
  const out: string[] = [];
  for (const raw of (env.PUBLIC_EMBED_ORIGINS ?? "").split(/[\s,]+/)) {
    const v = raw.trim();
    if (!v) continue;
    try {
      const u = new URL(v);
      if ((u.protocol === "https:" || u.protocol === "http:") && u.origin !== "null") out.push(u.origin);
    } catch {
      // ignored
    }
  }
  return [...new Set(out)];
}

export function isBookPath(pathname: string): boolean {
  return pathname === "/book" || pathname.startsWith("/book/");
}

/** `Content-Security-Policy` for a response: `/book` may be framed by the embed origins. */
export function frameAncestors(pathname: string, env: HostEnv): string {
  const allowed = isBookPath(pathname) ? embedOrigins(env) : [];
  return `frame-ancestors ${["'self'", ...allowed].join(" ")}`;
}

/** Base URL of the public booking page (settings snippet, emails). */
export function publicBookUrl(env: HostEnv): string | null {
  const host = publicHosts(env)[0];
  if (host) return `https://${host}/`;
  const app = (env.APP_URL ?? "").trim().replace(/\/+$/, "");
  return app ? `${app}/book` : null;
}

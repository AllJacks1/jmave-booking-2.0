/**
 * CSRF guard for cookie-authenticated route handlers that change data
 * (Phase 5). Server actions get Next's own Origin check; Better Auth checks
 * its own endpoints against `baseURL`. Route handlers call this.
 *
 * Browsers always send `Origin` on cross-origin POSTs (and `Sec-Fetch-Site`),
 * so a request is refused when either says it came from another site. A
 * request with neither header is not from a browser and carries no victim
 * cookies, so it is allowed (the session check still applies).
 */

export function allowedOrigins(requestUrl: string, appUrl: string | undefined): Set<string> {
  const out = new Set<string>();
  try {
    out.add(new URL(requestUrl).origin);
  } catch {
    // ignored
  }
  if (appUrl) {
    try {
      out.add(new URL(appUrl).origin);
    } catch {
      // ignored
    }
  }
  return out;
}

export function isSameOriginRequest(
  headers: Headers,
  requestUrl: string,
  appUrl: string | undefined = process.env.APP_URL,
): boolean {
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = headers.get("origin");
  if (origin) {
    if (origin === "null") return false;
    const allowed = allowedOrigins(requestUrl, appUrl);
    // Behind Railway's proxy the request URL may be internal: also accept the Host header's origin.
    const host = headers.get("x-forwarded-host") ?? headers.get("host");
    const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (host) allowed.add(`${proto ?? new URL(requestUrl).protocol.replace(":", "")}://${host}`);
    return allowed.has(origin);
  }
  return true;
}

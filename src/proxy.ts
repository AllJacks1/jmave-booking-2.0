import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicHost, routePublicHost } from "@/lib/public/host";
import { requestIdFrom } from "@/lib/observability/request-id";
import { CLIENT_IP_HEADER, deriveClientIp } from "@/lib/security/client-ip";
import { contentSecurityPolicy, hstsHeader, makeNonce, referrerPolicyFor } from "@/lib/security/headers";

/**
 * Optimistic gate only: redirects requests without a session cookie to
 * /login. Real checks (valid session, active user, permissions) happen in
 * every page, server action and route handler.
 *
 * Phase 4: on `PUBLIC_BOOK_HOST` every path is served from `/book/*` and
 * staff pages are never served (src/lib/public/host.ts).
 *
 * Phase 5: every response gets the security headers (CSP with a per-request
 * nonce, `frame-ancestors` per Phase 4, HSTS over HTTPS, share-link referrer
 * policy) and an `x-request-id` (kept from the edge when valid). The nonce and
 * request id are also set on the request so pages and logs can read them.
 */
// `/q/<token>`: public read-only shared quotation (PLAN §6.5).
// `/book`, `/api/public`: public booking page (Phase 4).
const PUBLIC_PATHS = ["/login", "/setup", "/api/auth", "/api/health", "/q", "/book", "/api/public"];

type Ctx = { nonce: string; requestId: string; csp: string; requestHeaders: Headers };

function context(request: NextRequest, servedPath: string): Ctx {
  const nonce = makeNonce();
  const requestId = requestIdFrom(request.headers);
  const csp = contentSecurityPolicy({
    pathname: servedPath,
    nonce,
    env: process.env,
    dev: process.env.NODE_ENV === "development",
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);
  // Trusted client IP for rate limits; overwrites any value the client sent.
  const ip = deriveClientIp(request.headers);
  if (ip) requestHeaders.set(CLIENT_IP_HEADER, ip);
  else requestHeaders.delete(CLIENT_IP_HEADER);
  // Next reads the nonce for its own scripts from the request's CSP header.
  requestHeaders.set("content-security-policy", csp);
  return { nonce, requestId, csp, requestHeaders };
}

function secure(res: NextResponse, request: NextRequest, ctx: Ctx, servedPath: string): NextResponse {
  res.headers.set("Content-Security-Policy", ctx.csp);
  res.headers.set("x-request-id", ctx.requestId);
  res.headers.set("Referrer-Policy", referrerPolicyFor(servedPath));
  const hsts = hstsHeader(request.headers.get("x-forwarded-proto"), request.url);
  if (hsts) res.headers.set("Strict-Transport-Security", hsts);
  return res;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicHost(request.headers.get("host"), process.env)) {
    const route = routePublicHost(pathname);
    if (route.action === "not_found") {
      const ctx = context(request, pathname);
      return secure(new NextResponse(null, { status: 404 }), request, ctx, pathname);
    }
    if (route.action === "rewrite") {
      const ctx = context(request, route.pathname);
      const url = request.nextUrl.clone();
      url.pathname = route.pathname;
      return secure(NextResponse.rewrite(url, { request: { headers: ctx.requestHeaders } }), request, ctx, route.pathname);
    }
    const ctx = context(request, pathname);
    return secure(NextResponse.next({ request: { headers: ctx.requestHeaders } }), request, ctx, pathname);
  }

  const ctx = context(request, pathname);

  // Public sign-up does not exist (PLAN §2: Super Admin creates all users).
  if (pathname.startsWith("/api/auth/sign-up")) {
    return secure(new NextResponse(null, { status: 404 }), request, ctx, pathname);
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !getSessionCookie(request)) {
    if (pathname.startsWith("/api/")) {
      return secure(NextResponse.json({ error: "Not signed in" }, { status: 401 }), request, ctx, pathname);
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return secure(NextResponse.redirect(url), request, ctx, pathname);
  }
  return secure(NextResponse.next({ request: { headers: ctx.requestHeaders } }), request, ctx, pathname);
}

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|brand/|.*\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)",
  ],
};

import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { frameAncestors, isPublicHost, routePublicHost } from "@/lib/public/host";

/**
 * Optimistic gate only: redirects requests without a session cookie to
 * /login. Real checks (valid session, active user, permissions) happen in
 * every page, server action and route handler.
 *
 * Phase 4: on `PUBLIC_BOOK_HOST` every path is served from `/book/*` and
 * staff pages are never served (src/lib/public/host.ts). Every response gets
 * a CSP `frame-ancestors`: `/book` may be framed by `PUBLIC_EMBED_ORIGINS`.
 */
// `/q/<token>`: public read-only shared quotation (PLAN §6.5).
// `/book`, `/api/public`: public booking page (Phase 4).
const PUBLIC_PATHS = ["/login", "/setup", "/api/auth", "/api/health", "/q", "/book", "/api/public"];

function withFraming(res: NextResponse, pathname: string): NextResponse {
  res.headers.set("Content-Security-Policy", frameAncestors(pathname, process.env));
  return res;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicHost(request.headers.get("host"), process.env)) {
    const route = routePublicHost(pathname);
    if (route.action === "not_found") return new NextResponse(null, { status: 404 });
    if (route.action === "rewrite") {
      const url = request.nextUrl.clone();
      url.pathname = route.pathname;
      return withFraming(NextResponse.rewrite(url), route.pathname);
    }
    return withFraming(NextResponse.next(), pathname);
  }

  // Public sign-up does not exist (PLAN §2: Super Admin creates all users).
  if (pathname.startsWith("/api/auth/sign-up")) {
    return new NextResponse(null, { status: 404 });
  }

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isPublic) return withFraming(NextResponse.next(), pathname);

  if (!getSessionCookie(request)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return withFraming(NextResponse.next(), pathname);
}

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)",
  ],
};

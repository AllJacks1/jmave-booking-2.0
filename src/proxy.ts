import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate only: redirects requests without a session cookie to
 * /login. Real checks (valid session, active user, permissions) happen in
 * every page, server action and route handler.
 */
// `/q/<token>`: public read-only shared quotation (PLAN §6.5).
const PUBLIC_PATHS = ["/login", "/setup", "/api/auth", "/api/health", "/q"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public sign-up does not exist (PLAN §2: Super Admin creates all users).
  if (pathname.startsWith("/api/auth/sign-up")) {
    return new NextResponse(null, { status: 404 });
  }

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isPublic) return NextResponse.next();

  if (!getSessionCookie(request)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)",
  ],
};

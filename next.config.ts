import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./src/lib/security/static-headers";

const nextConfig: NextConfig = {
  // Cache Components is off: every staff page depends on the signed-in user,
  // so the app renders dynamically per request (see PLAN.md §7, 2026-11-23).
  cacheComponents: false,
  poweredByHeader: false,
  // Phase 5: static security headers on every response, static files included.
  // CSP (with a per-request nonce) and HSTS are set in src/proxy.ts.
  async headers() {
    return [{ source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] }];
  },
  // The booking workbook is ~28 MB; the proxy buffers request bodies and
  // would cut uploads at its 10 MB default. The import route caps at 40 MB.
  experimental: {
    proxyClientMaxBodySize: "45mb",
    // forbidden() renders a real 403 for pages a role may not open (Phase 1c).
    authInterrupts: true,
  },
  // exceljs is CommonJS with optional deps; keep it out of the server bundle.
  // @react-pdf/renderer (Phase 1c) loads fonts from disk; keep it external too.
  serverExternalPackages: ["exceljs", "@react-pdf/renderer"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Phase 5: Sentry build plugin. Source maps upload only when SENTRY_AUTH_TOKEN
// is set (Railway build); otherwise the build is unchanged and quiet.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG || "mantis-pv",
  project: process.env.SENTRY_PROJECT || "jmave-booking-web",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN, deleteSourcemapsAfterUpload: true },
  telemetry: false,
});

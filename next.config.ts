import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is off: every staff page depends on the signed-in user,
  // so the app renders dynamically per request (see PLAN.md §7, 2026-11-23).
  cacheComponents: false,
  poweredByHeader: false,
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

export default nextConfig;

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
  },
  // exceljs is CommonJS with optional deps; keep it out of the server bundle.
  serverExternalPackages: ["exceljs"],
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

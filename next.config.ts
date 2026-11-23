import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is off: every staff page depends on the signed-in user,
  // so the app renders dynamically per request (see PLAN.md §7, 2026-11-23).
  cacheComponents: false,
  poweredByHeader: false,
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

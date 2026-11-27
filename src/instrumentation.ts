/**
 * Next.js instrumentation hook (Phase 5): loads Sentry for the running
 * runtime and reports errors from Server Components, route handlers,
 * server actions and the proxy.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

export const onRequestError = Sentry.captureRequestError;

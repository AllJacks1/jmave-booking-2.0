/**
 * Sentry in the browser (Phase 5). DSN is `NEXT_PUBLIC_SENTRY_DSN` (inlined
 * at build time). No session replay or feedback widget: replays would record
 * client names and phones on screen. Collection off + scrubbing as on the
 * server (src/lib/observability/sentry-options.ts).
 */
import * as Sentry from "@sentry/nextjs";
import { sentryDataCollection, sentryScrubbers } from "@/lib/observability/sentry-options";

const scrub = sentryScrubbers({});

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "development",
  dataCollection: sentryDataCollection(),
  tracesSampleRate: 0,
  initialScope: { tags: { service: "web-browser" } },
  beforeSend: scrub.beforeSend,
  beforeBreadcrumb: scrub.beforeBreadcrumb,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

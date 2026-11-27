/**
 * Sentry for the web server (Node runtime). Phase 5. No DSN → disabled.
 * Collection off + scrubbing: src/lib/observability/sentry-options.ts.
 */
import * as Sentry from "@sentry/nextjs";
import { sentryDataCollection, sentryEnvironment, sentryRelease, sentryScrubbers, withRequestIdTag } from "@/lib/observability/sentry-options";

const scrub = sentryScrubbers(process.env);

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: sentryEnvironment(process.env),
  release: sentryRelease(process.env),
  dataCollection: sentryDataCollection(),
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0) || 0,
  initialScope: { tags: { service: "web" } },
  beforeSend: (event) => withRequestIdTag(scrub.beforeSend(event)),
  beforeBreadcrumb: scrub.beforeBreadcrumb,
});

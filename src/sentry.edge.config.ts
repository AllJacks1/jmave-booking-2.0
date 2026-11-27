/**
 * Sentry for the edge runtime (the proxy may run there). Phase 5. No DSN → disabled.
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
  tracesSampleRate: 0,
  initialScope: { tags: { service: "web" } },
  beforeSend: (event) => withRequestIdTag(scrub.beforeSend(event)),
  beforeBreadcrumb: scrub.beforeBreadcrumb,
});

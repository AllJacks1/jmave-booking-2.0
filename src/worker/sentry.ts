/**
 * Sentry for the worker (Phase 5). DSN: `SENTRY_WORKER_DSN`, else
 * `SENTRY_DSN` (on Railway each service can simply have its own
 * `SENTRY_DSN`). Without a DSN nothing is sent.
 *
 * Automatic data collection is off and every event passes `scrubEvent`
 * (emails, phones, the Rework token and other env secrets, request data):
 * src/lib/observability/sentry-options.ts.
 */
import * as Sentry from "@sentry/node";
import { sentryDataCollection, sentryEnvironment, sentryRelease, sentryScrubbers } from "@/lib/observability/sentry-options";

let enabled = false;

export function initWorkerSentry(env: Record<string, string | undefined> = process.env) {
  const dsn = env.SENTRY_WORKER_DSN || env.SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: sentryEnvironment(env),
    release: sentryRelease(env),
    dataCollection: sentryDataCollection(),
    tracesSampleRate: 0,
    initialScope: { tags: { service: "worker" } },
    ...sentryScrubbers(env),
  });
  enabled = true;
  return true;
}

/** Report a logged error (fields are scrubbed again by `beforeSend`). */
export function reportWorkerError(msg: string, extra?: Record<string, unknown>) {
  if (!enabled) return;
  Sentry.captureMessage(msg, { level: "error", extra, fingerprint: ["worker", msg] });
}

export async function flushWorkerSentry() {
  if (enabled) await Sentry.flush(2000);
}

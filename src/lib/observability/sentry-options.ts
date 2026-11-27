/**
 * Sentry options shared by web (server, edge, browser) and worker (Phase 5).
 * Pure: no SDK import, so every runtime can use it.
 *
 * `dataCollection` (Sentry SDK v11) turns automatic collection off for user
 * info, cookies, bodies, query strings, DB query data, queue arguments and
 * stack locals; only a few harmless request headers are kept. `beforeSend`
 * then runs `scrubEvent` on whatever is left (messages, exceptions, URLs).
 */
import { envSecrets, scrubEvent, scrubValue } from "./scrub";

type Env = Record<string, string | undefined>;

export function sentryDataCollection() {
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { allow: ["user-agent", "content-type", "x-request-id"] }, response: false },
    httpBodies: [] as never[],
    urlQueryParams: false,
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  };
}

export function sentryEnvironment(env: Env): string {
  return env.SENTRY_ENVIRONMENT || env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || "development";
}

export function sentryRelease(env: Env): string | undefined {
  return env.SENTRY_RELEASE || env.RAILWAY_GIT_COMMIT_SHA || undefined;
}

/** `beforeSend` / `beforeBreadcrumb` pair bound to the process's secrets. */
export function sentryScrubbers(env: Env) {
  const secrets = envSecrets(env);
  return {
    beforeSend: <E>(event: E): E => scrubEvent(event, { secrets }),
    beforeBreadcrumb: <B>(crumb: B): B => scrubValue(crumb, { secrets }) as B,
  };
}

/** Copy the kept `x-request-id` header into a tag so events can be matched with log lines. */
export function withRequestIdTag<E>(event: E): E {
  const e = event as { request?: { headers?: Record<string, string> }; tags?: Record<string, unknown> } | null;
  const id = e?.request?.headers?.["x-request-id"];
  if (!e || !id) return event;
  return { ...e, tags: { ...e.tags, request_id: id } } as E;
}

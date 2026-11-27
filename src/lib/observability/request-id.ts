/**
 * Request ids (Phase 5). The proxy keeps a valid incoming id (Railway's edge
 * or a client) and otherwise makes one; it is echoed as `x-request-id`, put
 * on every log line and tagged on Sentry events.
 */
const VALID = /^[A-Za-z0-9._:-]{8,128}$/;

export function requestIdFrom(headers: Headers): string {
  for (const name of ["x-request-id", "x-railway-request-id"]) {
    const v = headers.get(name)?.trim();
    if (v && VALID.test(v)) return v;
  }
  return crypto.randomUUID();
}

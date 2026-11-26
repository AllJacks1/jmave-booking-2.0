/**
 * Outbox retry policy (PLAN §6.6). Pure.
 *
 * Attempt n fails → wait 30 s × 2^(n−1) before attempt n+1
 * (30 s, 1 min, 2 min, 4 min, 8 min, 16 min, 32 min). The 8th failure
 * marks the row `failed` and keeps the error.
 */
export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_BASE_DELAY_MS = 30_000;

/** Delay after `attempts` failed attempts (attempts ≥ 1). */
export function backoffMs(attempts: number): number {
  return OUTBOX_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1);
}

export type AttemptOutcome =
  | { status: "sent" }
  | { status: "pending"; nextAttemptAt: Date }
  | { status: "failed" };

/** What happens to a row after attempt number `attempts` (1-based) fails or succeeds. */
export function afterAttempt(attempts: number, ok: boolean, now: Date): AttemptOutcome {
  if (ok) return { status: "sent" };
  if (attempts >= OUTBOX_MAX_ATTEMPTS) return { status: "failed" };
  return { status: "pending", nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) };
}

/** Error text kept on the row: one line, no secrets in query strings, at most 1,000 chars. */
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/([?&](token|key|api_key|apikey)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

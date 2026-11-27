/**
 * Abuse controls for the public booking page (Phase 4 brief §3): Cloudflare
 * Turnstile (verified server-side), per-IP rate limit, client IP.
 *
 * Turnstile's siteverify is the one external call made inside a request:
 * the answer decides whether the request is accepted, so it cannot go
 * through the outbox (PLAN §6.6 covers Rework and email).
 */
import "server-only";
import { createHash } from "node:crypto";
import { and, count, eq, gte, lt } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { publicRateEvents } from "@/db/schema";

export const SUBMISSIONS_PER_HOUR = 5;
/** Price/availability look-ups per rolling hour per IP (Phase 5): generous, the form re-prices as dates change. */
export const QUOTES_PER_HOUR = 300;
/** First-run setup attempts per rolling hour per IP (Phase 5). */
export const SETUP_ATTEMPTS_PER_HOUR = 10;
const HOUR_MS = 3_600_000;

/** Client IP: stamped by the proxy from the trusted end of `x-forwarded-for` (src/lib/security/client-ip.ts). */
export { clientIp } from "@/lib/security/client-ip";

/** Hashed so the table never stores raw IPs. */
export function rateKey(scope: string, ip: string | null): string {
  const salt = process.env.BETTER_AUTH_SECRET ?? "";
  return `${scope}:${createHash("sha256").update(`${salt}|${ip ?? "unknown"}`).digest("hex").slice(0, 40)}`;
}

/**
 * Count this attempt and say whether it is allowed (at most `limit` per
 * rolling hour). Prunes rows older than an hour for the key.
 */
export async function takeRateLimit(tx: DbOrTx, key: string, now = new Date(), limit = SUBMISSIONS_PER_HOUR): Promise<boolean> {
  const since = new Date(now.getTime() - HOUR_MS);
  await tx.delete(publicRateEvents).where(and(eq(publicRateEvents.key, key), lt(publicRateEvents.at, since)));
  const [{ n }] = await tx
    .select({ n: count() })
    .from(publicRateEvents)
    .where(and(eq(publicRateEvents.key, key), gte(publicRateEvents.at, since)));
  if (n >= limit) return false;
  await tx.insert(publicRateEvents).values({ key, at: now });
  return true;
}

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileOutcome = { ok: true } | { ok: false; reason: "missing_token" | "not_configured" | "rejected" | "unreachable" };

/**
 * Verify a Turnstile token. Without `TURNSTILE_SECRET_KEY`: refused in
 * production (`not_configured`), skipped in development and tests.
 */
export async function verifyTurnstile(
  token: string,
  ip: string | null,
  opts: { secret?: string; production?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<TurnstileOutcome> {
  const secret = opts.secret ?? process.env.TURNSTILE_SECRET_KEY;
  const production = opts.production ?? process.env.NODE_ENV === "production";
  if (!secret) return production ? { ok: false, reason: "not_configured" } : { ok: true };
  if (!token) return { ok: false, reason: "missing_token" };
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await (opts.fetchImpl ?? fetch)(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
    return data?.success === true ? { ok: true } : { ok: false, reason: "rejected" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

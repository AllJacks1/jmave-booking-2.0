/**
 * Rework webhook transport (worker only, rework.md §1). The web app never
 * calls Rework: requests only write outbox rows (PLAN §6.6).
 *
 * The token travels as `?token=`. The full URL exists only inside `send`;
 * every error and stored body goes through `redactToken`.
 */
import { redactToken, reworkRequestUrl, type ReworkEnv } from "@/lib/rework/endpoint";
import { RESPONSE_BODY_MAX, type ReworkSendResult, type ReworkTransport } from "@/lib/rework/outbox-handler";

export function reworkTransport(env: ReworkEnv = process.env, fetchImpl: typeof fetch = fetch): ReworkTransport {
  const token = env.REWORK_WEBHOOK_TOKEN;
  const safe = (text: string) => redactToken(text, token);
  return {
    name: "rework",
    async send(lead, idempotencyKey): Promise<ReworkSendResult> {
      let res: Response;
      try {
        const url = reworkRequestUrl(env);
        res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/plain, */*", "Idempotency-Key": `outbox-${idempotencyKey}` },
          body: JSON.stringify(lead),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        // Network errors can echo the request URL: never let the token through.
        const msg = err instanceof Error ? `${err.name}: ${err.message}${err.cause instanceof Error ? ` (${err.cause.message})` : ""}` : String(err);
        throw new Error(safe(`Rework request failed: ${msg}`));
      }
      const body = safe((await res.text().catch(() => "")).slice(0, RESPONSE_BODY_MAX));
      if (!res.ok) throw new Error(safe(`Rework ${res.status}: ${body.slice(0, 500) || res.statusText}`));
      return { status: res.status, body };
    },
  };
}

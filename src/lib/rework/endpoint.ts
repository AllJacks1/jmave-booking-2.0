/**
 * The one place that builds the Rework webhook URL (rework.md §1).
 *
 * The token is a URL parameter. Never log, store or show the full URL: every
 * log line, error, outbox row and page uses `redactedUrl` / `redactToken`.
 * Pure module (env is passed in).
 */

/** `process.env` or a test object with `REWORK_WEBHOOK_URL` / `REWORK_WEBHOOK_TOKEN`. */
export type ReworkEnv = Readonly<Record<string, string | undefined>>;

export const REDACTED = "***";

export type ReworkConfigStatus = { urlSet: boolean; tokenSet: boolean; ready: boolean; redactedUrl: string | null };

export function reworkConfigStatus(env: ReworkEnv): ReworkConfigStatus {
  const url = env.REWORK_WEBHOOK_URL?.trim() ?? "";
  const token = env.REWORK_WEBHOOK_TOKEN?.trim() ?? "";
  let valid = false;
  try {
    valid = url !== "" && ["https:", "http:"].includes(new URL(url).protocol);
  } catch {
    valid = false;
  }
  return {
    urlSet: valid,
    tokenSet: token !== "",
    ready: valid && token !== "",
    redactedUrl: valid ? redactedUrl(url) : null,
  };
}

/** `https://…/leadgen?token=***` (any existing token parameter replaced). */
export function redactedUrl(base: string): string {
  const u = new URL(base);
  u.searchParams.delete("token");
  u.searchParams.set("token", REDACTED);
  return u.toString().replace(encodeURIComponent(REDACTED), REDACTED);
}

/** Full URL with the token. Use only to make the request; never log or store the result. */
export function reworkRequestUrl(env: ReworkEnv): URL {
  const status = reworkConfigStatus(env);
  if (!status.urlSet) throw new Error("REWORK_WEBHOOK_URL is not set.");
  if (!status.tokenSet) throw new Error("REWORK_WEBHOOK_TOKEN is not set.");
  const u = new URL(env.REWORK_WEBHOOK_URL!.trim());
  u.searchParams.set("token", env.REWORK_WEBHOOK_TOKEN!.trim());
  return u;
}

/**
 * Remove the token from any text: its raw and URL-encoded forms, and any
 * `token=` query parameter. Use on every error message and response body.
 */
export function redactToken(text: string, token: string | null | undefined): string {
  let out = text;
  const t = token?.trim();
  if (t) {
    for (const form of new Set([t, encodeURIComponent(t), encodeURIComponent(encodeURIComponent(t))])) {
      out = out.split(form).join(REDACTED);
    }
  }
  return out.replace(/([?&]token=)[^&\s"'#]+/gi, `$1${REDACTED}`);
}

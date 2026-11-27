/**
 * PII and secret scrubbing for error reports and logs (Phase 5). Pure: shared
 * by the web app (Sentry `beforeSend`, JSON logs) and the worker.
 *
 * Removes: email addresses, Philippine phone numbers, `token=` URL values
 * (the Rework token, PLAN §7), quotation share tokens in `/q/<token>` paths,
 * cookies, auth headers, request bodies, and values under secret- or
 * PII-looking keys. Extra literal secrets (e.g. the Rework token itself) can
 * be passed in and are replaced wherever they appear.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** +63 9xx…, 63 9xx…, 09xx… with optional spaces, dots or dashes. */
const PH_PHONE = /(?<![\d])(?:\+?63|0)[\s.-]?9\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?![\d])/g;
/** `token=…` in query strings (raw or URL-encoded `token%3D…`). */
const TOKEN_PARAM = /(token(?:=|%3D))[^&\s"'#]+/gi;
/** Share links `/q/<base64url token>` (and its `/pdf`). */
const SHARE_PATH = /\/q\/[A-Za-z0-9_-]{16,}/g;

/** Keys whose values are always replaced. Matched case-insensitively on the whole key. */
const SECRET_KEY =
  /^(password|newPassword|currentPassword|temporaryPassword|secret|token|setupToken|accessToken|refreshToken|idToken|apiKey|authorization|cookie|cookies|set-cookie|x-api-key|shareToken|share_token|turnstileToken|cf-turnstile-response)$/i;
/** Keys that hold client PII. */
const PII_KEY =
  /^(email|phone|mobile|landline|fullName|full_name|fbName|fb_name|address|deliveryAddress|pickupAddress|birthday|driversLicenseNo|drivers_license_no|altContactName|altContactPhone|clientName|client_name|ip|ipAddress|ip_address)$/i;

export const REDACTED = "[redacted]";

export type ScrubOptions = {
  /** Literal secret values to remove wherever they appear (empty strings ignored). */
  secrets?: readonly (string | undefined | null)[];
};

export function scrubString(s: string, opts: ScrubOptions = {}): string {
  let out = s;
  for (const secret of opts.secrets ?? []) {
    if (secret && secret.length >= 6) {
      out = out.split(secret).join(REDACTED);
      const enc = encodeURIComponent(secret);
      if (enc !== secret) out = out.split(enc).join(REDACTED);
    }
  }
  return out
    .replace(TOKEN_PARAM, `$1${REDACTED}`)
    .replace(SHARE_PATH, "/q/[token]")
    .replace(EMAIL, "[email]")
    .replace(PH_PHONE, "[phone]");
}

/** Deep copy with scrubbed strings and redacted secret / PII keys. Depth-limited. */
export function scrubValue(value: unknown, opts: ScrubOptions = {}, depth = 0): unknown {
  if (typeof value === "string") return scrubString(value, opts);
  if (value === null || typeof value !== "object") return value;
  if (depth > 12) return "[depth]";
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, opts, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) || PII_KEY.test(k) ? REDACTED : scrubValue(v, opts, depth + 1);
  }
  return out;
}

/** Request headers kept on error reports; everything else is dropped. */
const SAFE_HEADERS = new Set(["user-agent", "content-type", "accept", "x-request-id", "referer", "host"]);

type LooseEvent = {
  message?: unknown;
  request?: {
    url?: string;
    query_string?: unknown;
    headers?: Record<string, string>;
    cookies?: unknown;
    data?: unknown;
    env?: unknown;
  };
  user?: Record<string, unknown>;
  breadcrumbs?: unknown;
  exception?: unknown;
  extra?: unknown;
  contexts?: unknown;
  tags?: unknown;
  transaction?: unknown;
  logentry?: unknown;
};

/**
 * Scrub a Sentry event in place-safe fashion (returns a new object).
 * Generic so this module does not depend on the Sentry SDK types.
 */
export function scrubEvent<T>(event: T, opts: ScrubOptions = {}): T {
  const e = { ...(event as LooseEvent) };
  if (e.request) {
    const r = { ...e.request };
    delete r.cookies;
    delete r.data;
    delete r.env;
    if (r.headers) {
      r.headers = Object.fromEntries(
        Object.entries(r.headers)
          .filter(([k]) => SAFE_HEADERS.has(k.toLowerCase()))
          .map(([k, v]) => [k, scrubString(String(v), opts)]),
      );
    }
    if (typeof r.url === "string") r.url = scrubString(r.url, opts);
    if (r.query_string !== undefined) r.query_string = scrubValue(r.query_string, opts);
    e.request = r;
  }
  // Staff user id and role only: never email, name or IP.
  if (e.user) {
    const { id, role } = e.user;
    e.user = { ...(id ? { id } : {}), ...(role ? { role } : {}) };
  }
  for (const key of ["message", "breadcrumbs", "exception", "extra", "contexts", "tags", "transaction", "logentry"] as const) {
    if (e[key] !== undefined) (e as Record<string, unknown>)[key] = scrubValue(e[key], opts);
  }
  return e as T;
}

/** Literal secrets from the environment that must never leave the process. */
export function envSecrets(env: Record<string, string | undefined> = process.env): string[] {
  return [
    env.REWORK_WEBHOOK_TOKEN,
    env.BETTER_AUTH_SECRET,
    env.SETUP_TOKEN,
    env.RESEND_API_KEY,
    env.TURNSTILE_SECRET_KEY,
    env.SENTRY_AUTH_TOKEN,
  ].filter((s): s is string => Boolean(s));
}

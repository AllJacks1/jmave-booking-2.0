/**
 * Client IP for rate limits (Phase 5). Pure; used by the proxy and route code.
 *
 * A client can send its own `x-forwarded-for`; proxies append to it. So the
 * trusted address is counted from the RIGHT: with one trusted proxy (Railway's
 * edge) it is the last entry. Set `TRUSTED_PROXY_HOPS` (default 1) if another
 * proxy/CDN is put in front (e.g. 2 behind Cloudflare → Railway).
 *
 * The proxy stamps the result on every request as `x-client-ip`, overwriting
 * anything the client sent; app code reads `x-client-ip` first.
 */
export const CLIENT_IP_HEADER = "x-client-ip";

export function ipFromForwardedFor(xff: string | null, hops = 1): string | null {
  if (!xff) return null;
  const parts = xff
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const ip = parts[Math.max(0, parts.length - Math.max(1, hops))];
  return ip.slice(0, 100);
}

export function trustedHops(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.TRUSTED_PROXY_HOPS ?? 1);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 1;
}

/** In the proxy: the address to stamp as `x-client-ip`. */
export function deriveClientIp(headers: Headers, env: Record<string, string | undefined> = process.env): string | null {
  return ipFromForwardedFor(headers.get("x-forwarded-for"), trustedHops(env));
}

/** In app code: the proxy's stamped value, else derived the same way (tests, scripts). */
export function clientIp(headers: Headers): string | null {
  const stamped = headers.get(CLIENT_IP_HEADER)?.trim();
  if (stamped) return stamped.slice(0, 100);
  return deriveClientIp(headers);
}

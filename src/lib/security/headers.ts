/**
 * Security headers (Phase 5). Pure: `src/proxy.ts` passes the request facts.
 *
 * - CSP with a per-request nonce and `'strict-dynamic'` (Next applies the
 *   nonce to its own scripts; scripts those load, like Turnstile, inherit
 *   trust). `<style>` elements need the nonce too (Next, next-themes and
 *   Radix's scroll lock via `get-nonce` get it); Sonner's fixed stylesheet is
 *   allowed by its hash. Only style *attributes* (React `style` props, Radix
 *   positioning) use `style-src-attr 'unsafe-inline'`.
 * - `frame-ancestors`: `/book` may be framed by `PUBLIC_EMBED_ORIGINS`,
 *   everything else only by itself (Phase 4 decision).
 * - Static headers (nosniff, referrer, permissions, COOP, HSTS) are in
 *   `STATIC_SECURITY_HEADERS`, also applied by next.config for static files.
 */
import { frameAncestors, type HostEnv } from "@/lib/public/host";

const TURNSTILE = "https://challenges.cloudflare.com";
/**
 * SHA-256 of the CSS Sonner inserts as a `<style>` without a nonce
 * (sonner/dist/index.mjs `__insertCSS`). `sonner-csp.test.ts` recomputes it
 * from node_modules, so a Sonner upgrade that changes the CSS fails the tests.
 */
export const SONNER_STYLE_HASH = "sha256-StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY=";
/** SHA-256 of the empty string: Sonner appends its `<style>` empty and fills it after, which the browser checks too. */
export const EMPTY_STYLE_HASH = "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
/** Sentry ingest hosts (browser error reports). */
const SENTRY_INGEST = "https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io";

export function contentSecurityPolicy(opts: { pathname: string; nonce: string; env: HostEnv; dev: boolean }): string {
  const directives: [string, string][] = [
    ["default-src", "'self'"],
    ["script-src", `'self' 'nonce-${opts.nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`],
    ["style-src", `'self' 'nonce-${opts.nonce}' '${SONNER_STYLE_HASH}' '${EMPTY_STYLE_HASH}'${opts.dev ? " 'unsafe-inline'" : ""}`],
    ["style-src-attr", "'unsafe-inline'"],
    ["img-src", "'self' data: blob:"],
    ["font-src", "'self' data:"],
    ["connect-src", `'self' ${SENTRY_INGEST}${opts.dev ? " ws: wss:" : ""}`],
    ["frame-src", `'self' ${TURNSTILE}`],
    ["worker-src", "'self' blob:"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", frameAncestors(opts.pathname, opts.env).replace(/^frame-ancestors /, "")],
  ];
  return directives.map(([k, v]) => `${k} ${v}`).join("; ");
}

export { STATIC_SECURITY_HEADERS } from "./static-headers";

/** HSTS only when the request reached us over HTTPS (Railway sets `x-forwarded-proto`). */
export function hstsHeader(forwardedProto: string | null, url: string): string | null {
  const proto = forwardedProto?.split(",")[0]?.trim().toLowerCase() ?? (url.startsWith("https:") ? "https" : "http");
  return proto === "https" ? "max-age=31536000; includeSubDomains" : null;
}

/** Share links carry the token in the path: never send it as a referrer. */
export function referrerPolicyFor(pathname: string): string {
  return pathname === "/q" || pathname.startsWith("/q/") ? "no-referrer" : "strict-origin-when-cross-origin";
}

/** 16 random bytes, base64. Web Crypto so it runs in the proxy runtime. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

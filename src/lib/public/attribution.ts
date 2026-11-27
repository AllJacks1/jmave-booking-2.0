/**
 * Attribution capture (Phase 4 brief §7): UTM params, click ids, ad ids,
 * referrer and the `_fbp` cookie, taken on the first visit of the browser
 * session and kept in sessionStorage. Pure helpers + one browser function.
 *
 * Inside an iframe the parent page's URL is not visible: the embed snippet
 * forwards the parent's query string and passes `ref` (its referrer) and
 * `landing` (its URL) on the iframe `src`.
 */
import { ATTRIBUTION_PARAMS, attributionSchema, type Attribution } from "@/lib/rework/payload";

export const ATTRIBUTION_STORAGE_KEY = "jmave.attribution.v1";

/** Attribution from a query string, a referrer, a page URL and the cookie header. */
export function parseAttribution(search: string, referrer: string, pageUrl: string, cookie: string): Attribution {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: Record<string, string> = {};
  for (const k of ATTRIBUTION_PARAMS) {
    const v = q.get(k)?.trim();
    if (v) out[k] = v.slice(0, 500);
  }
  const fbp = q.get("fbp")?.trim() || /(?:^|;\s*)_fbp=([^;]+)/.exec(cookie)?.[1];
  if (fbp) out.fbp = decodeURIComponent(fbp).slice(0, 500);
  const ref = (q.get("ref") ?? referrer).trim();
  if (ref) {
    try {
      const u = new URL(ref);
      out.referral_url = u.toString().slice(0, 2000);
      out.referral_domain = u.hostname;
    } catch {
      // not a URL: ignore
    }
  }
  const landing = (q.get("landing") ?? pageUrl).trim();
  if (landing) out.landing_url = landing.slice(0, 2000);
  return attributionSchema.parse(out);
}

/** Read (or capture on the first visit) this session's attribution. Browser only. */
export function sessionAttribution(): Attribution {
  try {
    const saved = window.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (saved) {
      const parsed = attributionSchema.safeParse(JSON.parse(saved));
      if (parsed.success) return parsed.data;
    }
    const first = parseAttribution(window.location.search, document.referrer, window.location.href, document.cookie);
    window.sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(first));
    return first;
  } catch {
    // Storage blocked (private mode, third-party iframe): use this page view.
    try {
      return parseAttribution(window.location.search, document.referrer, window.location.href, document.cookie);
    } catch {
      return {};
    }
  }
}

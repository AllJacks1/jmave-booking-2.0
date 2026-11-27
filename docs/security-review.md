# Security review — Phase 5 (2026-11-27)

## 1. `/security-review` run

The automated review covered the branch diff against `main` (Phase 4 plus the new audit viewer). It found **no HIGH or MEDIUM findings with confidence ≥ 8/10.**

Areas it checked and judged safe:

- **Host routing and auth gate.** The public host serves only `/book`, `/api/public` and assets. Every other API returns 404 there, and staff pages fall into `/book/*`.
- **Public endpoints.** Input is parsed with zod, all queries are parameterised, there is no IDOR, and responses contain no client PII.
- **Staff actions and pages.** All of them go through `defineAction` or a page guard.
- **Audit viewer.** Permission is re-checked in the service, LIKE patterns are escaped, and ids are checked as uuids.
- **Rework token.** The URL is built only in the worker, and error messages and stored bodies are redacted.
- **XSS and `postMessage`.** There is no `dangerouslySetInnerHTML`, and the embed listener checks the message origin.

Items the review considered and dropped, with the action taken:

| Item | Action |
|---|---|
| The worker's Rework `fetch` followed redirects, which could carry the `?token=` URL to another host | **Fixed.** `redirect: "manual"`; a 3xx counts as a failed send and is retried. |
| Rate limits key on the first `x-forwarded-for` hop, which a client might spoof if Railway appends rather than overwrites | **Fixed** (see §3, item 2). |
| The proxy matcher skips paths ending in `.png`/`.txt` | Accepted. Pages and handlers check permissions themselves. |

## 2. Brief checklist (Phase 5 §2)

| Check | Result |
|---|---|
| Every server action and route checks permissions | `tests/integration/phase-5.test.ts` imports every `defineAction` runner (58). Each one is called signed out (401), with a must-change-password user (403), with an inactive user (403), and once per role: 403 exactly where `PERMISSIONS` denies, and never 401/403 where it allows. `src/lib/security/security.test.ts` checks every `"use server"` export reads the session, and every `route.ts` checks permissions except a named public list. |
| Every write path is audited | `src/lib/audit-log/coverage.test.ts`: each runner reaches `withAudit` or is exempt with a reason (read-only previews and searches, draft autosave). Fixed: quotation internal notes (`quotation.notes`) were not audited. |
| Security headers and CSP | Set in `src/proxy.ts` (`src/lib/security/headers.ts`):<br>• CSP with a per-request nonce plus `'strict-dynamic'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and `frame-ancestors` as in Phase 4;<br>• HSTS over HTTPS;<br>• `no-referrer` on share links.<br>Set in `next.config.ts` for every response, including static files: `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP. Verified live on staging. |
| Cookie flags | Better Auth session cookie: `HttpOnly`, `SameSite=Lax`, and `Secure` when `APP_URL` is https. E2E checks HttpOnly and Lax. |
| CSRF on mutations | Server actions: Next's Origin check. Better Auth: its origin check. `POST /api/import` (cookie-authenticated): new `isSameOriginRequest` check, so a cross-site post gets 403 (e2e). The public POST endpoints use no cookies. |
| Upload validation (import) | Super Admin only, `.xlsx` name, ≤ 40 MB, zip signature. **New:** the zip central directory must hold `[Content_Types].xml` and `xl/workbook.xml`, entry names may not contain `..`, `/…` or `\`, and the expanded size must be ≤ 400 MB (zip bomb). This is checked before exceljs runs. |
| No PII or secrets in logs | All app logs go through `src/lib/log.ts`: JSON lines, with emails, PH phones, `token=` values, share tokens, env secrets and PII-named keys scrubbed. A test fails on any stray `console.*`. The worker uses the same logger. |
| Rate limits | Sign-in and change-password: 10/min per IP (Better Auth). **New:** `/setup`, 10/hour per hashed IP (429). **New:** `POST /api/public/quote`, 300/hour per hashed IP. Public requests: 5/hour (Phase 4). |
| Share tokens | 32 bytes from `crypto.randomBytes`, base64url (43 chars), unique column. Unit test checks 2,000 tokens for format, uniqueness and 32 decoded bytes. |
| Sentry | Automatic collection off (`dataCollection`: no user info, cookies, bodies, query strings, DB data, stack locals). `beforeSend` scrubs messages, exceptions, URLs and breadcrumbs. Only user id and role are kept. No session replay. Verified with a real staging worker event: no user data, `environment=staging`. |

## 3. Risks — owner decisions (2026-11-27)

| # | Risk | Decision |
|---|---|---|
| 1 | CSP `style-src 'unsafe-inline'` | **Not accepted → fixed.** `<style>` elements are nonce-only. Next, next-themes and Radix's scroll lock (through `get-nonce`, `src/components/csp-nonce.tsx`) get the nonce. Sonner's fixed stylesheet is allowed by its SHA-256, which `sonner-csp.test.ts` re-checks against the installed version. Only style *attributes* use `style-src-attr 'unsafe-inline'`: React `style` props and Radix positioning, which a nonce cannot cover. E2E opens a dialog and a toast and checks for CSP errors. |
| 2 | Rate limits keyed on the first `x-forwarded-for` hop (client-controlled) | **Not accepted → fixed.** The proxy computes the client IP from the trusted right-hand end of `x-forwarded-for` (`TRUSTED_PROXY_HOPS`, default 1 = Railway's edge). It stamps the result as `x-client-ip`, overwriting anything the client sent. Better Auth and the app limits read only that. If a CDN is put in front of Railway, set `TRUSTED_PROXY_HOPS=2`. |
| 3 | Staging Postgres reachable through a TCP proxy | **Not accepted → removed** (2026-11-27). Add it again for a reseed or restore drill, and remove it afterwards (`docs/ops/staging.md`). |
| 4 | No Railway volume backups (trial plan) | **Accepted by the owner**, relying on the nightly off-site dump. That dump becomes active once a bucket exists (`docs/ops/backups.md`). |

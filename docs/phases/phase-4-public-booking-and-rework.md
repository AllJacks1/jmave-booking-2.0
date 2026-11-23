# Phase 4 — Public booking page and Rework

> **Kickoff prompt:**
> Build Phase 4 of J-MaVe Booking 2.0. Follow `CLAUDE.md`, `docs/PLAN.md` and `docs/phases/phase-4-public-booking-and-rework.md`. Show me your plan first, then build.

## Goal

Clients can check availability and prices on the company website and send a booking request. Every intake reaches Rework as a lead.

## Owner does before this session

- Decide the hostnames, e.g. `app.<domain>` (staff) and `book.<domain>` (public), and add them as custom domains on the Railway `web` service; create the DNS records Railway shows.
- Set `REWORK_WEBHOOK_URL` and `REWORK_WEBHOOK_TOKEN` in Railway.
- Get from Rework: the exact option values for the dropdown fields listed in `docs/reference/rework.md` §4.
- Create a Cloudflare Turnstile site; set `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.
- Set `PUBLIC_EMBED_ORIGINS` to the website origin(s) that will iframe the page.

## Read first

- `CLAUDE.md`, `docs/PLAN.md` (§4 `inquiries`, §6.6)
- `docs/reference/rework.md`
- `docs/reference/pricing.md` §2.1, §3.1

## Build, in order

1. **Host routing**: middleware rewrites `book.<domain>/*` to `/book/*`; staff routes are not served on the public host.
2. **Public `/book`** (no login), mobile-first, fast:
   1. Service (Self-Drive / With Driver)
   2. Dates and times (+ destination, trip type for With Driver)
   3. Available vehicles only (no active hold overlapping, buffer included), with category, transmission, seats if known, and **price for the chosen dates** from the active rate card
   4. Details form (fields by service, mirroring the booking record and Rework fields: name, phone, email, birthday, address, alternative contact, license no., IDs, delivery/pick-up address, passengers, luggage, itinerary, special requests, payment preference)
   5. Summary with full price breakdown; note "New clients get 5% off — applied on your formal quotation"; delivery fee "to be confirmed" if an address is given
   6. Privacy consent checkbox (Philippine Data Privacy Act, RA 10173) with a link to a privacy notice page; Turnstile; submit
   7. Thank-you screen with request reference and the business contact channels
3. **Abuse controls**: Turnstile verify server-side, honeypot field, rate limit per IP (5 submissions/hour), server-side validation with the same zod schemas.
4. **Inquiries**: submission creates `inquiries` row, a client (link to an existing client only on exact phone match; otherwise new, flagged "from website"), and a **draft** formal quotation priced by the engine. Nothing holds a car.
5. **Staff inbox** (`/inquiries`, Sales+): new requests with badge count; open → review prefilled draft → issue (normal flow) or reject with reason.
6. **Embedding**: `/book?embed=1` hides header/footer; CSP `frame-ancestors` from `PUBLIC_EMBED_ORIGINS`; `postMessage` height for auto-resizing iframes. Provide a copy-paste snippet on the settings page.
7. **Attribution capture**: UTM params, click ids, referrer on first visit (sessionStorage), sent with the inquiry.
8. **Rework** per `rework.md`: payload mapper with unit tests (snapshot of a full payload with invented data), token redaction helper with a test that no log line contains the token, outbox job, settings page (status, option map editor, date unit, "Send test lead", last 50 deliveries). Triggers per §2.
9. **E2E**: public flow end-to-end with Turnstile test keys; inquiry appears in staff inbox; outbox row created with the mapped payload (Rework call mocked in tests).

## Acceptance criteria

- [ ] Public page never shows a car that has an active hold for the chosen time.
- [ ] Prices on the public page equal the engine output for the same inputs (test).
- [ ] A real test lead appears in Rework with name, phone, dates, service and car type correct; date unit confirmed and recorded in PLAN decisions.
- [ ] The token never appears in logs, outbox rows, errors or the UI.
- [ ] Page works inside an iframe on the configured origin and is refused on others.
- [ ] Lighthouse mobile performance ≥ 90 on `/book`.
- [ ] Lint, typecheck, tests, e2e pass. Deployed on the custom domains.

## Out of scope

Online payment collection. Automatic confirmation of public requests.

## Hand-off

Progress log entry, including the Rework option map used. Ask before committing (branch `phase-4`).

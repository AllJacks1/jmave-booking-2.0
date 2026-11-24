# J-MaVe Booking 2.0 — Master Plan

Status: **approved for build**. Last edited: 2026-11-23.

## 1. Goal

One web system for J-MaVe Cars that:

1. Creates **quick quotations** (estimate, PDF) and **formal quotations** (numbered, PDF, share link) for **Self-Drive** and **With Driver** rentals.
2. Turns accepted quotations into **bookings**, tracks payments, and prevents **double booking** on a fleet **calendar**.
3. Replaces the **Daily Movement Sheet (DMS)** with a live board, including release/return check-in by Operations and a **shift roster**.
4. Tracks **customer rewards** (loyalty card, points, redemption).
5. Offers a public **booking page** on the company domain with live prices.
6. Sends every client intake to the **Rework** CRM as a lead.
7. Imports the old workbook (`Self-Driven and With Driver.xlsx`) and DMS workbook (`2026 Daily Movement Sheet.xlsx`) for migration.

Google Calendar is retired. The system has its own calendar. No Google sync.

## 2. Roles and permissions

Roles: `super_admin`, `admin`, `sales`, `operations`. One user has one role.

The first Super Admin is created on first run at `/setup` (see §6.4). Super Admin creates all other users.

| Action | super_admin | admin | sales | operations |
|---|---|---|---|---|
| Quick + formal quotations: create, edit, issue, PDF, share link, email | ✅ | ✅ | ✅ | — |
| Clients: view, create, edit | ✅ | ✅ | ✅ | — |
| Clients: set/clear blacklist | ✅ | ✅ | — | — |
| Bookings: create from quotation, edit, **confirm**, cancel | ✅ | ✅ | ✅ | — |
| Payments ledger: add entries | ✅ | ✅ | ✅ | — |
| Payments ledger: void entries | ✅ | ✅ | — | — |
| Calendar + Daily Movement board: view | ✅ | ✅ | ✅ | ✅ |
| Release / Return check-in (actual time, odometer, fuel) | ✅ | ✅ | ✅ | ✅ |
| Vehicle blocks (owner use, maintenance) | ✅ | ✅ | ✅ | — |
| Drivers list, driver assignment | ✅ | ✅ | ✅ | — |
| Shift roster: edit | ✅ | ✅ | — | — |
| Shift roster: view | ✅ | ✅ | ✅ | ✅ |
| Rewards: view, redeem on a quotation | ✅ | ✅ | ✅ | — |
| Rewards: manual point adjustment | ✅ | ✅ | — | — |
| Fleet (vehicles): edit | ✅ | read-only | — | — |
| Rate cards, holidays, pricing settings | ✅ | **read-only** | — | — |
| Users: manage super_admin/admin | ✅ | — | — | — |
| Users: manage sales/operations | ✅ | ✅ | — | — |
| Excel import | ✅ | **read-only** (view runs) | — | — |
| Rework settings, system settings | ✅ | **read-only** | — | — |
| Hard delete of any record | ✅ | — | — | — |
| Audit log: view | ✅ | ✅ | — | — |

Operations users land on the Daily Movement board. Everything else they see is read-only.

All checks live in `src/lib/permissions.ts` as a single table: `can(user, action, resource?)`. Unit-test the table.

## 3. Architecture

### Railway services

| Service | What | Notes |
|---|---|---|
| `web` | Next.js app (staff app + public pages + API) | `pnpm build && pnpm start` |
| `worker` | Node process running `pg-boss` jobs | Rework deliveries, emails, expiry sweeps. Same repo, entry `src/worker/index.ts`. Added in Phase 3. |
| `postgres` | Railway Postgres | Needs the `btree_gist` extension (Phase 2a). |

### Environment variables (`.env.example` lists all, values empty)

| Name | Phase | Purpose |
|---|---|---|
| `DATABASE_URL` | 1a | Postgres |
| `BETTER_AUTH_SECRET` | 1a | Session signing |
| `APP_URL` | 1a | Public base URL, e.g. `https://app.jmavecars.com` |
| `SETUP_TOKEN` | 1a | One-time token required by `/setup` |
| `RESEND_API_KEY`, `EMAIL_FROM` | 3 | Sending quotations by email |
| `REWORK_WEBHOOK_URL` | 4 | `https://webhooks.rework.com/leads/source/leadgen` |
| `REWORK_WEBHOOK_TOKEN` | 4 | Rework source token. Sent as `?token=`. Must be redacted in logs. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | 4 | Spam protection on public page |
| `PUBLIC_EMBED_ORIGINS` | 4 | Comma list of origins allowed to iframe `/book` (CSP `frame-ancestors`) |

### Folder layout

```
src/
  app/
    (auth)/login, (auth)/setup
    (staff)/            dashboard, quotes, bookings, calendar, board, clients, rewards,
                        fleet, rates, roster, users, import, settings, audit
    (public)/book       public booking page (Phase 4)
    (public)/q/[token]  read-only shared quotation (Phase 1c)
    api/                route handlers (PDF, webhooks, health)
  components/           shadcn ui + app components
  db/                   schema.ts, client.ts, migrations/
  lib/
    auth/               Better Auth config + session helpers
    permissions.ts
    pricing/            pure engine: self-drive.ts, with-driver.ts, rate-card.ts, types.ts, *.test.ts
    pdf/                react-pdf documents
    import/             workbook readers + mappers
    numbering.ts        QTN / JMV sequences
    money.ts, time.ts, phone.ts
    rework/             payload mapper + client (Phase 4)
  worker/               pg-boss entry + jobs (Phase 3+)
docs/                   this plan, phase briefs, reference
migration/source/       the two .xlsx files (gitignored)
```

## 4. Data model (target — each phase adds its tables)

| Table | Phase | Key columns |
|---|---|---|
| Better Auth tables (`user`, `session`, `account`, `verification`, `rate_limit`) | 1a | `user.role`, `user.active`, `user.display_name`, `user.rework_owner_id`, `user.must_change_password` |
| `audit_log` | 1a | actor_id, action, entity, entity_id, before jsonb, after jsonb, at |
| `settings` | 1a | key (pk), value jsonb. Business name/address/phones/email, default fuel prices, quote validity hours (24), turnaround buffer minutes (60), Rework toggles |
| `vehicles` | 1b | display_name, plate (unique), make, model, year, color, transmission, chassis_no, engine_no, engine, body_type enum (`compact, sedan, wagon, mpv, suv, pickup, van`), fuel_type (`gasoline, premium, diesel`), tank_capacity_l, ownership (`owned, operator, hired`), operator_name, daily_rate_display, active, sort_order |
| `rate_cards` | 1b | version, status (`draft, active, archived`), effective_from, data jsonb (validated by zod `RateCardData`), created_by. Exactly one `active`. |
| `holidays` | 1b | date (unique), name |
| `clients` | 1b | full_name, fb_name, phone, email, birthday, address, alt_contact_name, alt_contact_phone, drivers_license_no, company_name, client_type (`individual, corporate`), is_blacklisted, blacklist_reason, first_rental_at, source, notes |
| `number_sequences` | 1b | key (pk, e.g. `QTN-2026`, `QTN-WD2026`, `JMV`), last_value |
| `import_runs` | 1b | file_name, kind, status (`previewed, committed, failed`), summary jsonb, created_by |
| `quotations` | 1c | number (null for quick), kind (`quick, formal`), service (`self_drive, with_driver`), status (`draft, issued, accepted, expired, lost, cancelled`), client_id, vehicle_id, body_type, category, start_at, end_at, inputs jsonb, result jsonb (priced lines + totals snapshot), rate_card_id, total_centavos, valid_until, consultant_id, share_token (unique, random 32 bytes), issued_at |
| `bookings` | 2a | number (= quotation number), quotation_id, client_id, vehicle_id, service, status, start_at, end_at, destination, delivery_address, pickup_address, driver_id, driver_name_on_license, drivers_license_no, ids_presented, source_channel, rework_link, or_issued, notes, created_by, confirmed_by, confirmed_at |
| `vehicle_holds` | 2a | vehicle_id, kind (`booking, block`), booking_id, block_reason, period tstzrange (includes turnaround buffer), active. **Exclusion constraint**, see §6.2 |
| `booking_charges` | 2a | booking_id, kind (`quoted, excess_km, fuel_shortage, extension, ot, damage, other`), label, amount_centavos, source (`quote, check_in, manual`) |
| `payments` | 2a | booking_id, type (`reservation_fee, delivery_fee, rental, deposit, deposit_refund, change_given, other`), direction (`in, out`), amount_centavos, method (`cash, gcash, card, bank, other`), reference, collected_by_user_id, collected_by_name, paid_at, note, voided_at, voided_by |
| `drivers` | 2a | name, phone, active |
| `movement_events` | 2b | booking_id, vehicle_id, kind (`release, return, extension`), planned_at, actual_at, odometer_km, fuel_level_eighths (0–8), delivery (bool), recorded_by, notes |
| `shift_templates` | 2b | name, start_time, end_time (e.g. 21:00–06:00 crosses midnight) |
| `shift_assignments` | 2b | date, user_id, template_id, duty (`operations, sales`) |
| `loyalty_accounts` | 3 | client_id (unique), card_no (`JMV-0001`), member_since, expires_at, tier |
| `points_ledger` | 3 | account_id, booking_id, kind (`earn, redeem, adjust, import`), points (signed int), note, created_by |
| `inquiries` | 4 | public form payload jsonb, status (`new, quoted, converted, rejected`), client_id, quotation_id, utm jsonb |
| `outbox` | 3 | kind (`rework_lead`, `email`), payload jsonb, status (`pending, sent, failed`), attempts, last_error, response jsonb, sent_at |

## 5. Phases

Each brief in `docs/phases/` is one build session. Do them in order. Each ends with a working, deployed app.

| # | Brief | Delivers | Depends on |
|---|---|---|---|
| 1a | `phase-1a-foundation.md` | Repo scaffold, Railway deploy, DB, auth, `/setup`, roles + permissions, user admin, app shell, settings, audit helper | — |
| 1b | `phase-1b-pricing-and-import.md` | Fleet, rate cards, holidays, clients + blacklist, Excel import (fleet, rates, clients, blacklist, QTN counters), **pricing engine** with golden tests | 1a |
| 1c | `phase-1c-quotations-and-pdf.md` | Quick quotation, formal quotation, numbering, PDFs, share link, quotation list. **MVP complete.** | 1b |
| 2a | `phase-2a-bookings-and-calendar.md` | Bookings from quotations, holds + double-booking guard, vehicle blocks, payments ledger, drivers, fleet calendar, history import | 1c |
| 2b | `phase-2b-movement-board-and-operations.md` | Daily Movement board, release/return check-in, actual charges, shift roster, board PDF | 2a |
| 3 | `phase-3-rewards-and-email.md` | Loyalty accounts, points earn/redeem, loyalty import, worker service, email sending | 2b |
| 4 | `phase-4-public-booking-and-rework.md` | Public `/book` page with prices, inquiries, Rework lead webhook via outbox | 3 |
| 5 | `phase-5-hardening.md` | Audit viewer, backups, monitoring, staging, e2e suite, performance, security review | 4 |

Reference docs (read only what a brief lists):

- `docs/reference/pricing.md` — every pricing rule, rate table location, bug fixes, golden test cases
- `docs/reference/import-map.md` — workbook tabs, columns and cell ranges to import
- `docs/reference/quote-documents.md` — PDF layouts and terms text
- `docs/reference/bookings-and-movement.md` — booking record, statuses, payments, DMS board, roster
- `docs/reference/rework.md` — Rework webhook contract and field mapping
- `docs/reference/workbook/*.txt` — raw formula dumps of the pricing sheets (no client data)

## 6. Key mechanisms

### 6.1 Numbering

- Self-Drive formal quotation: `QTN-{YYYY}-{NNN}` (e.g. `QTN-2026-929`). With Driver: `QTN-WD{YYYY}-{NNN}` (e.g. `QTN-WD2026-119`). These match the old logs.
- `NNN` is zero-padded to 3 digits, grows past 999 without truncation, resets each calendar year (Asia/Manila).
- The import sets each sequence to the highest number found in `Rental Log` / `WD Rental Log`, so numbering continues.
- Allocate inside the issuing transaction with `SELECT … FOR UPDATE` on `number_sequences`. Never reuse a number.
- Quick quotations have **no** QTN number. They show "ESTIMATE" and can be promoted to a formal quotation, which then takes the next number.
- Loyalty card: `JMV-{NNNN}`, continues from the highest imported.

### 6.2 Double booking

- Every confirmed or released booking, and every vehicle block, owns one row in `vehicle_holds`.
- `period = tstzrange(start_at, end_at + turnaround_buffer, '[)')`.
- Constraint: `EXCLUDE USING gist (vehicle_id WITH =, period WITH &&) WHERE (active)` (needs `CREATE EXTENSION btree_gist`). Drizzle cannot express this; add it as raw SQL in a migration.
- `pending_reservation` bookings do **not** hold the car (business rule: "Vehicle is NOT reserved until booking has been confirmed"). The calendar shows them striped and warns on overlap.
- Confirming a booking inserts the hold. If the insert hits the constraint, show the conflicting booking and refuse.
- Extensions update the hold period in the same transaction; same conflict rule.
- Cancel, no-show and closed set `active = false`. On actual return, the hold end becomes actual return time + buffer.

### 6.3 Pricing engine

- Pure functions: `priceSelfDrive(input, rateCard, ctx)` and `priceWithDriver(input, rateCard, ctx)` return `{ lines[], subtotal, discounts[], total, payable{}, warnings[] }` in centavos.
- `ctx` carries holidays, client repeat status, today's date. No DB access inside the engine.
- Every quotation stores the full `inputs`, `result` and `rate_card_id`. Re-opening an old quotation shows the stored result; re-pricing is an explicit action.
- Rules, tables and golden cases: `docs/reference/pricing.md`.

### 6.4 First-run setup

- `/setup` works only while the `user` table is empty **and** the request includes the correct `SETUP_TOKEN` (form field, compared in constant time).
- It creates the first `super_admin` in a transaction that re-checks the table is empty (no race).
- After that, `/setup` returns 404 forever. Login page shows a "System not set up" notice while no users exist.

### 6.5 Sharing and PDFs

- PDFs are generated on request from the stored `result` (no files stored). Route: `GET /api/quotations/[id]/pdf` (staff, permission-checked) and `GET /q/[token]/pdf` (public via share token).
- Share link `/q/[token]` shows the client copy read-only and a PDF download. It works until 30 days after `valid_until`, then shows "expired, contact us".
- Phase 3 adds "Send by email" (PDF attached) through the worker.

### 6.6 Outbox

External calls (Rework, email) never run inside a user request. The request writes an `outbox` row; the worker sends it with retries (exponential backoff, max 8 attempts) and records the response.

## 7. Decisions log

| Date | Decision |
|---|---|
| 2026-11-23 | Stack: Railway, Next.js, Tailwind, shadcn/ui, lucide-react; Drizzle, Better Auth, react-pdf, exceljs, pg-boss. |
| 2026-11-23 | Fix the old workbook's pricing bugs (list in `pricing.md` §6). |
| 2026-11-23 | Admin is read-only on rate cards, holidays, import, Rework settings, system settings. |
| 2026-11-23 | Sales and above can confirm bookings. |
| 2026-11-23 | Rewards: earn 50 points per rental day. 50 points = ₱1. Redeem as peso discount or free hours. |
| 2026-11-23 | Free hours are priced at the car's hourly extension rate (e.g. Sedan ₱300/hr = 15,000 points). |
| 2026-11-23 | With Driver: the old hidden +₱500 becomes a visible **Service fee** line. |
| 2026-11-23 | Public booking page shows prices. |
| 2026-11-23 | Keep 24-hour quotation validity and continue the QTN sequences. |
| 2026-11-23 | System and booking page run on the company domain. |
| 2026-11-23 | Operations can view calendar/board and record Release/Return with actual time, odometer, fuel. |
| 2026-11-23 | Own calendar; no Google Calendar sync. |
| 2026-11-23 | Shift roster is part of the system. |
| 2026-11-23 | Rework token is sent as the `token` URL parameter; lives only in `REWORK_WEBHOOK_TOKEN`. |
| 2026-11-23 | Next.js 16: `cacheComponents` off (every staff page depends on the signed-in user); auth gate lives in `src/proxy.ts` (Next 16's name for middleware). |
| 2026-11-23 | shadcn `form` no longer exists in the registry: forms use shadcn `field` + react-hook-form `Controller` + zod (`src/components/form-fields.tsx`). |
| 2026-11-23 | Server actions return `ActionResult` with an HTTP-like `status` (403 forbidden, 401 signed out, 400 invalid, 404, 409 conflict). Actions are built as `run(actor, input)` via `defineAction` so tests call the same path per role. Route handlers return real HTTP statuses. |
| 2026-11-23 | Settings stored per key: `business`, `fuel_prices_centavos` (per litre), `quote_validity_hours`, `turnaround_buffer_minutes`. Defaults in `src/lib/settings/schema.ts`, written on first-run setup. Business phones stored E.164. |
| 2026-11-23 | Nobody can deactivate their own account. The last active Super Admin check locks Super Admin rows (`FOR UPDATE`). Deactivate and password reset revoke the user's sessions. |
| 2026-11-23 | Better Auth rate limits stored in Postgres (`rate_limit`): sign-in and change-password 10/min per IP. |
| 2026-11-23 | Railway: Config as Code (`railway.json`) is deprecated (ends 2026-12-01). Service config (build `pnpm build`, start `pnpm start`, pre-deploy `pnpm db:migrate`, health check `/api/health`) is set on the `web` service; `.railway/railway.ts` mirrors it. `railway config plan/apply` currently fails on Windows (SDK version check), so the settings were applied with the Railway API. Keep `.railway/railway.ts` in step by hand: when a deploy setting changes on Railway, make the same change in the file, and vice versa. |
| 2026-11-23 | Railway region: Singapore (`asia-southeast1-eqsg3a`) for both `web` and `Postgres` (moved from US East while the DB was empty), closest to Davao. |
| 2026-11-23 | Test databases must be named `*_test` / `*_e2e`; the reset helper refuses anything else. |
| 2026-11-23 | Import upload limit is **40 MB**, not 20 MB: the booking workbook is 28 MB (mostly images). Upload goes through `POST /api/import` (route handler); `experimental.proxyClientMaxBodySize = 45mb` because the proxy buffers bodies (10 MB default). `exceljs` is a server external package. |
| 2026-11-23 | With Driver night differential: none on the **24h tier** (the 24h driver rate already covers the whole day; matches golden WD-2 and the old sheet, where `TIME(24,0,0)` = 0). For other tiers the overlap with 22:01–06:00 also counts the night before the start date (the old sheet missed early-morning starts). Confirm with the owner. |
| 2026-11-23 | Additional-hours blocks are stored per rate row (body type + category). Categorised rows use that category's 8h / 12h daily rate, as the old formulas do (`FORMULA!S58 = K38`, `FORMULA WDRIVER!E97 = G20`); pricing.md lists the snapshot values (primo for Self-Drive, premium sedan for With Driver), which these rows contain. |
| 2026-11-23 | Rate-card values that live inside formulas, not table cells (terminal fee, 150 km allowance, OT premium, beyond-hours, promos, new-client and 7-day discounts, holiday ×2, service fee, rounding step, fuel factor 2.2, night diff 10%), come from pricing.md. Percentages are stored as basis points, the fuel factor as tenths. |
| 2026-11-23 | Imports never erase: a blank workbook value leaves the DB value alone; fields only staff set (active, sort order) are untouched; an import never overwrites an active or archived rate card (a differing one is "skipped"); an imported draft is updated only if it came from the same source. Sequences only go up. |
| 2026-11-23 | Client import grouping: rows sharing any phone or email are one client; a row without phone/email joins the single client with the same full name + FB name, otherwise it is its own client (warned). Numbers that are not valid PH numbers (foreign or mistyped) are kept in `notes`, not in `phone`. Blacklist rows that match several clients by name change nothing (warning). |
| 2026-11-23 | `import_runs` also stores `file_sha256`, `file_size`, `payload` (parsed rows between Preview and Commit, cleared on commit), `error`, `committed_by`, `committed_at`. Commit re-plans inside its transaction under an advisory lock. |
| 2026-11-23 | Pick-up/drop-off and airport-transfer packages are priced as one trip (days = 1, with a warning). The holiday multiplier applies to the per-day driver fee everywhere it is used (standby, night differential). |
| 2026-11-23 | Payable block: "due today" = reservation fee + its terminal fee + delivery fee; balance on release = total contract value − due today (same as pricing.md when paid in cash). |
| 2026-11-23 | Clients: phone and email must be unique on manual create/edit (409 names the other client). "Repeat client" = `first_rental_at` is set (Phase 2a bookings will set it too). |
| 2026-11-24 | New permission `quotes.override_blacklist` (Admin and up): issue a quotation for a blacklisted client with a reason (stored on the quotation + audit). Sales get 403. Issuing a formal quotation needs a client. |
| 2026-11-24 | Quotation pages call `forbidden()` (Next `experimental.authInterrupts`) so Operations get a real **403**, not a 200 "No access" page. `/dashboard` is a quotations page too (Operations land on `/board`). |
| 2026-11-24 | Share link lifetime follows PLAN §6.5, not the brief: between `valid_until` and +30 days `/q/[token]` still shows the quotation with an "expired, contact us" notice; after that, or once cancelled (revised), only the message and business contacts show. |
| 2026-11-24 | A saved quick quotation is `kind=quick, status=issued`, no number, no share token, valid for `quote_validity_hours`. "Download PDF" saves it first (PDFs come from stored results). "Make formal" copies its inputs into a new formal draft. |
| 2026-11-24 | Self-Drive days from release → return (overridable): ≤ 8 h / ≤ 12 h / ≤ 24 h = one day on that tier; longer = whole 24 h days, a remainder ≤ 8 h or ≤ 12 h becomes that additional-hours block, a longer remainder one more day. OT premium slot from times: the release slot, else the return slot (PLAN Q10), overridable. |
| 2026-11-24 | With Driver form: start date + start time, end time (same every day; crosses midnight when not after the start), days. `end_at` = first day's end + (days − 1) days. |
| 2026-11-24 | `quotations` extra columns: `client_name`, `snapshot` (client / vehicle / consultant names frozen at save/issue), `notes` (internal), `status_note` (lost reason, "Revised by QTN-…"), `blacklist_override_reason/by`, `created_by`. `total_centavos` = Self-Drive rental total, With Driver grand total. Inputs are one flat form (`src/lib/quotes/schema.ts`) for both services. |
| 2026-11-24 | Status rules: accept only an issued, unexpired quotation (409 otherwise); lost allowed on issued or expired; revise from issued, accepted, expired or lost; one open revision draft per source. |
| 2026-11-24 | PDFs use the Geist TTF from the `geist` npm package (built-in PDF fonts have no ₱ glyph). Text wordmark until `public/brand/logo.png` exists (picked up automatically). |
| 2026-11-24 | Copy text: the rental line carries the day count ("Rental rate (1 day)"); estimates say ESTIMATE and add "Estimate only…"; card terminal fee and With Driver grand total get their own lines when present. |

## 8. Open questions (build with the default; confirm with the owner when possible)

| # | Question | Default used until answered |
|---|---|---|
| Q1 | The old sheet also rounded With Driver line totals up to the next ₱100 before adding ₱500. Keep the rounding? | Keep it, shown as a visible "Rounding adjustment" line. |
| Q2 | Self-Drive fuel cost: always charge the estimated fuel, or only when the client prepays fuel? | A per-quote switch "Include estimated fuel", default **on**. |
| Q3 | `QP FORMULA` holds a second, lower set of rates ("quotation purpose"). Which set is current? | Import `FORMULA` as the active rate card, `QP FORMULA` as a **draft** rate card. |
| Q4 | The With Driver "Pick up/Drop off Rate" table (Compact ₱899 … SUV ₱2,500) is not used by the old formulas. Use it for Pick-up/Drop-off packages? | Not used (same as old sheet); table is imported and stored for later. |
| Q5 | Loyalty tier thresholds and whether points expire. | Tier imported as-is and editable by Super Admin; points do not expire; membership valid 1 year. |
| Q6 | Fuel shortage on return: how to charge? | (tank capacity × missing eighths ÷ 8) × fuel price from settings, rounded up to ₱1. |
| Q7 | Hourly extension rate for Van is missing from the old table. | ₱500/hr, editable in rate card. |
| Q8 | "City Saver" / "City Saver Plus" promos set a flat ₱4,799 / ₱5,299 rental regardless of days. Is it per day? | Flat per booking, as in the old sheet; editable promo package in rate card. |
| Q9 | With Driver on a holiday: the old sheet seems to intend double driver's fee but never applied it. | Driver's fee × 2 on holidays (from the holiday list, overridable per quote). |
| Q10 | Self-Drive OT premium table (₱500 for 7:01 PM–1:00 AM, ₱300 for 1:01–6:00 AM) existed but was not wired. | Charged once when release or return falls in the slot. |
| Q11 | Late return grace period. | 60 minutes; after that all late hours are charged. |
| Q12 | When a loyalty card expires, what happens to points and the card? | Card shows expired; points kept; the next returned booking renews the card for 1 year. |

## 9. Progress log

Append one entry per session. Newest last.

<!-- Template:
### YYYY-MM-DD — Phase Xx — <session summary>
- Built:
- Not done / deferred:
- Known issues:
- Decisions made (also added to §7):
- Deployed: yes/no (URL)
-->

### 2026-11-23 — Phase 1a — Foundation
- Built:
  - Next.js 16.4 (App Router, TS strict), Tailwind 4, shadcn/ui (radix-nova), lucide-react, Geist via `next/font`. Scripts: dev, build, start, lint, typecheck, test, e2e, db:generate, db:migrate, db:studio.
  - Drizzle + `postgres` driver; migration `0000_init` (Better Auth tables incl. `rate_limit`, `settings`, `audit_log`). UUID ids everywhere.
  - Better Auth: email + password, sign-up disabled and the endpoint returns 404, DB-backed rate limiting, inactive users blocked at session creation, `must_change_password` forces `/change-password`. `src/proxy.ts` sends signed-out users to `/login`.
  - `/setup` per §6.4: constant-time token check, advisory lock + re-check in one transaction, seeds default settings, audit row, 404 once any user exists. Login shows "System not set up" while no users exist.
  - `src/lib/permissions.ts`: full §2 table (30 actions, all phases), `can()` + `requirePermission()`, admin limited to managing Sales/Operations.
  - App shell: collapsible sidebar (sheet on mobile) filtered by role, top bar with user menu (profile, change password, sign out) and light/dark toggle. Placeholder pages show "Coming in Phase N" to roles that will have access; others see "No access". Operations lands on `/board`, others on `/dashboard`.
  - `/users`: list, create (temporary password shown once), edit name/display name/role, deactivate/reactivate, reset password. Last active Super Admin protected.
  - `/settings`: business details, fuel prices, quote validity, turnaround buffer. Super Admin edits, Admin read-only. Each changed key writes an `audit_log` row with before/after.
  - `withAudit()` helper (secrets redacted), `GET /api/health`, `.env.example`, `scripts/setup-local.ps1` (local DBs + `.env.local`).
  - Tests: Vitest unit (permissions matrix, nav by role, phone, money) + integration against a throwaway DB (forbidden action per role, users rules, settings audit, setup token and race). Playwright: fresh system → setup (wrong/right token, then 404) → sign-up 404 → create Sales → Sales forced password change → no Users/Settings menu, `/users` shows No access → settings save.
- Results: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 220/220, `pnpm e2e` 5/5.
- Deployed: yes — Railway project `jmave-booking` (services `web`, `Postgres`, region Singapore `asia-southeast1-eqsg3a`), https://web-production-b67727a7.up.railway.app. `/api/health` → `{ ok: true }`; pre-deploy migrations ran (tables exist, `/setup` serves, login shows "System not set up").
- Not done / deferred:
  - First Super Admin on production not created yet: the owner opens `/setup` with `SETUP_TOKEN` from Railway Variables.
  - No GitHub remote; deploys are `railway up` from a local checkout.
  - Custom domain (Phase 4).
- Known issues:
  - `railway config plan/apply` fails on Windows ("requires Railway CLI 5.42.1 or newer") because the `railway/iac` SDK finds the CLI through `$_`. Service settings were set through the Railway API instead; keep `.railway/railway.ts` in step by hand.
  - Global npm installs from inside the Claude desktop app go to its virtualised AppData; install CLIs from your own terminal.
- Decisions made (also added to §7): Cache Components off + `proxy.ts`; shadcn `field` instead of `form`; `ActionResult` statuses for server actions; settings keys; self-deactivation blocked and sessions revoked; DB rate limits; Railway config via service settings; Railway region Singapore; test DB naming guard.

### 2026-11-23 — Phase 1b — Fleet, rates, clients, import, pricing engine
- Built:
  - Pricing engine `src/lib/pricing/` (pure; ESLint bans `@/db`, drizzle, postgres and server-only there, and a unit test checks it): `RateCardData` zod schema for every table in pricing.md §1–§3 (centavos), `priceSelfDrive`, `priceWithDriver`, typed lines (`code`, `label`, `remark`, `amount`), exact BigInt rounding (half-up per line). All golden cases SD-1…6 and WD-1…5 pass exactly, plus edge tests (0 km, >500 km, band edges, 8/10/12/24 tier edges, 14/15/29/30 days, holiday, card vs cash vs GCash, blank inputs, invalid combinations).
  - `time.ts` (Asia/Manila, Excel serials), `phonesFromCell`, `centavosFromCell`, with tests.
  - Migration `0001_phase_1b`: `vehicles`, `rate_cards` (partial unique index: one active), `holidays`, `clients` (indexes on phone, `lower(email)`, `pg_trgm` GIN on full name and FB name), `number_sequences`, `import_runs`.
  - Import (`src/lib/import/`): upload (Super Admin, .xlsx, ≤ 40 MB, zip signature, must open) → parse with exceljs (cached values) → per-section plan → Preview at `/import/[id]` (counts, warnings, expandable rows) → Commit in one transaction with an audit row. Sections: fleet (SPECS + Back bone), rate cards (v1 active, v2 draft), clients (Rental Log + WD Rental Log), blacklist (DMS), sequences. Rate-card self-check against pricing.md.
  - Pages: `/fleet` (table + edit dialog, Super Admin; Admin read-only), `/rates` (card list, active card as tables, view, draft editor with validation, Activate with archive + audit, New draft), `/rates/compare` (side by side + list of differences), `/rates/holidays`, `/rates/playground` (Admin+, live engine for both services), `/clients` (search by name, FB name, phone, email; blacklist filter and badge; paging), `/clients/new`, `/clients/[id]` (detail, repeat/new badge, rental-history placeholder), `/clients/[id]/edit`, blacklist with reason (Admin+), `/import` (upload + runs; Admin read-only).
  - Tests: unit (engine, rate card, time, phone, money, workbook parsing with invented workbooks in `tests/fixtures/workbooks.ts`), integration (import commit and re-run idempotency, sequences never lowered, active card not overwritten, blacklist matching, permissions per role, rate-card draft/edit/activate, holidays, clients, fleet), e2e `tests/e2e/phase-1b.spec.ts` (import preview/commit/re-run, rates, playground SD-1, blacklist badge, Admin read-only, Sales no access).
- Results: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 355/355 (12 files), `pnpm e2e` 10/10.
- Real workbooks, imported locally into the dev database (counts only):
  - Booking workbook: fleet 20 new; rate cards v1 active + v2 draft; clients 1,130 new; 4 sequences. **Rate card v1: 0 mismatches with pricing.md.** v2 (QP FORMULA) differs from v1 in 26 values.
  - DMS workbook: 8 blacklist rows → 3 existing clients flagged, 5 new blacklisted clients created.
  - Re-running both files: **0 new, 0 changed, 0 skipped.**
  - Sequences: `QTN-2026` = **928**, `QTN-WD2026` = **118** (also `QTN-2025` = 810, `QTN-WD2025` = 46).
- Warnings the owner must review (all shown in the import preview):
  - Fleet: 2 vehicles are in `Back bone` but not in `SPECS` (added with fewer details); 1 SPECS vehicle has no plate (matched by name); 1 SPECS plate was taken from `Back bone`.
  - Clients (516 warnings): 23 log rows without a client name skipped; 143 contact numbers are not valid PH numbers (foreign or mistyped; kept in the client's notes); about 69 birthdays unreadable or out of range (left blank); 13 invalid emails ignored; about 268 clients have no phone or email (matched by name + FB name only).
  - Rate cards: the van hourly extension rate is missing in both FORMULA and QP FORMULA (₱500 used, PLAN Q7); `Back bone WDRIVER` has an "MGZ" excess-hour row that is not a body type (ignored); the wagon "Within Davao City" long-term rate is higher than MPV (flagged on the rate-card page).
- Pricing rules that needed interpretation (see §7): night differential on the 24h tier; additional-hours blocks by category; constants that are not table cells; transfer packages priced as one trip; holiday multiplier scope; "due today" includes the reservation terminal fee.
- Not done / deferred:
  - **Not deployed**: the deploy command was blocked by this session's permission rules. Run `railway up --service web`; the pre-deploy step runs migration `0001_phase_1b` (it creates the `pg_trgm` extension). Then import both workbooks on production at `/import`.
  - Holiday list is empty: add holidays at `/rates/holidays` (the DMS `HOLIDAYS` tab is not imported; it is not in this brief).
  - Hired vehicles (e.g. the hired van in the DMS) are added by hand at `/fleet` with ownership "Hired".
- Known issues:
  - Parsing the booking workbook takes about 4 s and about 700 MB of memory (exceljs loads it whole). Fine on Railway; watch memory if the file grows.
  - Re-importing does not rename existing rate cards (names are not compared).
- Decisions made (also added to §7): upload limit 40 MB; night differential on 24h; additional hours by category; pricing.md constants; imports never erase; client grouping; `import_runs` extra columns; transfer packages as one trip; payable "due today"; client phone/email uniqueness and the repeat-client rule.
- Deployed: no (see above).

### 2026-11-24 — Phase 1c — Quotations and PDFs
- Built:
  - Migration `0002_phase_1c`: `quotations` (PLAN §4 + `revised_from_id`, `client_name`, `snapshot`, `notes`, `status_note`, blacklist override columns, `created_by`), enums `quotation_kind`, `service`, `quotation_status`; trigram index on client name.
  - `src/lib/numbering.ts`: `nextNumber(tx, key)` (`SELECT … FOR UPDATE`), keys `QTN-{Manila year}` / `QTN-WD{year}`, 3-digit padding, grows past 999.
  - Pure modules: `src/lib/pricing/schedule.ts` (Self-Drive days/tier/block/OT slot from dates; With Driver window), `src/lib/quotes/` (`schema` shared form, `engine` form → engine, `document` view model + formatters + copy text + file names, `terms` client text, `defaults`).
  - `src/lib/quotes/service.ts`: live price preview, quick save, draft autosave, issue (re-prices with the active card inside the transaction, blacklist gate, number, validity from settings, share token, snapshot, cancels the revised quotation), revise, mark lost / accepted, list with filters, dashboard, share-token lookup. Audit rows for quick save, issue, cancel, revise, lost, accepted.
  - Pages: `/quotes/quick`, `/quotes/new`, `/quotes/[id]` (editor for drafts and estimates; read-only client copy + actions + internal panel once issued), `/quotes` (status, service, type, consultant, date range, search by number or client), `/dashboard` (expiring in 6 h, my quotes today, recent). Client picker with inline new client; blacklist warning; repeat/new detection with override.
  - PDFs (`src/lib/pdf/quotation.tsx`, `@react-pdf/renderer`, Geist font): estimate, Self-Drive and With Driver layouts per quote-documents.md. Routes `GET /api/quotations/[id]/pdf` (staff) and `GET /q/[token]/pdf` (public). Public share page `/q/[token]` (noindex, no staff data).
  - `forbidden()` + `src/app/forbidden.tsx`: quotation pages return 403 to Operations.
  - Fixed a Phase 1b engine bug: the fuel line remark showed the distance ÷ 100 ("12 km" for 1,200 km). Amounts were right.
  - Tests: unit (schedule, form mapping, SD-2 copy text exactly as the brief, WD-1/WD-5, formats, file names, PDF smoke renders incl. long names and 15+ lines, fuel remark), integration (20 parallel issues → 929…948 gap-free; rollback burns no number; WD key/year/padding; first SD issue after import = `QTN-2026-929`; rate-card change leaves issued quotations alone; blacklist 403 for Sales, reason required for Admin; revise/cancel; lost/accepted/expired; quick save; Operations 403 on every action), e2e `tests/e2e/phase-1c.spec.ts` (quick SD-2 → copy text + PDF; formal with new client → issue `QTN-2026-110` → copy text → staff PDF → share link signed out shows no internal data → public PDF; blacklisted client blocked for Sales; Operations 403 on pages and PDF route).
- Results: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 414/414 (16 files), `pnpm e2e` 14/14.
- Not done / deferred:
  - **Not deployed** (needs the owner's go-ahead; Phase 1b is also still undeployed). `railway up --service web` runs migrations `0001` and `0002` on pre-deploy.
  - No logo yet: PDFs and the share page use a text wordmark; dropping `public/brand/logo.png` in is picked up by the PDFs automatically (share page still shows the wordmark).
  - "Expired" is computed on read; the nightly job is Phase 3. Email sending is Phase 3.
- Known issues:
  - PDF text copied out of a viewer loses ligatures ("confrmed") because Geist uses fi/tt ligatures; the printed page is correct.
  - E2E sign-ins hit Better Auth's 10/min limit; `phase-1c.spec.ts` reuses sessions and waits out the limit once (the Operations test takes ~1 min).
- Decisions made (also added to §7): `quotes.override_blacklist`; `forbidden()` for 403; share-link lifetime per PLAN §6.5 (brief differs); quick quotations saved as numberless issued estimates; Self-Drive schedule from dates; With Driver form shape; extra `quotations` columns and `total_centavos` meaning; status transition rules; Geist PDF font; copy-text details.
- Deployed: no.

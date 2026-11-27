# J-MaVe Booking 2.0 — Master Plan

Status: **approved for build**. Last edited: 2026-11-27.

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
| `backup` | Cron service (Phase 5), `ops/backup/Dockerfile` (postgres:18 + aws-cli) | Nightly `pg_dump` to an S3-compatible bucket at 02:00 Manila; off until `BACKUP_S3_*` is set. |

Live names (2026-11-27): the web service is **`jmave-booking-2.0`** (deploys GitHub `main`). Environments: `production` (app, Postgres, backup; **no worker yet**) and `staging` (app, Postgres, worker, backup; invented data). See `.railway/railway.ts`, `docs/ops/staging.md`, `docs/ops/backups.md`.

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
| `PUBLIC_BOOK_HOST` | 4 | Public booking hostname(s), e.g. `book.jmavecars.com`: every path there is served from `/book/*`; staff routes are not served |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | 5 | Error reports (web server / browser). Worker: its own `SENTRY_DSN` on Railway (`SENTRY_WORKER_DSN` locally). Empty = off |
| `SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | 5 | `production` / `staging` |
| `SENTRY_AUTH_TOKEN` | 5 | Optional: source-map upload at build time |
| `SENTRY_TRACES_SAMPLE_RATE`, `LOG_LEVEL` | 5 | Optional tuning (default 0 / info) |
| `TRUSTED_PROXY_HOPS` | 5 | Proxies that append to `X-Forwarded-For` (default 1 = Railway edge; 2 behind a CDN) |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_REGION`, `BACKUP_S3_PREFIX` | 5 | `backup` cron service only |
| `SEED_PASSWORD` | 5 | Staging only: password of the seeded staff accounts |

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
| `inquiries` | 4 | public form payload jsonb, status (`new, quoted, converted, rejected`), client_id, quotation_id, utm jsonb; also `reference` (`REQ-2026-0001`), service, vehicle_id, start_at, end_at, meta (IP, user agent), notes, shown_total_centavos, reject_reason, reviewed_by/at. `public_rate_events` (hashed IP, time) backs the 5/hour limit |
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
| 2026-11-24 | Vehicle blocks live in their own table `vehicle_blocks` (kind, start, end, reason, cancelled_at); `vehicle_holds` has `block_id` (CHECK: exactly one of booking/block). Blocks add **no** turnaround buffer. |
| 2026-11-24 | Extra `bookings` columns: `client_name`, `vehicle_label` (unmatched imported car), `passengers`, `luggage`, `itinerary`, `contact_handle`, `status_note` (cancel/no-show reason, import note), `confirm_without_rf_reason`, `driver_overlap_reason`, `imported`. `quotations` gains `imported` + `imported_data`. |
| 2026-11-24 | `booking_charges` = what the client owes **excluding the security deposit**: Self-Drive lines + discounts + card terminal fees; With Driver = grand total (lines, discount, terminal fees, corporate mark-up). The deposit exists only in the payments ledger (`deposit` / `deposit_refund`). |
| 2026-11-24 | "Apply deposit" writes a `deposit_refund` out and a matching `rental` in, so the §3 formulas stay unchanged and a booking can close with deposit held 0. Payments can be added until the booking is closed, cancelled or no-show. |
| 2026-11-24 | Close only from `returned` (Phase 2b) with balance 0 and deposit held 0, per bookings-and-movement.md §2. Vehicle/schedule can change only while pending or confirmed; charges are **not** re-priced on a schedule change (the page says so). |
| 2026-11-24 | `clients.first_rental_at` follows bookings: earliest start of a confirmed/released/returned/closed booking, recomputed on confirm, cancel, no-show and reschedule. |
| 2026-11-24 | New permissions `bookings.confirm_without_rf` and `drivers.override_overlap` (Admin and up). A driver overlap counts pending, confirmed and released With Driver bookings; Sales get 409, Admin assigns with a reason. |
| 2026-11-24 | Convert works from an issued quotation and also from one marked accepted (Phase 1c) that has no booking yet. Availability ("Available" / "Overlaps pending reservation" / "Booked by") shows on the formal quotation form (computed with the price preview) and on the booking's schedule card. |
| 2026-11-24 | Calendar shows pending (striped), confirmed, released, returned and closed bookings plus blocks; cancelled and no-show are hidden. Week view starts Monday. An empty day opens `/quotes/new?vehicle=…&date=…`. |
| 2026-11-24 | History import: every log row is a read-only imported quotation (`inputs = {imported:true}`, `result` null, logged lines in `imported_data`; no PDF, no revise). Lines are reconciled to the logged total with a "Difference to logged total" line; the card columns (AC–AE) are not imported. Future imported `issued` quotations are valid until their travel start and can be converted when the car matched a vehicle. A quotation number that already exists is skipped (and so is its booking). `BOOKED` future rows without a matched car become pending reservations. Log dates outside 2000–2099 are ignored with a warning. The reservation-fee payment is "collected by" the logged sales name. |
| 2026-11-26 | Check-in forms are their own phone-first pages, `/board/release/[id]` and `/board/return/[id]` (Ops+), not dialogs. Check-in times may not be more than 15 minutes in the future. One release and one return per booking (partial unique index on `movement_events`). |
| 2026-11-26 | Late-return grace is a setting, `late_return_grace_minutes` (default 60, PLAN Q11), editable with the other settings. |
| 2026-11-26 | Return charges are priced with the rate card of the booking's quotation (the active card when there is none). Billed days for the mileage allowance = the greater of the quoted days and the days the (possibly extended) schedule covers: Self-Drive by the quotation schedule rule (an 8 h/12 h remainder block is not a day), With Driver by started 24 h periods. Excess km already on the quote is subtracted. A vehicle without tank capacity gets no fuel-shortage charge, only a warning. |
| 2026-11-26 | A return is never refused because of the vehicle hold. Hold end = actual return + buffer. If that touches the next booking's hold, the buffer is dropped. If the car came back after the next booking started, the hold is left as it was. Either case shows a warning. |
| 2026-11-26 | Extensions (Sales+) work on confirmed and released bookings. Extra hours are rounded up and priced at the Self-Drive hourly extension rate, or the With Driver excess-hour rate (all-in or renter's fuel, from the quotation). The charge is stored as `kind = extension`, `source = manual`, `code = extension`, so Sales can remove it like other manual lines. A hold conflict refuses the extension (409) and nothing changes. `movement_events` also has `previous_end_at` / `new_end_at` for extensions. |
| 2026-11-26 | New permission `charges.remove_check_in` (Admin and up): remove a check-in charge with an audited reason. Quoted lines can never be removed. |
| 2026-11-26 | Board day status priority: Return > Out today > Rented > Blocked > Pending reservation > Available. A car can show several statuses, e.g. Return then Out today. A return due at midnight counts as that day. Actual check-in times replace planned ones. A released car past its end and not back stays out until now (shown as Overdue on today's board). A confirmed car past its start and not released shows "Not released". Vehicles are ordered as on the calendar (body type, then sort order). |
| 2026-11-26 | `bookings.show_notes_on_board` (checkbox on the booking details) puts the booking notes under Special instructions. |
| 2026-11-26 | Roster: one shift per person per day (unique date + user). A cell is a template plus a duty (Ops / Sales), or Off. "Copy previous week" fills only empty cells, for active staff only. The board shows that day's shifts plus the previous night's 9PM–6AM shift. |
| 2026-11-26 | Board PDF: `GET /api/board/pdf?date=…&days=1–7` (every role with `board.view`), A4 landscape, one page per day, 24-hour times, long text cut short so a day fits one page. Shared PDF font registration moved to `src/lib/pdf/fonts.ts`. |
| 2026-11-26 | "Reverting a return" is a new action **Undo return** (permission `movement.undo_return`, Admin and up, reason required) on a returned (not closed) booking: back to released, the return check-in and its `check_in` charges are removed, the hold goes back to the planned end (409 if that now clashes), the earned points get a `reversal` entry. |
| 2026-11-26 | Points ledger kinds: PLAN's `earn, redeem, adjust, import` plus `reversal` (return undone) and `refund` (cancelled booking). Earn/reversal and redeem/refund are idempotent per booking (net per pair). |
| 2026-11-26 | Earned days = the days the return bills (quoted days, or more when the schedule was extended), × 50. A booking without a client earns nothing (warning). An expired card is renewed on the next return: expires = return date + 1 year; member since unchanged. Cards are `JMV-NNNN` (4 digits) from sequence `JMV`. |
| 2026-11-26 | Redemption: formal quotations only (quick estimates never redeem). Discount uses whole pesos only and is capped so the total stays ≥ ₱0; free hours use the Self-Drive hourly extension table for both services. Issue checks card exists, not expired, balance covers it (409); confirm checks again and a shortfall refuses the confirm (409, nothing changes). **No-show keeps the redeemed points**; only cancel refunds. |
| 2026-11-26 | Rewards on the client page are a "Rewards" card (the client page has no tabs). Tier edits need new permission `rewards.edit_tier` (Super Admin). Manual adjustments cannot take a balance below 0. |
| 2026-11-26 | Outbox: retries live on the row (`next_attempt_at`, backoff 30 s × 2^(n−1), `failed` after the 8th attempt with `last_error` kept), due-ness by the database clock. Each row is sent in its own transaction locked `FOR UPDATE SKIP LOCKED`; the transport gets the outbox id as idempotency key. pg-boss runs the schedules (dispatch every minute, nightly sweeps at 00:05 Asia/Manila); requests also `pg_notify('outbox')` on commit so the worker sends at once. Extra columns: `next_attempt_at`, `entity`/`entity_id`, `created_by`. |
| 2026-11-26 | Quotation emails: the request stores subject/text/HTML and an attachment reference; the worker renders the PDF from the stored result when it sends (Resend REST API via `fetch`, no SDK). ESLint forbids `@/worker`, `pg-boss` and `resend` imports in `src/app`, `src/lib`, `src/components`; a test scans for them. Email allowed on issued or accepted formal quotations. |
| 2026-11-26 | `package.json` is now `"type": "module"`: the worker runs under `tsx` and `@react-pdf/renderer` is ESM-only (CommonJS loading fails). `tsconfig.worker.json` maps `server-only` to an empty module for the worker (as Vitest does). |
| 2026-11-26 | The nightly job stores `expired` on issued quotations past `valid_until`; "Mark lost" also accepts a stored `expired` quotation. |
| 2026-11-26 | Loyalty import: `Loyalty Log!C` matches `VRA series Log!A` directly (both `VRA2025318`). Fallback client match uses `VRA series Log!C` (client name; import-map.md says `Loyalty Log!C`, which holds the VRA number). Tier is read from a number or from text such as "…Tier 2 Client…". Rows with blank/0 points are skipped (warning). Row key `loyalty:<card>:<VRA>`. Member since = earliest rental start (else the VRA date); expired cards are imported as `expired`. Cards with no client match, or whose client already has another card, are imported **without a client** (`client_id` is nullable) and Admin+ links them on `/rewards`. |

| 2026-11-27 | Host routing uses a new env var `PUBLIC_BOOK_HOST` (comma list). On that host `src/proxy.ts` rewrites every path to `/book/*` (`/` → `/book`, `/privacy` → `/book/privacy`); `/_next`, `/api/public/*`, `/api/health` pass through; other `/api/*` are 404 and staff pages fall into `/book/...` (404). Without it, `/book` is served on any host (local, Railway default domain). |
| 2026-11-27 | Every response gets CSP `frame-ancestors`, set at runtime in the proxy: `/book/*` allows `'self'` + `PUBLIC_EMBED_ORIGINS` (only valid `scheme://host[:port]` origins are used); everything else `'self'` only. |
| 2026-11-27 | Vehicles gain `category` (needed to price sedan/MPV/SUV), `seats` and `listed_publicly` (default true), editable on `/fleet`. A car whose body type needs a category but has none is **not shown** on `/book` (`/fleet` flags it). The public name is make + model (+ colour), or the display name without the plate; plates are never shown. |
| 2026-11-27 | Public prices come from `priceQuote` with the active card, priced as a **repeat** client (no new-client discount; the page says "New clients get 5% off — applied on your formal quotation"). Delivery/pick-up fee ₱0, shown "to be confirmed" when an address is given. Self-Drive has no distance (no fuel/excess line). With Driver uses an optional client estimate of one-way km (0 = first band), service area and trip type from the form; the page says distance charges are confirmed on the formal quotation. The draft quotation is priced with the client's real history. Card payment preference adds the terminal fee in the summary. |
| 2026-11-27 | Public requests must start ≥ 2 h from now and within 12 months; Self-Drive ≤ 60 days, With Driver 1–30 days. |
| 2026-11-27 | Turnstile siteverify is the one external call made inside a request (its answer decides acceptance, so it cannot use the outbox). Without `TURNSTILE_SECRET_KEY`, production refuses public submissions (503, logged); development/tests skip the check. Rate limit: 5 submissions per rolling hour per hashed IP (`x-forwarded-for` first hop), counted after the honeypot and schema checks. Honeypot → 400. |
| 2026-11-27 | Client matching: exact E.164 phone → oldest matching client is linked and never edited (name differences, several matches and blacklist are noted on the inquiry); otherwise a new client with `source = website`. A new website client whose email another client already has is saved without the email (note on the inquiry), so the staff uniqueness rule holds. |
| 2026-11-27 | A request creates, in one transaction: inquiry (`REQ-{Manila year}-NNNN`, sequence `REQ-{year}`), client, draft formal quotation (no consultant; the issuer becomes the consultant), a Rework outbox row, audit rows (actor null). It re-checks availability under an advisory lock per car; a car taken meanwhile → 409. Nothing holds a car. Issuing the draft sets the inquiry `quoted`; converting sets `converted` and copies addresses, passengers, luggage, itinerary (With Driver drop-off prefixed), license no., IDs and `source_channel = website` into the booking. Reject (Sales+, reason) cancels a still-draft quotation. New permissions `inquiries.manage` and `rework.send` (Sales+). |
| 2026-11-27 | Rework: the outbox stores the **mapped** lead (`{ lead, source, reference }`); the worker posts it to `REWORK_WEBHOOK_URL?token=…` built only in `src/lib/rework/endpoint.ts`; errors and response bodies pass through `redactToken` (raw, URL-encoded and `token=` forms) and the outbox's own redaction; any 2xx is success; `response = { status, body ≤ 2 KB }`. Option values live in setting `rework_option_map` (defaults = our labels until Rework's exact values are known; empty = field not sent; car type tries `body:category` then `body`); `rework_date_unit` default `seconds`; birthday is sent as Manila midnight. `custom_government_id` (single option) = the first ID with a mapped value. Staff-intake trigger: clients added inline on a quotation get `source = quote_form`; their first issued formal quotation sends a lead when `rework_send_staff_intakes` is on and `rework_sent_at` is null. Manual "Send to Rework" on a client: 409 if already sent unless "Send again". "Send test lead" (Super Admin) goes through the outbox with invented data. `updateSettings` now saves only the general keys; Rework keys have their own action. |
| 2026-11-27 | Attribution: UTM, `fbclid`/`gclid`/`ttclid`, an extendable list of ad-id params (`AD_ID_PARAMS`), `_fbp`, referrer and landing URL, captured on the first visit into `sessionStorage`. The embed snippet forwards the parent page's query string, `ref` (its referrer), `landing` and `fbp` on the iframe URL, and listens for `jmave-book:height` / `jmave-book:top` messages from the booking origin. |
| 2026-11-27 | Audit viewer `/audit` (Admin+): filters actor (or System), record type, action prefix, record id, Manila dates; entry page with field-level before → after (`src/lib/audit-log/diff.ts`). A static test (`audit-log/coverage.test.ts`) requires every `defineAction` to reach `withAudit` unless exempt with a reason (read-only previews/searches; draft autosave — issuing writes the audited result). Quotation internal notes are now audited (`quotation.notes`). |
| 2026-11-27 | `defineAction` runners carry `.permission`; an integration test imports all 58 and checks 401 signed out, 403 for must-change-password and inactive users, and per role 403 exactly where `PERMISSIONS` denies. `ActionResult` gains status **429**. |
| 2026-11-27 | Security headers: CSP set in `src/proxy.ts` with a per-request nonce + `'strict-dynamic'` for scripts; `<style>` elements nonce-only (next-themes and `get-nonce` get the nonce; Sonner's fixed stylesheet allowed by SHA-256, re-checked by a test); `style-src-attr 'unsafe-inline'` for React style props only; HSTS over HTTPS; `no-referrer` on `/q/*`. Static headers (nosniff, Referrer-Policy, Permissions-Policy, COOP) in `next.config.ts`. The root layout reads the nonce, so every page renders per request. |
| 2026-11-27 | Client IP for every rate limit = the trusted right-hand end of `X-Forwarded-For` (`TRUSTED_PROXY_HOPS`, default 1), stamped by the proxy as `x-client-ip` (client-sent value overwritten); Better Auth reads `x-client-ip`. New limits: `/setup` 10/hour/IP (429), `POST /api/public/quote` 300/hour/IP. |
| 2026-11-27 | CSRF: cookie-authenticated route handlers that change data check Origin / Sec-Fetch-Site (`src/lib/security/origin.ts`; today only `POST /api/import`). Better Auth cookies: HttpOnly, SameSite=Lax, Secure when `APP_URL` is https. |
| 2026-11-27 | Import upload: the zip central directory must contain `[Content_Types].xml` + `xl/workbook.xml`, no `..`/absolute/backslash entry names, and expand to ≤ 400 MB, checked before exceljs. A zip that is not a workbook is refused without storing a run. |
| 2026-11-27 | Logging: `src/lib/log.ts` JSON lines (web and worker) with scrubbing (`src/lib/observability/scrub.ts`: emails, PH phones, `token=`, share-token paths, env secrets, PII/secret keys); a test forbids stray `console.*`. Request id: kept from `x-request-id` / `x-railway-request-id` when valid, else a UUID; echoed in the response and tagged on Sentry events. |
| 2026-11-27 | Sentry: `@sentry/nextjs` (server, edge, browser; no replay, no feedback widget) and `@sentry/node` in the worker. v11 `dataCollection` turns off user info, cookies, bodies, query strings, DB data, queue args, stack locals; `beforeSend` scrubs the rest; user = id + role only. Source maps upload only with `SENTRY_AUTH_TOKEN`. Worker errors are grouped by message. Rework transport no longer follows redirects (`redirect: "manual"`). |
| 2026-11-27 | Backups: Railway volume backups need a Pro workspace (refused on trial); owner accepted relying on a nightly off-site `pg_dump` instead. It runs as a separate cron service `backup` (postgres:18 image, because `pg_dump` must match server 18), not in the Node worker as the brief suggested. Restores strip Railway's private `pg_attver` column option so dumps load into stock Postgres. Never restore production data into staging. |
| 2026-11-27 | Staging = Railway environment forked from production with its own Postgres/volume, worker and backup; seeded only by `pnpm db:seed:staging` (`src/lib/seed/staging.ts`, invented data through the real services; refuses outside staging/local). Its TCP proxy is off except during reseeds/restore drills. |
| 2026-11-27 | Performance: trigram indexes on quotation/booking numbers, booking client names, client email/phone; btree on `bookings.end_at` (migration `0007_phase_5`). With ~3 years of invented volume (6,000 quotations, 1,500 bookings, 3,000 clients, 30,000 audit rows) every list/search/audit query is < 20 ms, board ~25 ms, month calendar < 5 ms. |
| 2026-11-27 | Owner answers to PLAN §8: Q1–Q12 keep the defaults as built (rounding line, fuel switch default on, FORMULA current with QP FORMULA as draft, pick-up table unused, manual tiers / no point expiry / 1-year membership, fuel-shortage formula, Van ₱500/hr, City Saver flat per booking, holiday driver fee ×2, OT premium once, 60-min grace, expired card renewed on next return). The 24h-tier night-differential rule (2026-11-23) is confirmed. Rework date unit stays open until a real test lead. |

## 8. Open questions (build with the default; confirm with the owner when possible)

**2026-11-27: Q1–Q12 answered by the owner — every default below is kept (§7).** Still open: the Rework date unit (`seconds` until a real test lead confirms it).

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

### 2026-11-24 — Phase 2a — Bookings, double-booking guard, payments, calendar
- Built:
  - Migration `0003_phase_2a`: `btree_gist`; `bookings`, `vehicle_blocks`, `vehicle_holds`, `booking_charges`, `payments`, `drivers`; `quotations.imported` / `imported_data`. Raw SQL: `vehicle_holds_no_overlap EXCLUDE USING gist (vehicle_id WITH =, period WITH &&) WHERE (active)`, non-empty bounded period, end > start on bookings and blocks. Indexes on bookings (vehicle_id, start_at), status, client, start, driver; number unique.
  - `src/lib/holds.ts`: `setHold` (create or move, in a savepoint) / `releaseHold` / `findOverlappingHolds`; Postgres `23P01` → `VehicleConflictError` naming the booking number or block kind; the caller's transaction stays usable.
  - `src/lib/booking-status.ts`: pure state machine per bookings-and-movement.md §2 (`checkTransition` with the RF, vehicle, balance and deposit rules). `src/lib/bookings/ledger.ts`: pure §3 ledger.
  - `src/lib/bookings/service.ts`: convert (issued/accepted formal quotation with a vehicle → pending reservation, number = quotation number, charges from the result, quotation → accepted), details and schedule edits (hold moved in the same transaction), confirm (RF required; Admin+ without RF with a reason), cancel, no-show, close, payments add/void/apply deposit, manual charges, driver assignment with overlap check. Every write audited.
  - Availability ("Available" / "Overlaps pending reservation QTN-…" / "Booked by QTN-…") on the formal quotation form and the booking schedule card, buffer included.
  - Vehicle blocks (create, edit, end/remove) from the calendar; `/drivers` list/add/edit.
  - Pages: `/bookings` (filters), `/bookings/[id]` (actions, schedule, charges, payments ledger with balance and deposit held, §1 details, client, driver, history), quotation page "Convert to booking" / "Open booking", imported quotation read-only view, client page rental history (bookings + quotations, lifetime days rented). Operations get 403 on booking and driver pages.
  - `/calendar`: custom week (Mon start) / month grid, vehicles grouped by body type, bars by status (pending striped, blocks grey), lanes for overlaps, filters (body type, status, service), drawer, empty day → `/quotes/new?vehicle=…&date=…`. Operations read-only.
  - Import: new sections Drivers (`Back bone WDRIVER` M/N) and Booking history (`Rental Log` / `WD Rental Log` → imported quotations; `BOOKED` / `COMPLETED` → bookings with logged charges, RF payment and hold; conflicts listed and imported as pending reservations).
  - Tests: unit (state machine, ledger incl. the §3 example, charges from quotes, calendar layout, history helpers), integration (hold constraint present; 2 and 10 concurrent overlapping confirmations → exactly one hold; buffer edge: exactly at end + 60 min succeeds, 1 min inside fails; blocks; savepoint keeps the transaction usable; DB refuses a raw overlapping insert; convert/confirm/cancel/no-show/close rules; concurrent `confirmBooking` → one 409; payments void Admin-only; apply deposit; driver overlap; repeat client from bookings; 20 vehicles × 31 days calendar query; Operations 403 on all 15 booking actions; history import incl. conflict, unmatched car, re-run idempotency, converting an imported quotation), e2e `tests/e2e/phase-2a.spec.ts` (issue → convert → RF → confirm → calendar bar; second booking refused naming the first number and shown striped; Operations calendar read-only, 403 on booking, bookings list and drivers).
- Results: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 491/491 (24 files), `pnpm e2e` 17/17. The Phase 1b e2e import count changed from 14 to 24 new (drivers + history rows in the fixture).
- Real booking workbook, imported locally into the dev database (counts only): drivers **9 new**; history **1,892 quotations** created; **153 bookings** (all **closed**: every `BOOKED` row's return date is already past as of 2026-11-24, so **0 confirmed, 0 conflicts**, nothing new on the calendar from real data); 2 future With Driver trips listed for staff to convert. Commit took ~1.6 s. Re-run: 0 new, 0 changed.
- Import warnings the owner should review: 5 duplicate quotation numbers (later rows skipped); 24 rows without a readable travel date; 4 booking dates with impossible years (e.g. 25025) ignored; 5 rows without a day count (1 day assumed) and 5 WD rows without hours (24 h assumed); 458 log rows name a car that is not in the current fleet (retired cars or plate differences, e.g. `NHS 5909`), 24 of them closed bookings now without a vehicle.
- Not done / deferred:
  - **Not deployed** (needs the owner's go-ahead; 1b and 1c are not deployed either). `railway up --service web` runs `0001`–`0003`; `0003` needs `CREATE EXTENSION btree_gist` (and `0001` `pg_trgm`) to be allowed for the Railway Postgres user.
  - Release/return check-in, so `close` cannot be reached in the UI yet (Phase 2b).
  - An imported issued quotation whose car did not match a vehicle cannot be converted (no vehicle picker on convert); make a new quotation.
  - I could not sign in to the local dev preview from this session, so UI checks are the e2e screenshots (booking page, week, month, drawer).
- Known issues: month view bars are narrow (40 px per day) so labels truncate; the full label is in the tooltip and drawer.
- Decisions made (also added to §7): `vehicle_blocks` table and no buffer on blocks; extra booking/quotation columns; charges exclude the deposit; apply deposit as two entries; close only from returned, no re-pricing on schedule change; `first_rental_at` from bookings; `bookings.confirm_without_rf` and `drivers.override_overlap`; convert also from accepted; calendar contents; history import rules.
- Deployed: no.

### 2026-11-26 — Phase 2b — Movement board, check-in, roster
- Built:
  - Migration `0004_phase_2b`: `movement_events` (+ `previous_end_at`, `new_end_at`; fuel 0–8 and odometer checks; one release and one return per booking), `shift_templates` (seeded 5AM–2PM, 8AM–5PM, 10AM–7PM, 1PM–10PM, 9PM–6AM), `shift_assignments` (unique date + user), `bookings.show_notes_on_board`. New setting `late_return_grace_minutes` (default 60).
  - Pure modules: `src/lib/movements.ts` (day statuses, OUT/IN/EXT timeline with FD/PU/WD/PR, 30-min slots, look-ahead, With Driver trips, special instructions, overdue flags), `src/lib/pricing/check-in.ts` (excess km, fuel shortage, late return, extension price, billed days), `src/lib/roster/shifts.ts` (shift windows incl. overnight, Monday weeks, on duty now, copy week).
  - `src/lib/check-in/service.ts`: `recordRelease`, `previewReturn` / `recordReturn` (check-in charges, hold end = actual return + buffer, never refused for a hold clash), `previewExtension` / `extendBooking` (hold moved in the same transaction, 409 on conflict). New permission `charges.remove_check_in` (Admin+); `removeCharge` refuses quoted lines and needs it for check-in lines.
  - Pages: `/board` (date picker, counts, fleet status table / stacked cards under 768 px, timeline, look-ahead, With Driver trips, special instructions, roster; refresh every 60 s and on focus; Release / Return for Ops+, Open for Sales+), `/board/release/[id]` and `/board/return/[id]` (phone-first; return shows the charges and the balance after before saving), booking page (Release / Return buttons, Extend dialog, Movement card, Admin removes check-in charges), `/roster` (week grid, Admin+ edits, copy previous week, view for all), dashboard "On duty now", settings field for the grace. Board and Roster are live in the menu (Operations: Board, Calendar, Roster).
  - Board PDF `GET /api/board/pdf?date=…&days=1–7`: A4 landscape, one page per day (20 vehicles fit).
  - Tests: unit (check-in golden case ₱1,200 / ₱987 / ₱600 and edges, board derivation incl. overdue on the due day, roster, board PDF one page per day), integration `tests/integration/phase-2b.test.ts` (release/return/extension rules, brief step 10 with preview, hold end, late return into the next booking, check-in charge removal by role, Operations 403 on booking/payment/quotation/roster actions and 200 on check-in, board with 20 vehicles < 1.5 s, roster), e2e `tests/e2e/phase-2b.spec.ts` (brief step 10: Sales confirms → Ops on a 390 px phone releases from the board (odo 10,000, 8/8) → returns next day 2 h late (10,450, 6/8) → charges previewed and saved → Sales sees the three check-in charges and the balance; board PDF 200).
- Results: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 553/553 (29 files), `pnpm e2e` 20/20.
- Board load time: 20 vehicles with the real imported data on the local dev database ~130 ms (first load), ~10 ms warm. **Not measured on Railway** (not deployed).
- Acceptance "board matches the DMS for a day with real imported bookings": **not shown.** The DMS workbook has day tabs only for Nov 22 and Nov 23, 2026. The Rental Log rows for those rentals are still `QUOTED`, so the Phase 2a import made no bookings for them, and every imported booking has a 00:00 time (the log has dates only). On those days the board shows every car Available while the DMS shows most of them Rented. The board needs real bookings entered in the system (or the log rows marked BOOKED and re-imported) to match. The DMS also uses a "Need Carwash" status that the brief's legend does not have.
- Not done / deferred:
  - **Not deployed** (1b–2a are not deployed either). `railway up --service web` runs migrations `0001`–`0004`.
  - Photos/videos at release (out of scope).
- Known issues:
  - A car whose display name already contains its plate shows the plate twice on board cards.
  - Board PDF cuts long names and very busy movement cells to fit one page.
- Decisions made (also added to §7): check-in pages and future-time limit; grace setting; check-in pricing (rate card, billed days, quoted excess, no tank capacity); return never refused for a hold clash; extension rules and charge source; `charges.remove_check_in`; board status priority and overdue; `show_notes_on_board`; roster rules; board PDF route.
- Deployed: no.

### 2026-11-26 — Phase 3 — Rewards, worker service, email
- Built:
  - Migration `0005_phase_3`: `loyalty_accounts` (client unique and nullable, `card_no` unique, member since / expires (Manila dates), tier, status, `imported`, `imported_name`), `points_ledger` (signed points, kinds earn/reversal/redeem/refund/adjust/import, `import_key` unique, `occurred_at`), `outbox` (PLAN §4 + `next_attempt_at`, `entity`/`entity_id`, `created_by`; partial index on due pending rows).
  - Pricing engine: `src/lib/pricing/rewards.ts` (earn 50/day, 50 points = ₱1, free-hours points, `rewardsLines`); both engines add "Rewards redemption" (negative, whole pesos, never below ₱0) or "Free hours (rewards)" (₱0) and return `rewards` (points to deduct). Form fields `rewardsMode`, `rewardsPoints`, `rewardsHours`.
  - Loyalty (`src/lib/loyalty/`): earn on return (card created or renewed, idempotent per booking), reversal on **Undo return** (new Admin+ action), redeem on confirm (409 rolls the confirm back when the card is missing, expired or short), refund on cancel; issue-time redemption check; manual adjustment (Admin+, reason, never below 0); tier (Super Admin, `rewards.edit_tier`); link an unmatched card (Admin+).
  - Pages: `/rewards` (search, All / No client / Expired, paging), `/rewards/[id]` (card facts as on the old `Interface` tab, member, history with running balance, Adjust / Set tier / Link client), Rewards card on the client page, Rewards card on the formal quotation editor (balance, redeem, problem shown before issuing), points on the booking page, Undo return on returned bookings, toast with points after a return. Rewards is live in the menu.
  - Outbox + worker: `enqueueOutbox` (insert + `pg_notify` in the request transaction), `processOutbox` (one row per transaction, `FOR UPDATE SKIP LOCKED`, backoff 30 s doubling, `failed` after 8 attempts with the error kept, DB clock). Worker `src/worker/index.ts` (`pnpm worker`; `pnpm worker:dev` locally): pg-boss queues + schedules (dispatch every minute; 00:05 Asia/Manila nightly quotation and loyalty expiry), LISTEN `outbox` for immediate sends, JSON health line "worker started", graceful SIGTERM/SIGINT shutdown. Resend transport (`fetch`, idempotency key = outbox id) lives only in `src/worker`; ESLint rule + test keep web code away from it.
  - Email: "Send by email" on issued/accepted formal quotations (Sales+): recipient (client email, editable), optional message → outbox `email` with the PDF attachment rendered by the worker; "Emails" card on the quotation shows status, attempts, last error, sent time (auto-refreshes while sending).
  - Import: new "Loyalty cards and points" section (Settings → Import) per import-map.md, with warnings; sequence `JMV` raised to the highest card.
  - `.railway/railway.ts` gains the `worker` service (same repo, no build step, start `pnpm worker`, restart on failure, Singapore). `package.json` is ESM now (see §7).
  - Tests: unit (rewards math and engine lines for both services, outbox backoff and error redaction, Loyalty Log cell parsing, email escaping, card expiry dates), integration `tests/integration/phase-3.test.ts` (3-day return → 150 points/₱3 and `JMV-0001`, numbering after 24, idempotency, renewal, no-client warning, undo return incl. permissions and re-earn, 1 free Sedan hour = 15,000 points deducted on confirm / refunded on cancel, peso discount, balance and expiry checks at issue and confirm, no-show keeps points, quick quotes never redeem, adjustment/tier/link permissions, nightly jobs, email enqueue only, send with PDF attached, failing fake transport → 7 retries with doubling delays → `failed` with error, two concurrent dispatchers send each row once, loyalty import sums and re-run, worker start/schedules/notify/stop, no Resend in web code), e2e `tests/e2e/phase-3.spec.ts` (3-day booking → Ops return → 150 points ₱3.00 on the client page → Admin +15,000 → redeem 1 free Sedan hour shows the ₱0 line → confirm deducts, cancel refunds → Send by email queued with status).
- Results: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 605/605 (34 files), `pnpm e2e` 25/25.
- Real booking workbook, loyalty section imported locally into the dev database (counts only): **21 cards, 62 rows, 10,450 points; every card's imported total equals its `Loyalty Log` sum (0 mismatches)**; 20 cards linked to clients, 1 kept without a client (its client already has another card); `JMV` = 24; re-run: 0 new, 0 changed. Warnings to review: 4 rows where days × 50 ≠ logged points (logged points kept); some cards' rows point to more than one client (linked to the most common).
- Not done / deferred:
  - **Not deployed** (needs the owner's go-ahead; 1b–2b are not deployed either). Steps: create Railway service `worker` from this repo with the `.railway/railway.ts` settings and variables `DATABASE_URL` (Postgres reference), `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`; then `railway up --service web` (migrations `0001`–`0005`) and `railway up --service worker`.
  - **Email arrival with the real PDF not checked**: no `RESEND_API_KEY` locally. Sending, the attachment and retries are tested with fake transports; the first real send should be checked after deploy.
  - Q5 tier thresholds still unknown (tier is imported and edited by hand).
- Known issues:
  - The Phase 2a holds concurrency test ("ten concurrent overlapping confirmations") once ran 5.2 s against its 5 s limit under full-suite load; it passes alone and on reruns. Unchanged by this phase.
- Decisions made (also added to §7): Undo return + `movement.undo_return`; ledger kinds `reversal`/`refund`; earned days and card renewal; redemption rules (whole pesos, formal only, checks at issue and confirm, no-show keeps points); Rewards card on the client page, `rewards.edit_tier`; outbox retry design and pg-boss role; worker renders the PDF, Resend via `fetch`, import ban; ESM package; stored `expired` and Mark lost; loyalty import matching rules and unlinked cards.
- Deployed: no.

### 2026-11-27 — Phase 4 — Public booking page, inquiries, Rework
- Built:
  - Migration `0006_phase_4`: `inquiries` (PLAN §4 + reference, service, vehicle, window, meta, notes, shown total, reject reason, reviewer), `public_rate_events`, `clients.rework_sent_at`, `vehicles.category` / `seats` / `listed_publicly`. Settings keys `rework_send_staff_intakes`, `rework_option_map`, `rework_date_unit`. Permissions `inquiries.manage`, `rework.send` (Sales+).
  - Host routing + framing in `src/proxy.ts` (`src/lib/public/host.ts`): `PUBLIC_BOOK_HOST` → `/book/*`, staff routes and staff APIs never served there; CSP `frame-ancestors` on every response (`/book` allows `PUBLIC_EMBED_ORIGINS`).
  - Public `/book` (no login, phone-first, native inputs, Turnstile script loaded only on the last step): service → dates/times (+ destination, trip type, driver waits, area, optional km for With Driver) → available cars with price → details (fields by service) → summary with full breakdown, "New clients get 5% off — applied on your formal quotation", delivery/pick-up fee "to be confirmed", privacy consent (RA 10173) + `/book/privacy` notice, Turnstile → thank-you with `REQ-…` reference and contact channels. `?embed=1` hides header/footer and posts its height to the parent.
  - `POST /api/public/quote` (availability + engine prices) and `POST /api/public/inquiries` (Turnstile server-side, honeypot, 5/hour per hashed IP, same zod schemas, availability re-check under a lock) → inquiry + client (exact phone match or new `website` client) + priced draft formal quotation + Rework outbox row, in one transaction; nothing holds a car.
  - Staff inbox `/inquiries` (badge with the count of new requests in the menu): status tabs, detail page (trip, client, source/attribution, Rework delivery), "Review quotation" opens the draft in the normal editor (banner links back to the request), Reject with a reason. Issue → `quoted`, convert → `converted` with the request's details copied to the booking.
  - Rework (`src/lib/rework/`): option map + defaults, pure payload mapper, endpoint/URL + `redactToken`, outbox handler; worker transport `src/worker/rework.ts`; triggers: every public request, issue for a client added in the quotation form (setting), "Send to Rework" / "Send again" on the client page. Settings: URL set / Token set, staff-intake toggle, date unit, option-map editor, "Send test lead", last 50 deliveries, embed snippet with copy button. Fleet: rate category, seats, "Show on the public booking page", warning for cars hidden for a missing category.
  - Tests: unit (payload snapshot with invented data, option fallback, ms unit, endpoint/redaction, worker transport never leaks the token into errors, bodies or console, host routing + proxy rewrite/404/CSP, attribution parsing, public form ↔ engine for SD/WD/card, schemas, booking fields), integration `tests/integration/phase-4.test.ts` (20: listed/priceable cars only; confirmed hold with buffer edge and block hide a car, pending does not; 409 on a held car; window rules; public price = engine output for SD cash/card and WD; submission rows + mapped lead + no hold; phone match; email collision; WD lead; honeypot/invalid/consent; rate limit; Turnstile verify + production 503; issue/convert status hooks and booking fields; reject + 403/409; staff-intake trigger on/off/once; manual send 403/409/again; test lead + settings Super Admin only; worker send stores status/body, failing send keeps a redacted error, token absent from outbox, audit and console), e2e `tests/e2e/phase-4.spec.ts`.
- Results: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 663/663 (40 files), `pnpm e2e` 29/29.
- Rework option map used (defaults until Rework's exact dropdown values are known; editable on /settings): services `Self-Drive` / `With Driver`; car type = body-type label (`Compact`, `Sedan`, `Wagon`, `MPV`, `SUV`, `Pick-up`, `Van`; category rows empty → body type); mode of payment `Cash` / `GCash` / `Card` / `Bank` / `Other`; deal sources `Website Booking Page` + source-channel labels; government ID = our ID type names; driver's license `Professional` / `Non-professional`; driver waits `Yes` / `No`. Date unit: `seconds` (**not confirmed** — needs a real test lead).
- Not done / deferred:
  - **Real test lead in Rework not sent**: `REWORK_WEBHOOK_URL` / `REWORK_WEBHOOK_TOKEN` are not set and the exact option values are not known. Owner: set both in Railway (web and worker), enter the option values on /settings, press "Send test lead", check name, phone, dates, service and car type in Rework, and confirm the date unit (then record it in §7).
  - **Lighthouse mobile ≥ 90 on `/book` not measured**: Lighthouse is not installed here. The page is built for it (server-rendered first step, native inputs, Turnstile script loaded only on the last step), but no score exists yet.
  - **Not deployed / no custom domains** (1b–3 are not deployed either): needs hostnames + DNS on the Railway `web` service, `PUBLIC_BOOK_HOST`, `PUBLIC_EMBED_ORIGINS`, `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`, Rework variables. `railway up --service web` runs migrations `0001`–`0006`.
  - Sedans, MPVs and SUVs have no rate category yet, so they are not shown on `/book` until it is set on `/fleet`.
  - The privacy notice text (`/book/privacy`) is a draft written for this phase; the owner should have it reviewed.
- Known issues:
  - Chrome's Local Network Access checks block a non-local page from framing `localhost`; the e2e embed test therefore serves its "company site" from a local http server. Not an issue on real domains.
  - The outbox's own error redaction turns `?token=***` into `?token=[redacted]` in `last_error` (both hide the token).
- Decisions made (also added to §7): `PUBLIC_BOOK_HOST` + proxy rewrite; runtime `frame-ancestors`; vehicle category/seats/listed and hiding uncategorised cars; public price without the new-client discount, fees to be confirmed, With Driver km estimate; public window limits; Turnstile in-request, 503 without a secret, rate limit on hashed IP; client matching and email collision; one-transaction request + status hooks + booking fields + reject; Rework mapped payload in the outbox, redaction, option map/unit defaults, `quote_form` staff-intake trigger, manual send/again, test lead, split settings action; attribution capture and the embed snippet.
- Deployed: no.

### 2026-11-27 — Phase 5 — Hardening
- Built:
  - **Audit viewer:**
    - `/audit` and `/audit/[id]` (Admin+). Filters: actor or System, record type, action prefix, record id, Manila dates. The entry page shows a field-level before → after, unchanged fields on request, raw JSON, and links to the record and its full history. Live in the menu.
    - The audit coverage test found one unaudited write (quotation internal notes); it is fixed.
  - **Security review** (`docs/security-review.md`). The `/security-review` run found no high-confidence findings. Hardening added:
    - per-role permission enumeration of all 58 actions;
    - static scans of server actions, route handlers and `console.*`;
    - CSP with nonces, nonce-only style elements and the Sonner hash;
    - HSTS and the other static security headers;
    - cookie flags, and a CSRF check on the import route;
    - zip-directory checks on upload;
    - trusted client IP (`x-client-ip`);
    - rate limits on `/setup` and the public quote endpoint;
    - share-token tests;
    - the Rework transport no longer follows redirects.
  - **Observability:**
    - Sentry for web (server, edge, browser) and worker, with collection off plus scrubbing;
    - structured JSON logs (`src/lib/log.ts`);
    - `x-request-id` on every response and Sentry event.
    - Verified with a real staging worker event: `environment=staging`, no user data.
  - **Backups** (`docs/ops/backups.md`):
    - `backup` cron service (postgres:18 + aws-cli, 02:00 Manila) in production and staging;
    - `ops/backup/restore-check.sh`.
    - Restore test done on staging: 28 tables, 0 row-count mismatches, exclusion constraint present.
  - **Staging** (`docs/ops/staging.md`): Railway environment `staging` (own Postgres and volume, worker, backup). Seeded with invented data by `pnpm db:seed:staging` through the real services. Own secrets and Turnstile test keys; health check on.
  - **CI:** `.github/workflows/ci.yml` runs lint, typecheck, unit and integration tests, and Playwright e2e against a `postgres:18` service container, on every push and PR.
  - **E2E** (`tests/e2e/phase-5.spec.ts`):
    - Super Admin rate-card copy and activate with audit diff;
    - Admin creates and deactivates an Operations user, with audit rows;
    - Sales gets 403 on `/audit`;
    - security headers, cookie flags and CSRF;
    - axe scans of 14 main pages, with no serious or critical violations;
    - keyboard sign-in and menu navigation;
    - board, calendar and PDF timings.
    - The other role journeys live in the earlier phase specs; the spec header maps them.
  - **Accessibility fixes found by axe:**
    - The user-menu button's accessible name now contains the visible name (WCAG 2.5.3).
    - `--muted-foreground` darkened from 0.556 to 0.48 (4.5:1 on `--muted`).
    - Destructive badges use red-700 text.
    - Confirmed/released and Out today/Rented chips use sky/emerald-700.
    - Scrollable `<pre>` blocks are focusable.
  - **Performance:** migration `0007_phase_5` (trigram and `end_at` indexes) and a volume test (see §7).
  - **User guide:** `docs/user-guide.md`, one section per role, with 20 staging screenshots in `docs/user-guide/`.
  - **Open questions:** Q1–Q12 answered by the owner (defaults kept) and the night-differential rule confirmed (§7).
- Results: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 712/712 (45 files), `pnpm e2e` 36 passed (4 skipped: the user-guide screenshot spec, which runs only on request). Volume test: board ~25 ms, month calendar < 5 ms, lists/search/audit < 20 ms. E2E perf test (board, calendar, PDF) well under its limits.
- Not done / deferred:
  - **Off-site dumps are off.** There is no bucket yet. The owner creates one and sets `BACKUP_S3_*` on the `backup` service; then do the S3 leg of the restore test (backups.md "Turn it on").
  - **Production is not redeployed with Phase 5.** Production runs Phase 4 from GitHub `main`. Phase 5 reaches it when `phase-5` is merged to `main`. Migration `0007` then runs on pre-deploy.
  - **Web Sentry not tested with a real event.** The DSNs are set on production and staging, but a real web error event has not been triggered. The first one should be checked.
  - **Rework date unit** still unconfirmed (needs a real test lead).
- Known issues:
  - A returned booking with a balance shows **Close booking**. Closing is refused by the rules; the button could be hidden. Seen in the staging screenshots.
  - The Decisions log table in §7 is split by a blank line (from Phase 4), so Markdown shows it as two tables.
- Decisions made (also added to §7): audit viewer and coverage rule; runner permission tags and 429; CSP and header design; trusted client IP; CSRF and cookie flags; upload zip checks; logging, request ids and Sentry data collection; backups as a separate cron service with the `pg_attver` strip and no production data in staging; staging layout and seed; performance indexes; owner answers to §8.
- Deployed:
  - staging: yes, https://jmave-booking-20-staging-124dd0c5.up.railway.app (web, worker and backup).
  - production: `backup` cron only, plus Sentry variables (no app redeploy).

#### Go-live checklist (status 2026-11-27)

| Item | Status |
|---|---|
| Security review findings fixed or accepted in writing | ✅ (§7, `docs/security-review.md`; risk 4 accepted by the owner) |
| Restore test done and documented | ✅ staging dump → scratch DB (`docs/ops/backups.md`); ⏳ S3 leg once a bucket exists |
| CI runs lint, typecheck, unit, e2e on every push | ✅ workflow added; ⏳ first GitHub run happens after the push |
| Staging exists with invented data only | ✅ |
| User guide covers every role | ✅ |
| Off-site nightly backups active | ⏳ owner: bucket and `BACKUP_S3_*` |
| Production on Phase 5 code (merge `phase-5` → `main`) | ⏳ |
| Production **worker** service (outbox: emails, Rework leads; nightly sweeps) | ❌ missing in production. Create it as on staging (`.railway/railway.ts`) |
| Production health check `/api/health` | ⏳ set on staging only |
| Production variables: `TURNSTILE_*` (public requests are refused with 503 without them), `RESEND_API_KEY`/`EMAIL_FROM`, `REWORK_WEBHOOK_*`, `PUBLIC_BOOK_HOST`, `PUBLIC_EMBED_ORIGINS` | ⏳ owner |
| Custom domains (app + `book.`) and DNS | ⏳ owner |
| First Super Admin on production via `/setup`, then import both workbooks | ⏳ owner (production state not checked here) |
| Rework test lead and date unit | ⏳ owner |

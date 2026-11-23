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
| Better Auth tables (`user`, `session`, `account`, `verification`) | 1a | `user.role`, `user.active`, `user.display_name`, `user.rework_owner_id` |
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

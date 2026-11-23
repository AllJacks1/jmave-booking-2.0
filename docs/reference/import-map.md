# Excel import map

Two source files, placed by the owner in `migration/source/` (gitignored):

- `Self-Driven and With Driver.xlsx` — the "booking workbook"
- `2026 Daily Movement Sheet.xlsx` — the "DMS workbook"

## General rules

- Upload through **Settings → Import** (Super Admin only). Read with `exceljs` on the server. Read **cached values** (`cell.result` for formula cells, `cell.value` otherwise). Never evaluate formulas.
- Every import runs in two steps: **Preview** (parse, validate, show counts, new vs updated vs skipped, and every row-level warning) then **Commit** (one DB transaction). Store both in `import_runs`.
- Imports are **idempotent**: running the same file twice changes nothing the second time. Match keys are listed per section.
- Never log or display full client rows in server logs. The preview UI may show them to the Super Admin.
- Dates: Excel serial numbers (e.g. `46349`) → days since 1899-12-30, Asia/Manila. Times are fractions of a day (`0.354166…` = 08:30). Some cells hold text like `Aug 1-2, 2025`; parse what you can, otherwise warn and leave null.
- Money cells may be numbers or text with commas. Strip `₱`, commas, spaces.
- Phones: `9.196931013E9` (number) → `09196931013` → `+639196931013`.
- Body type strings vary (`Pick up`, `Pick-up`, `PICK UP`, `MGZ`, `VAN`). Normalise with one mapping table; unknown values become warnings.

## Phase 1b imports (booking workbook)

### Fleet → `vehicles`

Tab `SPECS`, header row 1, data from row 2. Match key: `plate` (normalised: uppercase, single spaces). Rows without plate: match by `display_name`, else warn.

| Column | Field |
|---|---|
| A | display_name (e.g. `Vios Red AT NHS 5905`) |
| C | make |
| D | model |
| E | year |
| F | color |
| G | plate |
| H | transmission |
| I | chassis_no |
| J | engine_no |
| K | engine |
| L | body_type (normalise) |
| M | fuel_type: `Unleaded` → gasoline, `Premium` → premium, `Diesel` → diesel |
| N | tank_capacity_l (`42 Liters` → 42) |

Ignore rows after the first fully blank row (row 27 is a duplicate helper row).

Also read tab `Back bone`, columns G (car name), H (plate), J (body type), L (operator name): fill `operator_name` and `ownership = operator` when an operator name exists; add vehicles that are in `Back bone` but missing in `SPECS` (warn). The DMS shows a hired van ("HIRED VAN (CITYGLIDE)"): create such vehicles manually with `ownership = hired`.

### Rate cards → `rate_cards`

- `FORMULA` + `FORMULA WDRIVER` → rate card **v1, status `active`**.
- `QP FORMULA` → rate card **v2, status `draft`** (PLAN Q3). Same cell layout as `FORMULA` for the Self-Drive part; With Driver part copied from v1.
- Every cell range is listed in `docs/reference/pricing.md` §2.2 and §3.2. After reading, **compare against the expected numbers in pricing.md**. Any difference is a preview warning, not a silent overwrite.
- The result must validate against the zod `RateCardData` schema.

### Clients → `clients`

Tab `Rental Log`, header row 1, data rows 2+ (≈1,736 rows). Also tab `WD Rental Log` (≈162 rows).

Match key: normalised phone; if no phone, lower-cased email; if neither, exact full name + FB name (warn).

`Rental Log` columns: A quotation no. (`QTN-2026-928`), B booking date, C travel date, D days, E time, F sales, G client name, H FB name, I from, J to, K car, L category, M rate, N additional hrs, O CDW, P carwash, Q delivery fee, R pick-up fee, S OT premium, T beyond operating hours, U hourly extension, V sub total, W April promo, X less discount, Y reservation fee, Z total, AA mode of payment, AB deposit, AC rental charges (card), AD deposit charges (card), AE grand total, AF contact no., AG email, AH birthday, AI complete address, AJ alternative person, AK alt contact no., AL (unused), AM status, AN timestamp.

Client fields from `Rental Log`: G full_name, H fb_name, AF phone, AG email, AH birthday, AI address, AJ alt_contact_name, AK alt_contact_phone. `first_rental_at` = earliest C (travel date) among that client's rows with status `BOOKED` or `COMPLETED` (this drives the new-client discount, so quote-only clients stay "new").

Status values in `Rental Log!AM`: `QUOTED` (≈981), `BOOKED` (≈50), `COMPLETED` (≈103), blank (≈600). `WD Rental Log!AQ` is always blank.

`WD Rental Log` columns: A quotation no. (`QTN-WD2026-004`), B booking date, C travel date, D time, E hours, F sales, G client contact number, H client, I FB name, J from, K to, L car, M coverage rental rate, N total distance, O assigned car, P type of contract, Q type of trip, R individual/corporate, S payment type, T term rental rate, U rate, V additional hrs, W CDW, X carwash, Y driver's fee first day, Z driver standby, AA driver last day, AB accommodation, AC meal, AD fuel, AE excess mileage, AF sub total, AG reservation fee, AH less discount, AI total, AJ terminal fee, AK RF terminal fee, AL total + terminal, AM corporate %, AN corporate mark-up, AO corporate total, AP car category, AQ status, AR timestamp.

Client fields from `WD Rental Log`: H full_name, I fb_name, G phone, R client_type.

When the same client appears many times, the **latest non-empty** value of each field wins.

### Blacklist → `clients.is_blacklisted`

DMS workbook, tab `Blacklisted Client ` (note the trailing space), header row 1, data rows 2+. Column B name(s) (may hold several names separated by `/`, or `FB: …`), C contact no., D particular (reason), E–F extra notes.

Match to existing clients by phone first, then by name. Unmatched rows create a new client with `is_blacklisted = true`, `source = 'blacklist_import'`. Reason = D + E + F joined.

### Number sequences → `number_sequences`

- `QTN-{YYYY}`: highest `NNN` in `Rental Log!A` per year.
- `QTN-WD{YYYY}`: highest `NNN` in `WD Rental Log!A` per year.
- Only ever raise a sequence, never lower it.

## Phase 2a imports (booking workbook)

### Booking history → `bookings`, `booking_charges`, `payments`

Match key: quotation number (column A). Every row becomes a **quotation** (`result` built from the logged line amounts, `rate_card_id` null, flag `imported = true`). Only some rows also become a **booking**.

Status mapping (`Rental Log!AM`):

| Value | Quotation status | Booking |
|---|---|---|
| `QUOTED` | `expired` if travel date is past, else `issued` | none |
| `BOOKED` | `accepted` | `confirmed` (+ hold) if end is in the future, else `closed` |
| `COMPLETED` | `accepted` | `closed` |
| blank | `expired` if past, else `issued` + warning | none |

`WD Rental Log` has no status: import every row as a quotation only (`expired` if past, else `issued`). Future With Driver trips that are really booked are converted by staff in the app (the preview lists them for the Super Admin).
- Vehicle: match `Rental Log!K` / `WD Rental Log!O` against vehicle display names using the `Back bone` naming (`Vios Silver 2026 AT - LAS 2163` contains the plate). Unmatched → warning; booking imported without vehicle and without hold.
- `start_at` = travel date + time; `end_at` = start + days × 24h (Self-Drive) or + hours (With Driver).
- **Overlapping future confirmed bookings** found during import are listed in the preview as conflicts. Commit imports them as `pending_reservation` with a warning instead of failing.
- Charges: one `booking_charges` row per non-zero logged line (`source = 'quote'`). Payments: reservation fee as a `payments` row if > 0, method from `AA` / `S`.

## Phase 3 import (booking workbook)

### Loyalty → `loyalty_accounts`, `points_ledger`

Tab `Loyalty Log`, header row 1. Columns: A rental date(s) (text or serial), B loyalty number `JMV-0001`, C VRA number, D number of rent, E number of days, F points earned, G tier.

Tab `Interface` shows one card's summary (name, address, contact, membership date, expiration date, total points). Use it only to understand the format.

Client-to-card linking: `Loyalty Log!C` (VRA number) → tab `VRA series Log` (A series number = VRA number, B date generated, C client name, D quotation number, E rental total, F days) → quotation number → the imported quotation's client. Fall back to matching column C client name. Warn on failures.

Each row → one `points_ledger` row (`kind = import`, points = F). Card's `member_since` = earliest date; `expires_at` = member_since + 1 year; `tier` = latest G. Sequence `JMV` = highest number.

## Not imported

GCash tabs, VRA forms, Daily Sales, Target Sales, Costumer Journey, Demographic, Won/Lost/Negotiation, the DMS day tabs (`November 22 DMS…`), Daily Inquiries, TO DO, FAQs, HOLIDEALS, Lost & Found, iHUB tabs, REPORT. The DMS day tabs are replaced by the live board, not migrated.

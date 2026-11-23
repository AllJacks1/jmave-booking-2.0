# Phase 1c — Quotations and PDFs (MVP complete)

> **Kickoff prompt:**
> Build Phase 1c of J-MaVe Booking 2.0. Follow `CLAUDE.md`, `docs/PLAN.md` and `docs/phases/phase-1c-quotations-and-pdf.md`. Show me your plan first, then build.

## Goal

Sales can produce a quick estimate in under a minute and a formal numbered quotation, both as a PDF, a share link and copy-paste text for Messenger/WhatsApp.

## Owner does before this session

- Put the logo at `public/brand/logo.png` (transparent PNG, ≥ 600 px wide). Without it, a text wordmark is used.

## Read first

- `CLAUDE.md`, `docs/PLAN.md` (§4 `quotations`, §6.1, §6.3, §6.5)
- `docs/reference/quote-documents.md`
- `docs/reference/pricing.md` §2.1, §3.1 (inputs) and §5 (validity)

## Build, in order

1. **Schema**: `quotations` (PLAN §4) plus `revised_from_id`.
2. **Numbering** (`src/lib/numbering.ts`): `nextNumber(tx, key)` with `SELECT … FOR UPDATE`; formats `QTN-2026-929`, `QTN-WD2026-119`. Test: 20 parallel issues produce 20 unique, gap-free numbers.
3. **Quick quotation** (`/quotes/quick`): single screen; service toggle; body type + category (or vehicle); start/end date-time; destination; key extras (CDW, delivery, distance, all-in/RF). Live price panel (server action, debounced). Actions: **Download PDF** (estimate layout), **Copy text** (plain-text breakdown, see below), **Save**, **Make formal** (opens the formal form prefilled).
4. **Formal quotation** (`/quotes/new`, `/quotes/[id]`):
   - Client picker (search) or inline new client. **Blacklisted client → red warning; issuing blocked** unless Admin+ overrides with a reason.
   - Repeat/new client detected automatically (affects 5% discount), overridable.
   - Specific vehicle (optional until booking) or body type + category.
   - All engine inputs for the chosen service (pricing.md §2.1 / §3.1), grouped in sections; With Driver start/end times compute contract hours.
   - Live breakdown. Draft autosave.
   - **Issue**: allocates number, sets `issued_at`, `valid_until`, snapshots `inputs` + `result` + `rate_card_id`. Issued quotations are read-only.
   - **Revise**: copies into a new draft; on issue it gets a new number and the old one becomes `cancelled` with "revised by QTN-…".
   - Actions on issued: PDF, copy share link, copy text, mark **lost** (reason), mark **accepted** (Phase 2a replaces this with "Convert to booking").
   - Status `expired` computed on read when `valid_until` < now (a nightly job comes in Phase 3).
5. **PDFs** per `quote-documents.md` §1–§3 via `@react-pdf/renderer`, route handlers behind permissions. File names per §4.
6. **Share page** `/q/[token]`: public, read-only client copy + PDF download, no staff data, `noindex`. Expired → "This quotation has expired. Please contact us for an updated quote." with business contacts.
7. **Copy text** format (for chat apps):
   ```
   J-MaVe Cars — QTN-2026-929
   Self-Drive · Wigo (Compact) · Nov 22, 11:30 AM – Nov 23, 11:30 AM
   1,580.00  Rental rate (1 day)
     200.00  Carwash
     490.00  Delivery fee
     -79.00  New client discount
   --------
   2,191.00  Rental total
   2,000.00  Refundable deposit
   Valid until Nov 24, 2026 11:30 AM
   ```
8. **Quotation list** (`/quotes`): filters (status, service, consultant, date range), search by number or client; Sales sees all (team works shared leads).
9. **Dashboard** (`/dashboard`): my quotes today, quotes expiring in the next 6 hours, recent quotes.
10. **E2E**: quick quote → PDF downloads; formal quote with new client → issue → number assigned → share link renders → PDF downloads; blacklisted client cannot be issued by Sales.

## Acceptance criteria

- [ ] Golden case SD-2 entered through the UI shows exactly the pricing.md numbers, in the UI, the PDF and the copy text.
- [ ] The first issued Self-Drive quotation after import is `QTN-2026-929`.
- [ ] Changing the active rate card does not change any issued quotation.
- [ ] Share link exposes no internal fields (consultant email, rate card id, notes).
- [ ] PDFs render correctly with long names, 15+ lines, and both services.
- [ ] Operations cannot open any quotation page or PDF route (403).
- [ ] Lint, typecheck, tests, e2e pass. Deployed. **MVP ready for staff use.**

## Out of scope

Bookings, availability, calendar (2a). Email sending (3). Rewards redemption (3).

## Hand-off

Progress log entry. Ask before committing (branch `phase-1c`).

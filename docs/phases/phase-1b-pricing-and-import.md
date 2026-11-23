# Phase 1b — Fleet, rates, clients, import, pricing engine

> **Kickoff prompt:**
> Build Phase 1b of J-MaVe Booking 2.0. Follow `CLAUDE.md`, `docs/PLAN.md` and `docs/phases/phase-1b-pricing-and-import.md`. Build the pricing engine and its golden tests first. Show me your plan first, then build.

## Goal

The data the quotations need, loaded from the old workbooks, and a pricing engine that reproduces the old sheets (with bugs fixed) to the centavo.

## Owner does before this session

- Copy `Self-Driven and With Driver.xlsx` and `2026 Daily Movement Sheet.xlsx` into `migration/source/` (gitignored). These hold real client data: they must never be committed.

## Read first

- `CLAUDE.md`, `docs/PLAN.md` (§4 rows marked 1b, §6.1, §6.3, §8 open questions)
- `docs/reference/pricing.md` (all of it)
- `docs/reference/import-map.md` (sections "General rules" and "Phase 1b imports")
- `docs/reference/workbook/*.txt` when a rule in pricing.md needs checking against the original formula

## Build, in order

1. **Schema**: `vehicles`, `rate_cards`, `holidays`, `clients`, `number_sequences`, `import_runs`. Indexes: clients on normalised phone, lower(email), full_name trigram (enable `pg_trgm`) for search.
2. **Shared libs**: `money.ts` (centavos, format `₱1,580.00`), `time.ts` (Asia/Manila helpers), `phone.ts` (PH normalise to E.164), each with tests.
3. **Rate card schema**: zod `RateCardData` in `src/lib/pricing/rate-card.ts` covering every table in pricing.md §1–§3 (self-drive, with-driver, vehicle class table, promos, fees, unused stored tables). Values in centavos.
4. **Pricing engine** (pure, no DB): `priceSelfDrive`, `priceWithDriver` per pricing.md, returning typed lines with `code`, `label`, `remark`, `amount`. Hours tier, distance bands, long-term logic, driver-fee terms, rounding + service fee, discounts, terminal fees, payable block. **All golden cases in pricing.md §7 as Vitest tests, passing exactly.** Add edge tests: 0 km, >500 km, 14/15/29/30 days, holiday, card vs cash, blank optional inputs.
5. **Import pipeline** (`src/lib/import/`): upload (Super Admin, `.xlsx` only, ≤ 20 MB, validate it opens), parse with exceljs, per-section mappers, **Preview** screen (counts + warnings per section, expandable rows), **Commit** in one transaction, `import_runs` record. Sections this phase: fleet, rate cards (v1 active from FORMULA + FORMULA WDRIVER, v2 draft from QP FORMULA), clients (Rental Log + WD Rental Log), blacklist (DMS workbook), number sequences. Idempotent re-runs.
6. **Rate-card self-check**: after parsing, diff against the expected values in pricing.md; mismatches are preview warnings.
7. **Fleet** (`/fleet`): table + edit form (Super Admin); Admin read-only. Active toggle, sort order, ownership, operator name.
8. **Rate cards** (`/rates`): view active card as readable tables (same layout as pricing.md); view drafts; side-by-side diff of two versions; edit a draft (Super Admin) with validation; **Activate** (archives the previous active, audit logged). Admin read-only.
9. **Holidays** (`/rates/holidays`): list by year, add/remove (Super Admin).
10. **Clients** (`/clients`): search (name, phone, FB name, email), list, detail (fields from PLAN §4, rental history placeholder), create/edit (Sales+), blacklist toggle with reason (Admin+), visible blacklist badge. "Repeat client" computed from `first_rental_at` (or later bookings).
11. **Pricing playground** (`/rates/playground`, Admin+): form for every engine input, shows lines + totals live. Used to check numbers against the old sheet.

## Acceptance criteria

- [ ] All golden tests from pricing.md §7 pass; engine has no imports from `db`.
- [ ] Importing both real workbooks: preview shows counts; commit succeeds; re-running the same files reports 0 new / 0 changed.
- [ ] Active rate card v1 has **zero** mismatch warnings against pricing.md (or every mismatch is explained to the owner).
- [ ] `QTN-2026` sequence = 928 and `QTN-WD2026` = the highest WD number in the file.
- [ ] Blacklisted clients show a badge in search results.
- [ ] Admin sees rate cards, fleet and import runs read-only; Sales cannot open them.
- [ ] No client data from the workbooks appears in the repo (tests use invented data).
- [ ] Lint, typecheck, tests pass. Deployed.

## Out of scope

Quotation UI and PDFs (1c). Booking history import (2a). Loyalty import (3).

## Hand-off

Progress log entry: import counts, warnings the owner must review, any pricing rule that needed interpretation. Ask before committing (branch `phase-1b`).

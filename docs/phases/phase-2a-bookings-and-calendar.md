# Phase 2a — Bookings, double-booking guard, payments, calendar

> **Kickoff prompt:**
> Build Phase 2a of J-MaVe Booking 2.0. Follow `CLAUDE.md`, `docs/PLAN.md` and `docs/phases/phase-2a-bookings-and-calendar.md`. Build the hold/exclusion constraint and its concurrency test first. Show me your plan first, then build.

## Goal

Quotations become bookings; a car can never be confirmed twice for the same time; payments are tracked; the fleet calendar replaces Google Calendar.

## Read first

- `CLAUDE.md`, `docs/PLAN.md` (§4 rows marked 2a, §6.2)
- `docs/reference/bookings-and-movement.md` §1–§4, §7, §8
- `docs/reference/import-map.md` "Phase 2a imports"

## Build, in order

1. **Migration**: `CREATE EXTENSION IF NOT EXISTS btree_gist`; tables `bookings`, `vehicle_holds`, `booking_charges`, `payments`, `drivers`; the exclusion constraint on `vehicle_holds` as raw SQL. Index bookings by (vehicle_id, start_at), status, number.
2. **Hold service** (`src/lib/holds.ts`): create/update/release holds inside the caller's transaction; maps the Postgres exclusion error (`23P01`) to a typed `VehicleConflictError` that names the conflicting booking/block.
3. **Concurrency test** (Vitest against a real test DB): two transactions confirming overlapping bookings for one car → exactly one succeeds. Back-to-back bookings separated by the turnaround buffer succeed; inside the buffer fail.
4. **Booking state machine** (`src/lib/booking-status.ts`) per bookings-and-movement.md §2, pure + tested; server actions use it.
5. **Convert to booking** from an issued formal quotation (Sales+): requires a specific vehicle; copies schedule, client, lines into `booking_charges` (`source = quote`); booking number = quotation number; quotation → `accepted`. Booking form adds the §1 fields (driver on license, license no., IDs presented, delivery/pick-up addresses, source channel, Rework link, notes).
6. **Availability** in the formal quotation and booking forms: for the chosen vehicle and times show "Available", "Overlaps pending reservation QTN-…" (warning), or "Booked by QTN-…" (error on confirm).
7. **Confirm / cancel / no-show / close** actions with the rules in §2. Confirm requires a reservation-fee payment unless Admin+ confirms without RF and gives a reason.
8. **Payments ledger** on the booking page: add entry (Sales+), void (Admin+), balance + deposit held per §3. Test with the real example in §3.
9. **Vehicle blocks** (Sales+): create/edit/end; kinds per §7; uses holds.
10. **Drivers** (`/drivers`, Sales+): list/add/edit; seed from `Back bone WDRIVER` during import. Assign on With Driver bookings; warn on overlap.
11. **Fleet calendar** (`/calendar`) per §4: week/month, filters, bars, drawer. Ops read-only. Must stay fast with 20 vehicles × 31 days.
12. **History import** (extend Settings → Import): Rental Log / WD Rental Log → quotations, bookings, charges, payments per import-map. Conflicts listed in preview.
13. **Client page**: rental history (bookings + quotations), lifetime days rented, repeat status now from bookings.
14. **E2E**: issue quote → convert → add RF payment → confirm → calendar shows bar; second booking for same car/time → confirm refused with the conflicting number.

## Acceptance criteria

- [ ] Double booking is impossible even with direct concurrent requests (test proves it).
- [ ] Pending reservations never block; they show striped and warn.
- [ ] Ledger balance for the §3 example is 0 with deposit held 2,000.
- [ ] Imported future `BOOKED` rows appear on the calendar; past ones show in client history.
- [ ] Operations sees the calendar read-only and cannot reach booking edit actions (403).
- [ ] Lint, typecheck, tests, e2e pass. Deployed.

## Out of scope

Movement board, check-in, roster (2b). Rewards (3). Public page (4).

## Hand-off

Progress log entry with import results (bookings created, conflicts). Ask before committing (branch `phase-2a`).

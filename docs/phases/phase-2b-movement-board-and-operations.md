# Phase 2b — Daily Movement board, check-in, roster

> **Kickoff prompt:**
> Build Phase 2b of J-MaVe Booking 2.0. Follow `CLAUDE.md`, `docs/PLAN.md` and `docs/phases/phase-2b-movement-board-and-operations.md`. Show me your plan first, then build.

## Goal

The Daily Movement Sheet is replaced by a live board. Operations records releases and returns from a phone, and the system adds actual charges. The shift roster lives in the system.

## Read first

- `CLAUDE.md`, `docs/PLAN.md` (§4 rows marked 2b, §8 Q6)
- `docs/reference/bookings-and-movement.md` §5, §6, §9
- `docs/reference/pricing.md` §1 (excess mileage), §2.2 (hourly extension)

## Build, in order

1. **Schema**: `movement_events`, `shift_templates` (seed the five templates), `shift_assignments`.
2. **Movement derivation** (`src/lib/movements.ts`, pure + tested): from bookings/blocks/events for a date range, produce per-vehicle day status and timeline events with codes (OUT/IN/EXT + FD/PU/WD/PR). Cover: multi-day rentals, returns due today, blocks, pending, With Driver.
3. **Release check-in** (Ops+): mobile-first form per §5; writes `movement_events` (kind `release`, actual time, odometer, fuel eighths); booking → `released`. Requires the booking to be `confirmed`.
4. **Return check-in** (Ops+): per §5; computes excess km, fuel shortage, late-return extension as `booking_charges` (`source = check_in`); shows them before saving; booking → `returned`; hold end updated. Ops cannot delete auto charges; Admin+ can remove with a reason.
5. **Extension** (Sales+): extend end time on a confirmed/released booking; price extra hours with the engine; update hold in the same transaction (conflict → refuse); `movement_events` kind `extension`.
6. **Board** (`/board`) per §6: date picker, fleet status table, 30-min timeline, 5-day look-ahead, With Driver trips, special instructions, today's roster. Row actions by role. Auto-refresh 60 s. Usable on a phone (stacked cards under 768 px).
7. **Board PDF**: A4 landscape, one page per day.
8. **Roster** (`/roster`): week grid editor (Admin+), copy previous week, view for all. Dashboard widget "On duty now".
9. **Ops experience**: Ops lands on `/board`; their menu is Board, Calendar, Roster.
10. **E2E**: confirmed 1-day Self-Drive Sedan booking (vehicle tank 42 L, gasoline ₱94) → Ops releases (odo 10,000, fuel 8/8) → returns next day (odo 10,450, fuel 6/8, 2 h after `end_at`) → charges appear → balance updates.

## Acceptance criteria

- [ ] For a day with real imported bookings, the board shows the same cars/statuses the team would have typed in the DMS.
- [ ] The return in step 10 produces exactly (unit-tested): excess km (450 − 150) × 4 = **₱1,200**; fuel shortage 42 × 2 ÷ 8 × 94 = **₱987**; late return 2 h × 300 = **₱600**.
- [ ] Ops can release/return but cannot edit bookings, payments or quotations (403 tests).
- [ ] Board loads in < 1.5 s with 20 vehicles on Railway.
- [ ] Lint, typecheck, tests, e2e pass. Deployed.

## Out of scope

Photos/videos at release (later, if wanted). Rewards (3).

## Hand-off

Progress log entry. Ask before committing (branch `phase-2b`).

# Phase 3 — Rewards, worker service, email

> **Kickoff prompt:**
> Build Phase 3 of J-MaVe Booking 2.0. Follow `CLAUDE.md`, `docs/PLAN.md` and `docs/phases/phase-3-rewards-and-email.md`. Show me your plan first, then build.

## Goal

Clients earn and redeem loyalty points; background jobs run in a separate Railway worker; quotations can be emailed with the PDF attached.

## Owner does before this session

- Create a Resend account, verify the sending domain, set `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `J-MaVe Cars <quotes@yourdomain>`) in Railway.

## Read first

- `CLAUDE.md`, `docs/PLAN.md` (§3 worker, §4 rows marked 3 and `outbox`, §6.6, §8 Q5 and Q12)
- `docs/reference/pricing.md` §4
- `docs/reference/import-map.md` "Phase 3 import"

## Build, in order

1. **Worker service**: `src/worker/index.ts` starting `pg-boss` against `DATABASE_URL`; Railway service `worker` from the same repo with its own start command. Graceful shutdown. Health log line on start.
2. **Outbox**: table `outbox` (PLAN §4; create it in this phase), enqueue helper used inside request transactions, worker job that sends and records results with exponential backoff (max 8).
3. **Scheduled jobs**: nightly (00:05 Asia/Manila) mark quotations `expired`; nightly mark loyalty accounts expired.
4. **Loyalty schema**: `loyalty_accounts`, `points_ledger`; sequence `JMV`.
5. **Earning**: when a booking becomes `returned`, create the account if missing (`member_since` = that date, `expires_at` = +1 year), add `earn` = 50 × rental days. Idempotent per booking. Reverting a return reverses it.
6. **Redemption** on formal quotations (Sales+): choose peso discount or free hours (pricing.md §4); engine adds the line; points are **deducted when the booking is confirmed**, refunded if the booking is cancelled. Cannot redeem more than the balance; blocked if the account is expired.
7. **Loyalty page** (`/rewards` + client tab): card number, member since, expiry, tier, points, peso value, history (like the old `Interface` tab). Manual adjustment (Admin+, reason required). Tier editable (Super Admin).
8. **Loyalty import** per import-map (extend Settings → Import).
9. **Email quotation**: "Send by email" on issued formal quotations (Sales+): recipient (client email, editable), message; enqueue outbox `email` with PDF attachment; show delivery status on the quotation.
10. **Tests**: earn/redeem/refund ledger math; idempotency; worker retry behaviour with a failing fake transport.

## Acceptance criteria

- [ ] A 3-day returned booking adds 150 points (₱3 value).
- [ ] Redeeming 15,000 points as 1 free Sedan hour shows a ₱0 "Free hours (rewards)" line and deducts on confirm, refunds on cancel.
- [ ] Imported loyalty totals match the `Loyalty Log` sums per card.
- [ ] Email arrives with the correct PDF; a failing send retries and ends `failed` with the error visible.
- [ ] Web requests never call Resend directly.
- [ ] Lint, typecheck, tests, e2e pass. Web and worker deployed.

## Out of scope

Public page, Rework (4).

## Hand-off

Progress log entry. Ask before committing (branch `phase-3`).

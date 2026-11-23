# Phase 5 — Hardening

> **Kickoff prompt:**
> Build Phase 5 of J-MaVe Booking 2.0. Follow `CLAUDE.md`, `docs/PLAN.md` and `docs/phases/phase-5-hardening.md`. Show me your plan first, then build.

## Goal

Safe to run the business on: audited, backed up, monitored, tested end to end, with a staging environment.

## Owner does before this session

- Create a Sentry project (or approve another error tracker) and set `SENTRY_DSN`.
- Decide backup storage (Railway Postgres backups, plus optional off-site dumps to an S3-compatible bucket).

## Read first

- `CLAUDE.md`, `docs/PLAN.md` (whole file, especially the Progress log and Open questions)

## Build, in order

1. **Audit viewer** (`/audit`, Admin+): filter by actor, entity, action, date; before/after diff view. Confirm every write path listed in CLAUDE.md is audited; add missing ones.
2. **Security review** (run the `/security-review` command, then fix):
   - every server action/route checks permissions (add a test that enumerates all actions);
   - security headers + CSP; cookie flags; CSRF on mutations;
   - upload validation (import);
   - no PII or secrets in logs (scan log calls);
   - rate limits on login, setup, public endpoints;
   - share tokens are random 32 bytes and unguessable.
3. **Observability**: Sentry for web + worker (scrub PII and the Rework token), structured JSON logs, request ids.
4. **Backups**: enable Railway Postgres backups; document and test a restore into staging. Optional nightly `pg_dump` from the worker to off-site storage.
5. **Staging**: a Railway `staging` environment with its own DB, seeded with invented data (seed script, no real clients). Preview deploys if useful.
6. **E2E suite**: one journey per role (Super Admin setup + rate activation; Admin user management; Sales quote → booking → payment; Ops release/return; public request → inquiry). Run in CI (GitHub Actions) against a disposable Postgres.
7. **Performance**: indexes for slow queries (check with `EXPLAIN`), board and calendar under 1.5 s, PDF under 2 s.
8. **Accessibility**: keyboard navigation, labels, contrast on main flows.
9. **Docs**: `docs/user-guide.md` — one short section per role with screenshots of the main flows.
10. **Resolve open questions**: walk the owner through PLAN §8 items still open; record answers in §7.

## Acceptance criteria

- [ ] Security review findings fixed or accepted by the owner in writing (PLAN decisions log).
- [ ] Restore test done and documented.
- [ ] CI runs lint, typecheck, unit, e2e on every push.
- [ ] Staging exists with invented data only.
- [ ] User guide covers every role.

## Hand-off

Final Progress log entry with a "Go-live checklist" status. Ask before committing (branch `phase-5`).

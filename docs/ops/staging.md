# Staging

Phase 5. Railway environment **`staging`** in project `jmave-booking`. It was forked from production on 2026-11-27 and has its own Postgres and volume. **It holds invented data only.**

| | |
|---|---|
| URL | https://jmave-booking-20-staging-124dd0c5.up.railway.app |
| Services | `jmave-booking-2.0` (app), `Postgres` (own volume), `worker`, `backup` (cron, off until `BACKUP_S3_*` is set) |
| Deploys | The app follows GitHub `main` (same as production). Branch builds go out with `railway up --service jmave-booking-2.0 --environment staging` (and `--service worker`). `.railwayignore` keeps `migration/source/` and `.env*` out of uploads. |
| Variables | Its own `BETTER_AUTH_SECRET`, `SETUP_TOKEN`, `SEED_PASSWORD`, `APP_URL` (the URL above). Sentry DSNs with `SENTRY_ENVIRONMENT=staging`. Cloudflare's published Turnstile **test** keys (always pass). No Resend key and no Rework variables, so emails and leads stay in the outbox as failed. |
| Health check | `/api/health` (staging only so far) |

## Staff accounts (invented)

`owner@staging.jmave.test` (Super Admin), `admin@…` (Admin), `sales1@…` and `sales2@…` (Sales), `ops1@…` and `ops2@…` (Operations), all on the domain `staging.jmave.test`.

They all share one password: the `SEED_PASSWORD` variable on the staging app service. Read it in Railway → staging → `jmave-booking-2.0` → Variables. It is never printed in logs or chat.

## What the seed creates

`pnpm db:seed:staging` (`src/lib/seed/staging.ts`) creates:

- **Cars:** 8, with plates `TST 1001`…`TST 6001`.
- **Clients:** 20 invented clients. Phones are `+63917000xxxx`, emails end in `@example.test`, and one client is blacklisted.
- **Rate card:** the pricing.md values (golden tests).
- **Bookings:** 6, made through the real services:
  - one returned last week, with check-in charges and points;
  - one out now;
  - three confirmed;
  - one pending reservation;
  - one With Driver day trip among them.
- **Quotations:** an issued quotation not yet converted, and a quick estimate.
- **Other:** a maintenance block, three holidays, and a two-week roster.

## Reset and reseed

The script refuses to run unless `RAILWAY_ENVIRONMENT_NAME` is `staging` or the database host is local. It never runs in production.

Run it from a machine that can reach the staging DB. The staging Postgres TCP proxy was **removed** on 2026-11-27 (security review). Add it for the run (Railway → staging → Postgres → Settings → Networking → TCP Proxy, port 5432) and remove it afterwards:

```sh
DATABASE_URL="<staging public URL>" RAILWAY_ENVIRONMENT_NAME=staging SEED_PASSWORD="<from Railway>" \
  pnpm db:seed:staging --reset
```

`--reset` empties every app table except the shift templates. Without it, the script refuses if users exist.


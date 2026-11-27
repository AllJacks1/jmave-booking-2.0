# Backups and restore

Phase 5. Applies to the Railway project `jmave-booking` (Singapore).

## What is in place

| Layer | Status (2026-11-27) |
|---|---|
| Railway volume backups (daily / weekly / monthly) | **Not available.** Railway refused with "Manual backups and backup schedules are only available for Pro workspaces" (the workspace is on the trial plan). The owner decided to rely on off-site dumps instead. |
| Nightly off-site `pg_dump` | **Built and deployed, waiting for a bucket.** Railway cron service `backup` exists in **production** and **staging**. It runs at 18:00 UTC (02:00 Asia/Manila). Until every `BACKUP_S3_*` variable is set, it logs `backup disabled` and exits. |
| Restore procedure | **Tested 2026-11-27** on staging (see "Restore test record" below). |

## How the nightly dump works

- Service `backup`, built from `ops/backup/Dockerfile`: `postgres:18-alpine` plus `aws-cli`.
- `pg_dump` has to match the server's major version (Railway Postgres 18). That is why the job runs in the Postgres image and not in the Node worker.
- `ops/backup/backup.sh` does the following:
  - runs `pg_dump --format=custom --compress=6 --no-owner --no-privileges`;
  - checks the archive (`pg_restore --list` must show at least 10 tables of data);
  - uploads it to `s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/<environment>/<UTC stamp>.dump`;
  - logs JSON lines with the key, size and table count only, never URLs or credentials.
- Retention is set on the bucket, not in the script. Use a lifecycle rule such as "delete after 35 days", or keep 30 daily plus 12 monthly copies.

### Turn it on (owner)

1. Create a bucket at an S3-compatible provider (Cloudflare R2 or Backblaze B2 are cheap). Use a region near Singapore if the provider offers one.
2. Create an access key that can **only write and read that bucket**.
3. In Railway, set these variables on the `backup` service, in **production** (and in staging if you want staging dumps too):
   - `BACKUP_S3_ENDPOINT`, for example `https://<account>.r2.cloudflarestorage.com`
   - `BACKUP_S3_BUCKET`
   - `BACKUP_S3_ACCESS_KEY_ID`
   - `BACKUP_S3_SECRET_ACCESS_KEY`
   - `BACKUP_S3_REGION` (`auto` for R2)
   - `BACKUP_S3_PREFIX` (optional, default `jmave-booking`)
4. Run the service once from the Railway dashboard (the `backup` service, then **Run now**). The log should show `backup uploaded` with a key and a size.
5. Do a restore check of that dump (below). Then tick the item in the go-live checklist.

## Restore

### Restore check (no risk: scratch database)

```sh
# Inside the backup image, or anywhere with pg_restore 18 + psql + aws-cli:
restore-check.sh <dump file or S3 key> <postgres URL of a database named *_restore_check>
```

The script does the following:

- wipes the scratch database (it refuses any name that does not end in `_restore_check`);
- restores the dump;
- prints the row count of every table.

Compare those counts with the source database.

Railway's Postgres build stores a private column option (`pg_attver`) that a stock Postgres rejects. The script removes those lines, so a dump also restores into a plain Postgres 18 (local, or a provider other than Railway).

### Real restore (production lost or damaged)

1. **Stop writes.** Scale the app service and the worker to 0 replicas (or pause them) so nothing writes to the database during the restore.
2. Add a **new** Postgres service in production (Railway → New → Database → PostgreSQL). Use version 18 and the Singapore region.
3. Restore the newest good dump into it from any machine with Postgres 18 tools:
   `pg_restore --no-owner --no-privileges --file=- <dump> | sed '/ SET (pg_attver=[0-9]*);$/d' | psql "<new DB public URL>" -v ON_ERROR_STOP=1`
4. Check the restore:
   - row counts per table (the query in `restore-check.sh`);
   - `select count(*) from pg_constraint where conname = 'vehicle_holds_no_overlap'` returns `1`;
   - the extensions `btree_gist` and `pg_trgm` exist.
5. Point the app's `DATABASE_URL` (and the worker's and the backup service's) to the new service: `${{<new service>.DATABASE_URL}}`.
6. Redeploy the app. The pre-deploy `pnpm db:migrate` applies only migrations that are missing.
7. Sign in, open today's board and the latest booking, and compare them with what staff remember. Anything entered after the dump was taken must be entered again by hand.
8. Keep the old database service until you are sure, then delete it.

Never restore production data into **staging**. Staging holds invented data only (see `docs/ops/staging.md`).

## Restore test record

**2026-11-27, staging (invented data)**

| | |
|---|---|
| Source | staging Postgres 18.7, seeded by `pnpm db:seed:staging` |
| Dump | `pg_dump` 18.6, custom format, 206,547 bytes, 14.5 s over the TCP proxy |
| Target | scratch database `jmave_restore_check` on a stock Postgres 18.6 |
| Restore | `ops/backup/restore-check.sh`, 1.2 s |
| Result | 28 tables. **0 row-count mismatches** (e.g. bookings 6, quotations 8, clients 20, payments 5, audit_log 62, vehicle_holds 6). Double-booking exclusion constraint present. |
| Problem found and fixed | The first attempt failed on `ALTER … SET (pg_attver=…)`, which Railway adds. The script now strips it. |

The S3 leg (upload, then download the same file) is **not tested yet**: no bucket exists. Test it in step 4–5 of "Turn it on".

#!/bin/sh
# Restore test (Phase 5): restore a dump into a scratch database and print
# row counts per table, to compare with the source.
#
#   restore-check.sh <dump file | s3 key> <scratch database URL>
#
# The scratch database name must end in _restore_check (it is wiped).
set -eu
SRC="$1"
TARGET="$2"
case "$TARGET" in *_restore_check|*_restore_check\?*) ;; *) echo "target database must end in _restore_check" >&2; exit 2 ;; esac

if [ ! -f "$SRC" ]; then
  export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}"
  aws s3 cp "s3://${BACKUP_S3_BUCKET}/${SRC}" /tmp/restore.dump --endpoint-url "$BACKUP_S3_ENDPOINT" --only-show-errors
  SRC=/tmp/restore.dump
fi

psql "$TARGET" -v ON_ERROR_STOP=1 -q -c 'SET client_min_messages = warning;' -c 'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; CREATE SCHEMA public;'
# Railway's Postgres build stores a private column option (pg_attver) that a
# stock Postgres rejects; drop those lines so the dump restores anywhere.
pg_restore --no-owner --no-privileges --file=- "$SRC" | sed '/ SET (pg_attver=[0-9]*);$/d' | psql "$TARGET" -v ON_ERROR_STOP=1 -q -o /dev/null
psql "$TARGET" -At -c "select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"

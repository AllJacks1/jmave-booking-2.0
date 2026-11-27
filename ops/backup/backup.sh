#!/bin/sh
# Dump DATABASE_URL (custom format) and upload it to an S3-compatible bucket.
# Off until every BACKUP_S3_* variable is set: then it logs "backup disabled"
# and exits 0, so the cron service is harmless without a bucket.
# Logs are JSON lines with sizes and keys only (never URLs or credentials).
set -eu

log() { printf '{"at":"%s","svc":"backup","msg":"%s"%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "${2:-}"; }

for v in DATABASE_URL BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
  eval "val=\${$v:-}"
  if [ -z "$val" ]; then log "backup disabled" ",\"missing\":\"$v\""; exit 0; fi
done

ENV_NAME="${RAILWAY_ENVIRONMENT_NAME:-local}"
STAMP="$(date -u +%Y-%m-%dT%H%MZ)"
KEY="${BACKUP_S3_PREFIX:-jmave-booking}/${ENV_NAME}/${STAMP}.dump"
FILE="/tmp/${STAMP}.dump"

export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}"

log "dump started" ",\"env\":\"$ENV_NAME\""
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$FILE" "$DATABASE_URL"
# Sanity check: the archive must list its tables.
TABLES="$(pg_restore --list "$FILE" | grep -c ' TABLE DATA ' || true)"
SIZE="$(wc -c < "$FILE" | tr -d ' ')"
if [ "$TABLES" -lt 10 ]; then log "dump looks empty" ",\"tables\":$TABLES"; exit 1; fi

aws s3 cp "$FILE" "s3://${BACKUP_S3_BUCKET}/${KEY}" --endpoint-url "$BACKUP_S3_ENDPOINT" --only-show-errors
rm -f "$FILE"
log "backup uploaded" ",\"key\":\"$KEY\",\"bytes\":$SIZE,\"tables\":$TABLES"

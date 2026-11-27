# Nightly off-site Postgres dump (Phase 5). Railway cron service "backup".
# pg_dump must match the server's major version (Railway Postgres 18), so the
# job runs in the official postgres:18 image instead of the Node worker.
FROM postgres:18-alpine
RUN apk add --no-cache aws-cli ca-certificates
COPY ops/backup/backup.sh /usr/local/bin/backup.sh
COPY ops/backup/restore-check.sh /usr/local/bin/restore-check.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore-check.sh
CMD ["/usr/local/bin/backup.sh"]

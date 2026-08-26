#!/usr/bin/env bash
# Automated PostgreSQL backup for a self-managed Postgres deployment (i.e.
# the docker-compose.prod.yml path, where Postgres runs in a container
# rather than RDS). If you're using RDS, prefer its built-in automated
# backups instead — see infra/aws/DEPLOYMENT_GUIDE.md §7 for why.
#
# Intended to run on a daily cron on the host running the Postgres
# container, e.g.:
#   0 2 * * * /opt/rosterpro/infra/aws/backup.sh >> /var/log/rosterpro-backup.log 2>&1
#
# Required environment (set in the crontab or a sourced env file):
#   DB_CONTAINER   - name of the running Postgres container (default: rosterpro-db)
#   DB_USER        - Postgres user (default: rosterpro)
#   DB_NAME        - database name (default: rosterpro)
#   S3_BUCKET      - target bucket, e.g. rosterpro-backups-yourcompany
#   RETENTION_DAYS - how many days of LOCAL backups to keep (default: 7);
#                    S3 lifecycle rules should handle longer-term retention
#                    (set on the bucket itself, not by this script)

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-rosterpro-db}"
DB_USER="${DB_USER:-rosterpro}"
DB_NAME="${DB_NAME:-rosterpro}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
BACKUP_DIR="${BACKUP_DIR:-/opt/rosterpro/backups}"

if [ -z "${S3_BUCKET:-}" ]; then
  echo "ERROR: S3_BUCKET is not set. Refusing to run a backup with nowhere durable to put it." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
DUMP_FILE="$BACKUP_DIR/rosterpro-$TIMESTAMP.sql"

echo "[$(date -Iseconds)] Starting backup: $DUMP_FILE"

# pg_dump runs INSIDE the container (it already has the right Postgres
# client tools/version matched to the server) — piped straight to a file
# on the host rather than writing inside the container, so it survives
# the container being recreated.
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" > "$DUMP_FILE"

gzip "$DUMP_FILE"
DUMP_FILE="$DUMP_FILE.gz"
echo "[$(date -Iseconds)] Dump complete: $(du -h "$DUMP_FILE" | cut -f1)"

aws s3 cp "$DUMP_FILE" "s3://$S3_BUCKET/$(basename "$DUMP_FILE")" --storage-class STANDARD_IA
echo "[$(date -Iseconds)] Uploaded to s3://$S3_BUCKET/$(basename "$DUMP_FILE")"

# Prune local copies older than RETENTION_DAYS — S3 is the durable copy;
# the local disk is just a staging area and a fast-restore convenience for
# very recent backups.
find "$BACKUP_DIR" -name "rosterpro-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete
echo "[$(date -Iseconds)] Pruned local backups older than $RETENTION_DAYS days"

echo "[$(date -Iseconds)] Backup complete."

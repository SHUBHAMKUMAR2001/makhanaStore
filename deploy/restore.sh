#!/usr/bin/env bash
#
# Restore the database from a dump produced by backup.sh.
#
#   ./deploy/restore.sh /var/backups/lead-engine/db-20260901-020000.sql.gz
#
# This REPLACES the current database contents. It asks first, because the
# common way to lose data during a restore is restoring the wrong file onto a
# database that was actually fine.

set -Eeuo pipefail

DUMP="${1:-}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Usage: $0 <path-to-db-dump.sql.gz>" >&2
  echo >&2
  echo "Available backups:" >&2
  ls -lh /var/backups/lead-engine/db-*.sql.gz 2>/dev/null >&2 || echo "  (none found)" >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; source .env; set +a
: "${POSTGRES_USER:=lead}"
: "${POSTGRES_DB:=lead_engine}"

CURRENT_LEADS=$(docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SELECT count(*) FROM "Lead"' 2>/dev/null || echo "unknown")

echo "About to restore:  $DUMP"
echo "Into database:     $POSTGRES_DB"
echo "It currently holds: $CURRENT_LEADS leads — these will be REPLACED."
echo
read -r -p "Type the database name to confirm: " CONFIRM
if [[ "$CONFIRM" != "$POSTGRES_DB" ]]; then
  echo "Aborted." >&2
  exit 1
fi

# Stop the services that write, so nothing races the restore.
docker compose stop api docgen outreach scraper

gunzip -c "$DUMP" | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

docker compose start api docgen outreach scraper

RESTORED=$(docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SELECT count(*) FROM "Lead"')
echo "Restore complete. The database now holds $RESTORED leads."

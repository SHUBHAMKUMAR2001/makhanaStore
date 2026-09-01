#!/usr/bin/env bash
#
# Nightly backup: the database, plus the generated documents.
#
# The leads table is the entire asset of this system — months of scraping and
# calling. Restoring from a two-week-old dump would be painful; having none at
# all would end the business tool. Run this from cron:
#
#   0 2 * * * /opt/makhanaStore/deploy/backup.sh >> /var/log/lead-backup.log 2>&1
#
# Exit codes: 0 success, 1 configuration problem, 2 backup failed.

set -Eeuo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/lead-engine}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

cd "$REPO_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: no .env in $REPO_DIR — cannot read database credentials" >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

: "${POSTGRES_USER:=lead}"
: "${POSTGRES_DB:=lead_engine}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

DB_FILE="$BACKUP_DIR/db-$TIMESTAMP.sql.gz"
DOCS_FILE="$BACKUP_DIR/documents-$TIMESTAMP.tar.gz"

echo "[$(date -Is)] starting backup"

# --- database ---------------------------------------------------------------
# Dump through the running container so this needs no local postgres client and
# always matches the server version.
if ! docker compose exec -T postgres \
      pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
      | gzip -9 > "$DB_FILE"; then
  echo "ERROR: pg_dump failed" >&2
  rm -f "$DB_FILE"
  exit 2
fi

# A dump that is suspiciously small usually means pg_dump wrote an error to
# stdout and exited 0 through the pipe. Catch that here rather than discovering
# it during a restore.
DB_BYTES=$(stat -c%s "$DB_FILE")
if (( DB_BYTES < 1024 )); then
  echo "ERROR: dump is only ${DB_BYTES} bytes — treating as failed" >&2
  rm -f "$DB_FILE"
  exit 2
fi

# --- generated documents ----------------------------------------------------
# Quotations can be regenerated from Document.meta, but the issued file is what
# the customer actually received, so keep the bytes.
#
# Ask Compose for the real volume name rather than deriving it from the
# directory. Compose prefixes volumes with the project name from the `name:`
# field in docker-compose.yml, which is NOT the directory name — guessing gives
# "makhanaStore_storage" when the volume is "makhana-lead-engine_storage", and
# the backup then fails silently every night.
PROJECT_NAME="$(docker compose config --format json 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("name",""))' 2>/dev/null || true)"
: "${PROJECT_NAME:=$(basename "$REPO_DIR")}"
STORAGE_VOLUME="${PROJECT_NAME}_storage"

if docker volume inspect "$STORAGE_VOLUME" >/dev/null 2>&1; then
  if docker run --rm \
      -v "$STORAGE_VOLUME:/data:ro" \
      -v "$BACKUP_DIR:/backup" \
      alpine tar czf "/backup/$(basename "$DOCS_FILE")" -C /data . ; then
    echo "archived documents from volume $STORAGE_VOLUME"
  else
    echo "WARNING: document backup failed (the database dump is still good)" >&2
  fi
else
  echo "WARNING: storage volume '$STORAGE_VOLUME' not found — skipping documents" >&2
fi

# --- retention --------------------------------------------------------------
find "$BACKUP_DIR" -name 'db-*.sql.gz'        -mtime "+$RETAIN_DAYS" -delete
find "$BACKUP_DIR" -name 'documents-*.tar.gz' -mtime "+$RETAIN_DAYS" -delete

echo "[$(date -Is)] backup complete: $(du -h "$DB_FILE" | cut -f1) database"
echo "  $DB_FILE"
[[ -f "$DOCS_FILE" ]] && echo "  $DOCS_FILE"

# --- offsite (optional) -----------------------------------------------------
# A backup on the same VM does not survive losing the VM. If the OCI CLI is
# configured and BACKUP_BUCKET is set, push a copy to Object Storage — the
# Always Free tier includes 20GB, which is far more than this needs.
if [[ -n "${BACKUP_BUCKET:-}" ]] && command -v oci >/dev/null 2>&1; then
  echo "uploading to Object Storage bucket $BACKUP_BUCKET"
  oci os object put --bucket-name "$BACKUP_BUCKET" --file "$DB_FILE" \
      --name "db/$(basename "$DB_FILE")" --force >/dev/null
  echo "upload complete"
else
  echo "NOTE: offsite copy skipped. Set BACKUP_BUCKET and configure the oci CLI"
  echo "      to keep a copy that survives losing this VM."
fi

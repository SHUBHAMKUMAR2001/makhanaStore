#!/usr/bin/env bash
#
# One-command local setup.
#
#   ./deploy/local-setup.sh
#
# Generates .env with real secrets, builds and starts every service, applies
# migrations, seeds the admin account and catalogue, then tells you where to go.
#
# Safe to re-run: an existing .env is never overwritten, so your password and
# session secret survive.

set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# --- 1. prerequisites -------------------------------------------------------
bold "Checking prerequisites"

command -v docker >/dev/null 2>&1 \
  || die "Docker is not installed. Install Docker Desktop: https://docs.docker.com/get-docker/"

docker compose version >/dev/null 2>&1 \
  || die "Docker Compose v2 is missing. It ships with Docker Desktop; on Linux install docker-compose-v2."

docker info >/dev/null 2>&1 \
  || die "Docker is installed but not running. Start Docker Desktop and try again."

ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo present)"

command -v openssl >/dev/null 2>&1 \
  || die "openssl is required to generate secrets. Install it and re-run."
ok "openssl"

# Refuse to start if something already holds the port Caddy needs.
if command -v lsof >/dev/null 2>&1 && lsof -iTCP:80 -sTCP:LISTEN >/dev/null 2>&1; then
  warn "Something is already listening on port 80."
  warn "Stop it, or set CADDY_SITE_ADDRESS=:8080 and PUBLIC_URL=http://localhost:8080 in .env."
fi

# --- 2. .env ----------------------------------------------------------------
bold "Configuring .env"

if [[ -f .env ]]; then
  ok ".env already exists — leaving it untouched"
else
  [[ -f .env.example ]] || die ".env.example is missing. Are you in the repository root?"

  ADMIN_EMAIL_INPUT="${ADMIN_EMAIL:-}"
  ADMIN_PASSWORD_INPUT="${ADMIN_PASSWORD:-}"

  if [[ -z "$ADMIN_EMAIL_INPUT" ]]; then
    read -r -p "  Login email: " ADMIN_EMAIL_INPUT
  fi
  [[ -n "$ADMIN_EMAIL_INPUT" ]] || die "An email is required — it is your login."

  if [[ -z "$ADMIN_PASSWORD_INPUT" ]]; then
    read -r -s -p "  Password (12+ characters): " ADMIN_PASSWORD_INPUT; echo
  fi
  [[ ${#ADMIN_PASSWORD_INPUT} -ge 12 ]] \
    || die "Password must be at least 12 characters (the seed script enforces this too)."

  PG_PASSWORD="$(openssl rand -hex 16)"
  SESSION_SECRET="$(openssl rand -hex 32)"
  INTERNAL_TOKEN="$(openssl rand -hex 32)"

  # Rewrite .env.example line by line rather than appending, so the generated
  # file keeps its comments and stays a readable reference.
  while IFS= read -r line; do
    case "$line" in
      POSTGRES_PASSWORD=*)   echo "POSTGRES_PASSWORD=${PG_PASSWORD}" ;;
      DATABASE_URL=*)        echo "DATABASE_URL=\"postgresql://lead:${PG_PASSWORD}@localhost:5432/lead_engine?schema=public\"" ;;
      SESSION_SECRET=*)      echo "SESSION_SECRET=${SESSION_SECRET}" ;;
      INTERNAL_API_TOKEN=*)  echo "INTERNAL_API_TOKEN=${INTERNAL_TOKEN}" ;;
      ADMIN_EMAIL=*)         echo "ADMIN_EMAIL=${ADMIN_EMAIL_INPUT}" ;;
      ADMIN_PASSWORD=*)      echo "ADMIN_PASSWORD=${ADMIN_PASSWORD_INPUT}" ;;
      PUBLIC_URL=*)          echo "PUBLIC_URL=http://localhost" ;;
      CADDY_SITE_ADDRESS=*)  echo "CADDY_SITE_ADDRESS=:80" ;;
      *)                     echo "$line" ;;
    esac
  done < .env.example > .env

  chmod 600 .env
  ok "generated .env with fresh secrets (mode 600)"
fi

# Load the values the checks below need.
# shellcheck disable=SC1091
set -a; source .env; set +a

# --- 3. build and start -----------------------------------------------------
bold "Building images"
warn "First run pulls base images and compiles Chromium support — 10-20 minutes."
warn "Later runs take seconds."
echo

docker compose build || die "Image build failed. Send the output above for diagnosis."
ok "images built"

bold "Starting services"
docker compose up -d || die "Startup failed. Run 'docker compose logs' to see which service."

# --- 4. wait for the API ----------------------------------------------------
bold "Waiting for the API to become healthy"
DEADLINE=$((SECONDS + 180))
until curl -sf http://localhost/api/health >/dev/null 2>&1; do
  if [[ $SECONDS -ge $DEADLINE ]]; then
    echo
    docker compose ps
    die "The API did not come up within 3 minutes. Try: docker compose logs api"
  fi
  printf '.'
  sleep 3
done
echo
ok "API healthy"

# --- 5. seed ----------------------------------------------------------------
bold "Seeding the admin account and catalogue"

# Pass the credentials explicitly as well as through compose. The seed skips
# creating the admin user when they are absent, and it skips *quietly* — which
# is correct on a re-run, but meant an earlier version of this script printed
# "Ready" over a stack nobody could log in to.
SEED_EMAIL="$(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2- | tr -d '"')"
SEED_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2- | tr -d '"')"

docker compose run --rm \
  -e ADMIN_EMAIL="$SEED_EMAIL" \
  -e ADMIN_PASSWORD="$SEED_PASSWORD" \
  migrate pnpm --filter @lead/db seed \
  || die "Seeding failed. The stack is running; see 'docker compose logs migrate'."

# Verify rather than trust. A seed that skipped the user exits 0.
USER_COUNT="$(docker compose exec -T postgres \
  psql -U "${POSTGRES_USER:-lead}" -d "${POSTGRES_DB:-lead_engine}" \
  -tAc 'SELECT count(*) FROM "User"' 2>/dev/null | tr -d '[:space:]')"

if [[ "${USER_COUNT:-0}" -lt 1 ]]; then
  die "The seed ran but created no login. Re-run with the credentials passed explicitly:
  docker compose run --rm -e ADMIN_EMAIL='<email>' -e ADMIN_PASSWORD='<password>' \\
    migrate pnpm --filter @lead/db seed"
fi
ok "login created (${USER_COUNT} user)"

# --- 6. done ----------------------------------------------------------------
ADMIN_EMAIL_SHOWN="$(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-)"
echo
bold "Ready."
echo
echo "  Open:  http://localhost"
echo "  Login: ${ADMIN_EMAIL_SHOWN}"
echo "  Password: the one you entered (also in .env)"
echo
echo "  Useful:"
echo "    docker compose logs -f          follow all logs"
echo "    docker compose ps               what is running"
echo "    docker compose down             stop everything (data is kept)"
echo "    ./deploy/backup.sh              back up the database"
echo
echo "  Next: replace the placeholder business details and prices under"
echo "  Catalogue before sending a quotation to a real buyer."

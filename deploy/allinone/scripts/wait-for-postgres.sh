#!/bin/bash
# Blocks until the sibling Postgres container accepts connections, then execs
# the given command. Postgres host/port come from rispacs.ini via
# POSTGRES_HOST/POSTGRES_PORT (entrypoint.sh exports these; defaults match
# deploy/allinone/docker-compose.yml's "postgres" service). Used by
# supervisord for orthanc/backend/mwl-scp so "the Postgres container was
# created and marked healthy" (Compose's service_healthy, checked once at
# startup) is never confused with "Postgres is reachable right now" (checked
# again here, and relied on for recovery via autorestart=true if it was
# ever true then becomes false, e.g. Postgres container restarted later).
set -e
HOST="${POSTGRES_HOST:-postgres}"
PORT="${POSTGRES_PORT:-5432}"
TRIES=0
MAX_TRIES=90
until pg_isready -h "${HOST}" -p "${PORT}" -U "${POSTGRES_USER}" -d "${RIS_DB_NAME:-ris}" >/dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  if [ "${TRIES}" -ge "${MAX_TRIES}" ]; then
    echo "wait-for-postgres: Postgres at ${HOST}:${PORT} not reachable after ${MAX_TRIES}s." >&2
    echo "wait-for-postgres: check that the 'postgres' container is running and" >&2
    echo "wait-for-postgres: database.host in rispacs.ini matches its actual hostname." >&2
    echo "wait-for-postgres: continuing anyway — supervisord will restart this program on failure." >&2
    break
  fi
  sleep 1
done
exec "$@"

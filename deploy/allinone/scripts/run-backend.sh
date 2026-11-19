#!/bin/bash
# docker-entrypoint.sh's own steps (prisma migrate deploy, then plain `node
# dist/prisma/seed.js`) rely on process env vars being already set — Prisma's
# CLI auto-loads .env from CWD, but plain `node` does NOT, so the seed step
# would fail with "DATABASE_URL not found" if only a .env file exists without
# also being exported into the process environment. The dev Compose stack
# never hits this because `env_file: .env` already injects vars directly;
# this wrapper reproduces that behavior here.
#
# Reads backend.env as plain KEY=VALUE lines (NOT `source`d as shell syntax —
# a value like BACKUP_CRON=0 2 * * * is valid dotenv but is NOT valid shell,
# since unquoted spaces/asterisks would be parsed as separate commands/globs).
set -e
while IFS= read -r line; do
  case "${line}" in ''|'#'*) continue ;; esac
  key="${line%%=*}"
  value="${line#*=}"
  export "${key}=${value}"
done < /data/config/backend.env
exec /opt/backend/docker-entrypoint.sh

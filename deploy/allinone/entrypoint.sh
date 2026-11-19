#!/bin/bash
# RIS + PACS "rispacs" application container — entrypoint.
#
# Postgres is NOT managed here — it is a sibling container (see
# deploy/allinone/docker-compose.yml), already started and healthy by the
# time this container starts (depends_on: condition: service_healthy), and
# its own init-db.sh (same script the dev stack uses) has already created
# both the ris and orthanc databases on ITS first boot. This entrypoint only
# waits for it to be reachable (step 6) and never runs initdb or CREATE
# DATABASE itself.
#
# 1. Read + validate /etc/rispacs/rispacs.ini (mounted by the operator).
# 2. Read the Postgres password from db_password.txt via POSTGRES_PASSWORD_FILE
#    (Compose secret) — never from rispacs.ini.
# 3. Create /data/{dicom,redis,archive,backups,logs,config} (no /data/postgres
#    here — that belongs to the sibling postgres container's own volume).
# 4. Every run: generate nginx config, Orthanc env, backend env, mwl-scp env;
#    hand off to supervisord, which runs backend migrations itself via its
#    own docker-entrypoint-equivalent logic (see [program:backend] note).
set -euo pipefail

INI_PATH="${RISPACS_INI:-/etc/rispacs/rispacs.ini}"
DATA="/data"
CONFIG_DIR="${DATA}/config"
SECRETS_FILE="${CONFIG_DIR}/secrets.env"

# ---- 0. database password, from the Compose secret file, never from ini ---
if [ -n "${POSTGRES_PASSWORD_FILE:-}" ] && [ -f "${POSTGRES_PASSWORD_FILE}" ]; then
  DB_PASSWORD=$(cat "${POSTGRES_PASSWORD_FILE}")
else
  DB_PASSWORD="${POSTGRES_PASSWORD:-}"
fi

log() { echo "[entrypoint] $*"; }
fail() { echo "[entrypoint] FATAL: $*" >&2; exit 1; }

# ---- 1. ini file presence -------------------------------------------------
if [ ! -f "${INI_PATH}" ]; then
  mkdir -p "${CONFIG_DIR}"
  cp /etc/rispacs/rispacs.ini.example "${CONFIG_DIR}/rispacs.ini"
  fail "No configuration found at ${INI_PATH}. A template has been copied to
${CONFIG_DIR}/rispacs.ini — edit it (especially every 'CHANGE ME' value),
then mount it at ${INI_PATH} (or set RISPACS_INI) and restart the container."
fi

# ---- tiny INI reader: ini_get <section> <key> [default] -------------------
ini_get() {
  local section="$1" key="$2" default="${3:-}"
  local value
  value=$(awk -F '=' -v s="[$section]" -v k="$key" '
    $0 == s { insec=1; next }
    /^\[/ { insec=0 }
    insec && $1 ~ "^[ \t]*"k"[ \t]*$" { sub(/^[^=]*=[ \t]*/, ""); gsub(/[ \t]+$/, ""); print; exit }
  ' "${INI_PATH}")
  if [ -z "${value}" ]; then echo "${default}"; else echo "${value}"; fi
}

# ---- 2. read ini values -----------------------------------------------
PUBLIC_HOST=$(ini_get server public_host)
HTTP_PORT=$(ini_get server http_port 80)
TZ_VAL=$(ini_get server timezone Asia/Kolkata)
EXTRA_ORIGINS=$(ini_get server extra_origins)

DICOM_AET=$(ini_get dicom ae_title RISPACS)
DICOM_PORT=$(ini_get dicom dicom_port 4242)
CHECK_MODALITY_HOST=$(ini_get dicom check_modality_host false)

MWL_AET=$(ini_get mwl ae_title RISMWL)
MWL_PORT=$(ini_get mwl port 4243)

DB_HOST=$(ini_get database host postgres)
DB_PORT=$(ini_get database port 5432)
DB_USER=$(ini_get database user pacs)
RIS_DB_NAME=$(ini_get database ris_db ris)
ORTHANC_DB_NAME=$(ini_get database orthanc_db orthanc)

SEED_USERNAME=$(ini_get admin seed_username admin)
SEED_EMAIL=$(ini_get admin seed_email admin@example.local)
SEED_PASSWORD=$(ini_get admin seed_password)

SUPERVISOR_UI_USER=$(ini_get services_ui user admin)
SUPERVISOR_UI_PASSWORD=$(ini_get services_ui password)

ORTHANC_USERNAME=$(ini_get orthanc username orthanc)
ORTHANC_PASSWORD=$(ini_get orthanc password)

BACKUP_CRON=$(ini_get backup cron "0 2 * * *")
BACKUP_RETENTION_DAYS=$(ini_get backup retention_days 30)
BACKUP_MIN_FREE_MB=$(ini_get backup min_free_mb 500)

JWT_ACCESS_SECRET_INI=$(ini_get backend jwt_access_secret)
JWT_REFRESH_SECRET_INI=$(ini_get backend jwt_refresh_secret)
PASSWORD_PEPPER_INI=$(ini_get backend password_pepper)

[ -n "${PUBLIC_HOST}" ] || fail "server.public_host is not set in ${INI_PATH}"
[ -n "${DB_PASSWORD}" ] && [ "${DB_PASSWORD}" != "change-me-postgres-password" ] || fail "db_password.txt is missing, empty, or still the example value. Copy db_password.txt.example to db_password.txt and set a real password (it must match the sibling postgres container's own POSTGRES_PASSWORD_FILE)."
[ -n "${SUPERVISOR_UI_PASSWORD}" ] && [ "${SUPERVISOR_UI_PASSWORD}" != "change-me" ] || fail "services_ui.password must be set to a real value in ${INI_PATH}"
[ -n "${ORTHANC_PASSWORD}" ] && [ "${ORTHANC_PASSWORD}" != "change-me" ] || fail "orthanc.password must be set to a real value in ${INI_PATH}"

# ---- 3. /data layout (no /data/postgres — that belongs to the sibling
#         postgres container's own volume, see docker-compose.yml) ---------
mkdir -p "${DATA}/dicom" "${DATA}/redis" "${DATA}/archive" \
         "${DATA}/backups" "${DATA}/logs" "${CONFIG_DIR}" "${CONFIG_DIR}/worklists"

# ---- 4. secrets: generate once, persist forever ------------------------
if [ ! -f "${SECRETS_FILE}" ]; then
  log "generating JWT secrets (first boot) -> ${SECRETS_FILE}"
  umask 077
  {
    echo "JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET_INI:-$(head -c48 /dev/urandom | base64 | tr -d '\n')}"
    echo "JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET_INI:-$(head -c48 /dev/urandom | base64 | tr -d '\n')}"
    echo "PASSWORD_PEPPER=${PASSWORD_PEPPER_INI:-$(head -c32 /dev/urandom | base64 | tr -d '\n')}"
    echo "INGEST_SECRET=$(head -c32 /dev/urandom | base64 | tr -d '\n')"
  } > "${SECRETS_FILE}"
fi
# shellcheck disable=SC1090
source "${SECRETS_FILE}"

# ---- 5. CORS origins, derived from public_host + http_port -------------
CORS_ORIGINS="http://${PUBLIC_HOST}:${HTTP_PORT},http://${PUBLIC_HOST}"
if [ "${HTTP_PORT}" = "80" ]; then CORS_ORIGINS="http://${PUBLIC_HOST},${CORS_ORIGINS}"; fi
if [ -n "${EXTRA_ORIGINS}" ]; then CORS_ORIGINS="${CORS_ORIGINS},${EXTRA_ORIGINS}"; fi

# ---- 6. wait for the sibling Postgres container to be reachable ----------
# Database creation (ris + orthanc) already happened on THAT container's own
# first boot via scripts/init-db.sh (same script, same mechanism the dev
# stack uses) — this entrypoint never runs initdb or CREATE DATABASE.
export POSTGRES_USER="${DB_USER}" POSTGRES_PASSWORD="${DB_PASSWORD}" POSTGRES_HOST="${DB_HOST}" POSTGRES_PORT="${DB_PORT}" RIS_DB_NAME="${RIS_DB_NAME}"
log "waiting for postgres at ${DB_HOST}:${DB_PORT}..."
TRIES=0
MAX_TRIES=90
until pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${RIS_DB_NAME}" >/dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  if [ "${TRIES}" -ge "${MAX_TRIES}" ]; then
    fail "Postgres at ${DB_HOST}:${DB_PORT} was not reachable after ${MAX_TRIES}s. Check
that the 'postgres' container (from docker-compose.yml) is running and
healthy, and that database.host/port in ${INI_PATH} match its actual
hostname/port, before retrying."
  fi
  sleep 1
done
log "postgres is reachable"

# ---- 7. backend env (consumed by [program:backend] via supervisord
#         'environment=' is limited, so we write a real .env file instead) --
cat > "${CONFIG_DIR}/backend.env" <<EOF
NODE_ENV=production
TZ=${TZ_VAL}
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${RIS_DB_NAME}?schema=public
POSTGRES_HOST=${DB_HOST}
POSTGRES_PORT=${DB_PORT}
POSTGRES_USER=${DB_USER}
POSTGRES_PASSWORD=${DB_PASSWORD}
RIS_DB_NAME=${RIS_DB_NAME}
ORTHANC_DB_NAME=${ORTHANC_DB_NAME}
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=__REDIS_PASSWORD_PLACEHOLDER__
JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=604800
PASSWORD_PEPPER=${PASSWORD_PEPPER}
SEED_ADMIN_USERNAME=${SEED_USERNAME}
SEED_ADMIN_EMAIL=${SEED_EMAIL}
SEED_ADMIN_PASSWORD=${SEED_PASSWORD}
ORTHANC_URL=http://127.0.0.1:8042
ORTHANC_USERNAME=${ORTHANC_USERNAME}
ORTHANC_PASSWORD=${ORTHANC_PASSWORD}
ORTHANC_AET=${DICOM_AET}
ORTHANC_DICOM_PORT=${DICOM_PORT}
DICOM_STORAGE_PATH=${DATA}/dicom
APP_LOG_PATH=${DATA}/logs
BACKUP_PATH=${DATA}/backups
ARCHIVE_ROOT=${DATA}/archive
ORTHANC_STORAGE_RO_PATH=${DATA}/dicom
BACKUP_CRON=${BACKUP_CRON}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS}
BACKUP_MIN_FREE_MB=${BACKUP_MIN_FREE_MB}
CORS_ORIGINS=${CORS_ORIGINS}
INGEST_SECRET=${INGEST_SECRET}
MWL_AET=${MWL_AET}
MWL_PORT=${MWL_PORT}
INSTITUTION_NAME=${PUBLIC_HOST}
SUPERVISOR_UI_USER=${SUPERVISOR_UI_USER}
SUPERVISOR_UI_PASSWORD=${SUPERVISOR_UI_PASSWORD}
SUPERVISOR_RPC_HOST=127.0.0.1
SUPERVISOR_RPC_PORT=9001
EOF
chmod 600 "${CONFIG_DIR}/backend.env"
# supervisord's backend program sources this file before exec'ing node —
# see wait-for-postgres.sh invocation and [program:backend] environment note.
ln -sf "${CONFIG_DIR}/backend.env" /opt/backend/.env

# ---- 8. mwl-scp env ------------------------------------------------------
cat > "${CONFIG_DIR}/mwl-scp.env" <<EOF
MWL_AET=${MWL_AET}
MWL_PORT=${MWL_PORT}
POSTGRES_HOST=${DB_HOST}
POSTGRES_PORT=${DB_PORT}
POSTGRES_USER=${DB_USER}
POSTGRES_PASSWORD=${DB_PASSWORD}
RIS_DB_NAME=${RIS_DB_NAME}
INSTITUTION_NAME=${PUBLIC_HOST}
EOF
chmod 600 "${CONFIG_DIR}/mwl-scp.env"

# ---- 9. Orthanc env (reuses the base image's own ORTHANC__* -> json
#         translation in /docker-entrypoint.sh; see supervisord.conf) -----
export ORTHANC__POSTGRESQL__HOST="${DB_HOST}"
export ORTHANC__POSTGRESQL__PORT="${DB_PORT}"
export ORTHANC__POSTGRESQL__DATABASE="${ORTHANC_DB_NAME}"
export ORTHANC__POSTGRESQL__USERNAME="${DB_USER}"
export ORTHANC__POSTGRESQL__PASSWORD="${DB_PASSWORD}"
export ORTHANC__POSTGRESQL__ENABLE_INDEX=true
export ORTHANC__NAME="RIS+PACS"
export ORTHANC__DICOM_AET="${DICOM_AET}"
export ORTHANC__DICOM_PORT="${DICOM_PORT}"
export ORTHANC__DICOM_CHECK_MODALITY_HOST="${CHECK_MODALITY_HOST}"
export ORTHANC__REMOTE_ACCESS_ALLOWED=true
export ORTHANC__AUTHENTICATION_ENABLED=true
export ORTHANC__REGISTERED_USERS="{\"${ORTHANC_USERNAME}\": \"${ORTHANC_PASSWORD}\"}"
export ORTHANC__DICOM_WEB__ENABLE=true
# Matches the dev Compose setup unchanged: enabled but pointed at an empty
# directory (Phase 1 discovery confirmed nothing uses it — mwl-scp is the
# live MWL path, kept as its own supervised process; see [program:mwl-scp]).
export ORTHANC__WORKLISTS__ENABLE=true
export ORTHANC__WORKLISTS__DATABASE="${DATA}/config/worklists"
export ORTHANC__STORAGE_DIRECTORY="${DATA}/dicom"
export ORTHANC__LUA_SCRIPTS='["/etc/rispacs/on-stored.lua"]'
export INGEST_SECRET="${INGEST_SECRET}"
export INGEST_BACKEND_URL="http://127.0.0.1:3000"
# Orthanc's OWN internal HTTP port (8042), distinct from $HTTP_PORT which is
# nginx's PUBLIC port from rispacs.ini — these must never share a variable
# name, or whichever is read last silently overwrites the other and both
# nginx and Orthanc end up trying to bind the same port.
export ORTHANC__HTTP_PORT=8042
export REMOTE_ACCESS_ALLOWED=true

# ---- 10. nginx config, rendered from the template -----------------------
sed "s/__HTTP_PORT__/${HTTP_PORT}/g" /etc/rispacs/nginx.conf.template > /etc/nginx/nginx.conf

# ---- 11. supervisord UI credentials + Redis password (always generated —
#          Redis is internal-only, never exposed, so no ini setting for it) -
if ! grep -q '^REDIS_PASSWORD=' "${SECRETS_FILE}" 2>/dev/null; then
  echo "REDIS_PASSWORD=$(head -c32 /dev/urandom | base64 | tr -d '\n')" >> "${SECRETS_FILE}"
fi
# shellcheck disable=SC1090
source "${SECRETS_FILE}"
REDIS_PASSWORD_VAL="${REDIS_PASSWORD}"
export REDIS_PASSWORD="${REDIS_PASSWORD_VAL}"
export SUPERVISOR_UI_USER="${SUPERVISOR_UI_USER}"
export SUPERVISOR_UI_PASSWORD="${SUPERVISOR_UI_PASSWORD}"
# '|' delimiter: REDIS_PASSWORD_VAL is base64 and may contain '/', which
# would otherwise break the usual 's/.../.../' sed syntax.
sed -i "s|__REDIS_PASSWORD_PLACEHOLDER__|${REDIS_PASSWORD_VAL}|" "${CONFIG_DIR}/backend.env"

log "configuration complete (public_host=${PUBLIC_HOST}, http_port=${HTTP_PORT}, dicom_port=${DICOM_PORT}, mwl_port=${MWL_PORT})"
log "handing off to supervisord"
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf

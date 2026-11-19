#!/bin/bash
# Moves data from the existing docker-compose.yml dev/production stack into a
# new deploy/allinone deployment's data/ layout.
#
# PRIMARY METHOD: a plain file copy of pg_data. This is safe here — and ONLY
# here — because both the old Compose stack's "postgres" service and the new
# deploy/allinone/docker-compose.yml's "postgres" service use the EXACT SAME
# image (postgres:16-alpine), so there is no musl/glibc collation mismatch to
# worry about (that mismatch is what made a raw pg_data copy unsafe when
# Postgres ran bundled inside a Debian-based all-in-one image — it no longer
# does; Postgres is its own sibling container using the same Alpine image as
# always). The script still verifies PG_VERSION=16 before copying, and keeps
# the old volume completely untouched as a fallback if anything looks wrong.
#
# FALLBACK METHOD: pg_dump/pg_restore (logical, image-independent) — use
# --use-dump if you ever point this at a differently-built Postgres image.
#
# Usage:
#   migrate-from-compose.sh <old-compose-project-dir> <new-deploy-allinone-dir> [--use-dump]
set -euo pipefail

OLD_DIR="${1:?Usage: migrate-from-compose.sh <old-compose-project-dir> <new-deploy-allinone-dir> [--use-dump]}"
NEW_DIR="${2:?Usage: migrate-from-compose.sh <old-compose-project-dir> <new-deploy-allinone-dir> [--use-dump]}"
USE_DUMP="${3:-}"

cd "${OLD_DIR}"
# shellcheck disable=SC1091
source .env

OLD_PG_VOLUME="$(basename "${OLD_DIR}")_pg_data"
NEW_PG_DATA_DIR="${NEW_DIR}/data/postgres"

if [ "${USE_DUMP}" = "--use-dump" ]; then
  echo "== Using pg_dump/pg_restore fallback (--use-dump requested) =="
  echo "== 1. Starting the old stack's postgres (dump source) =="
  docker compose up -d postgres
  for i in $(seq 1 60); do
    docker compose exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${RIS_DB_NAME}" >/dev/null 2>&1 && break
    sleep 1
  done

  WORKDIR=$(mktemp -d)
  trap 'rm -rf "${WORKDIR}"' EXIT
  echo "== 2. Dumping ris + orthanc =="
  docker compose exec -T postgres sh -c "pg_dump -U \"\$POSTGRES_USER\" -d \"${RIS_DB_NAME}\" --no-owner --no-privileges" > "${WORKDIR}/ris.sql"
  docker compose exec -T postgres sh -c "pg_dump -U \"\$POSTGRES_USER\" -d \"${ORTHANC_DB_NAME}\" --no-owner --no-privileges" > "${WORKDIR}/orthanc.sql"

  SRC_PATIENTS=$(docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"${RIS_DB_NAME}\" -tAc 'SELECT COUNT(*) FROM patients'")
  SRC_ORDERS=$(docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"${RIS_DB_NAME}\" -tAc 'SELECT COUNT(*) FROM scheduled_orders'")
  SRC_STUDIES_RIS=$(docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"${RIS_DB_NAME}\" -tAc 'SELECT COUNT(*) FROM studies'")
  SRC_ORTHANC_STUDIES=$(docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"${ORTHANC_DB_NAME}\" -tAc \"SELECT COUNT(*) FROM resources WHERE resourcetype=1\"")
  SRC_ORTHANC_INSTANCES=$(docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"${ORTHANC_DB_NAME}\" -tAc \"SELECT COUNT(*) FROM resources WHERE resourcetype=3\"")
  echo "   source: patients=${SRC_PATIENTS} orders=${SRC_ORDERS} studies(ris)=${SRC_STUDIES_RIS} orthanc-studies=${SRC_ORTHANC_STUDIES} orthanc-instances=${SRC_ORTHANC_INSTANCES}"

  echo "== 3. Copying DICOM storage (file-level) =="
  OLD_ORTHANC_VOLUME="$(basename "${OLD_DIR}")_orthanc_storage"
  mkdir -p "${NEW_DIR}/data/dicom"
  docker run --rm -v "${OLD_ORTHANC_VOLUME}:/src:ro" alpine sh -c "tar -czf - -C /src ." \
    | (cd "${NEW_DIR}/data/dicom" && tar -xzf -)

  echo "== 4. Starting the new stack's postgres and restoring =="
  cd "${NEW_DIR}"
  docker compose up -d postgres
  for i in $(seq 1 60); do
    docker compose exec -T postgres pg_isready -U pacs -d ris >/dev/null 2>&1 && break
    sleep 1
  done
  docker compose exec -T postgres psql -U pacs -d ris -v ON_ERROR_STOP=1 < "${WORKDIR}/ris.sql"
  docker compose exec -T postgres psql -U pacs -d orthanc -v ON_ERROR_STOP=1 < "${WORKDIR}/orthanc.sql"

  echo "== 5. Starting the full new stack and comparing counts =="
  docker compose up -d
  DST_PATIENTS=$(docker compose exec -T postgres psql -U pacs -d ris -tAc "SELECT COUNT(*) FROM patients")
  DST_ORDERS=$(docker compose exec -T postgres psql -U pacs -d ris -tAc "SELECT COUNT(*) FROM scheduled_orders")
  DST_STUDIES_RIS=$(docker compose exec -T postgres psql -U pacs -d ris -tAc "SELECT COUNT(*) FROM studies")
  DST_ORTHANC_STUDIES=$(docker compose exec -T postgres psql -U pacs -d orthanc -tAc "SELECT COUNT(*) FROM resources WHERE resourcetype=1")
  DST_ORTHANC_INSTANCES=$(docker compose exec -T postgres psql -U pacs -d orthanc -tAc "SELECT COUNT(*) FROM resources WHERE resourcetype=3")
  echo "   destination: patients=${DST_PATIENTS} orders=${DST_ORDERS} studies(ris)=${DST_STUDIES_RIS} orthanc-studies=${DST_ORTHANC_STUDIES} orthanc-instances=${DST_ORTHANC_INSTANCES}"

  if [ "${SRC_PATIENTS}" = "${DST_PATIENTS}" ] && [ "${SRC_ORDERS}" = "${DST_ORDERS}" ] && [ "${SRC_STUDIES_RIS}" = "${DST_STUDIES_RIS}" ] \
     && [ "${SRC_ORTHANC_STUDIES}" = "${DST_ORTHANC_STUDIES}" ] && [ "${SRC_ORTHANC_INSTANCES}" = "${DST_ORTHANC_INSTANCES}" ]; then
    echo "   All counts MATCH."
  else
    echo "   WARNING: counts do not match — investigate before relying on this migration."
  fi
  echo
  echo "Done (pg_dump/pg_restore path). The old stack's volumes were never modified."
  exit 0
fi

echo "== 1. Capturing source row counts (briefly starting the old stack,"
echo "      read-only queries only, then stopping it again before the copy) =="
WAS_RUNNING=$(docker compose ps --status running --format '{{.Name}}' 2>/dev/null | grep -q . && echo 1 || echo 0)
docker compose up -d postgres
for i in $(seq 1 60); do
  docker compose exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${RIS_DB_NAME}" >/dev/null 2>&1 && break
  sleep 1
done
SRC_PATIENTS=$(docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"${RIS_DB_NAME}\" -tAc 'SELECT COUNT(*) FROM patients'")
SRC_ORDERS=$(docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"${RIS_DB_NAME}\" -tAc 'SELECT COUNT(*) FROM scheduled_orders'")
SRC_STUDIES_RIS=$(docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"${RIS_DB_NAME}\" -tAc 'SELECT COUNT(*) FROM studies'")
SRC_ORTHANC_STUDIES=$(docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"${ORTHANC_DB_NAME}\" -tAc \"SELECT COUNT(*) FROM resources WHERE resourcetype=1\"")
SRC_ORTHANC_INSTANCES=$(docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"${ORTHANC_DB_NAME}\" -tAc \"SELECT COUNT(*) FROM resources WHERE resourcetype=3\"")
echo "   source: patients=${SRC_PATIENTS} orders=${SRC_ORDERS} studies(ris)=${SRC_STUDIES_RIS} orthanc-studies=${SRC_ORTHANC_STUDIES} orthanc-instances=${SRC_ORTHANC_INSTANCES}"

echo "== 2. Stopping the old stack (required for a safe pg_data file copy —"
echo "      Postgres must not be writing to the files while they're copied) =="
docker compose down
if [ "${WAS_RUNNING}" = "0" ]; then
  echo "   (old stack was not fully running before this script started; only"
  echo "    postgres, started above for the row counts, has been stopped.)"
fi

echo "== 3. Checking the old volume's Postgres major version =="
# sh -c wrapping: on Windows/Git Bash, a bare absolute path argument to a
# `docker run` command gets silently path-mangled (MSYS path conversion)
# before reaching the container; wrapping in sh -c '...' makes the path
# resolve inside the container as intended, on every platform.
OLD_PG_VERSION=$(docker run --rm -v "${OLD_PG_VOLUME}:/src:ro" alpine sh -c "cat /src/PG_VERSION" 2>/dev/null || echo "")
if [ "${OLD_PG_VERSION}" != "16" ]; then
  echo "ERROR: old pg_data reports PG_VERSION=${OLD_PG_VERSION:-<unreadable>}, expected 16." >&2
  echo "A raw file copy is only safe between identical major versions and" >&2
  echo "images. Use --use-dump instead, or upgrade/investigate first." >&2
  exit 1
fi
echo "   PG_VERSION=16 confirmed."

echo "== 4. Copying pg_data (old volume is left untouched as a fallback) =="
mkdir -p "${NEW_PG_DATA_DIR}"
if [ -n "$(ls -A "${NEW_PG_DATA_DIR}" 2>/dev/null)" ]; then
  echo "ERROR: ${NEW_PG_DATA_DIR} is not empty. Refusing to overwrite an" >&2
  echo "existing new-stack database. Remove or relocate it first if this is" >&2
  echo "intentional." >&2
  exit 1
fi
docker run --rm -v "${OLD_PG_VOLUME}:/src:ro" -v "${NEW_PG_DATA_DIR}:/dest" alpine \
  sh -c "cp -a /src/. /dest/"
echo "   copy complete."

echo "== 5. Copying Orthanc DICOM storage (file-level copy) =="
OLD_ORTHANC_VOLUME="$(basename "${OLD_DIR}")_orthanc_storage"
mkdir -p "${NEW_DIR}/data/dicom"
docker run --rm -v "${OLD_ORTHANC_VOLUME}:/src:ro" alpine sh -c "tar -czf - -C /src ." \
  | (cd "${NEW_DIR}/data/dicom" && tar -xzf -)
echo "   copy complete."

echo "== 6. Starting the new stack and comparing counts =="
cd "${NEW_DIR}"
docker compose up -d
for i in $(seq 1 60); do
  docker compose exec -T postgres pg_isready -U pacs -d ris >/dev/null 2>&1 && break
  sleep 1
done
DST_PATIENTS=$(docker compose exec -T postgres psql -U pacs -d ris -tAc "SELECT COUNT(*) FROM patients" 2>/dev/null || echo "unknown")
DST_ORDERS=$(docker compose exec -T postgres psql -U pacs -d ris -tAc "SELECT COUNT(*) FROM scheduled_orders" 2>/dev/null || echo "unknown")
DST_STUDIES_RIS=$(docker compose exec -T postgres psql -U pacs -d ris -tAc "SELECT COUNT(*) FROM studies" 2>/dev/null || echo "unknown")
DST_ORTHANC_STUDIES=$(docker compose exec -T postgres psql -U pacs -d orthanc -tAc "SELECT COUNT(*) FROM resources WHERE resourcetype=1" 2>/dev/null || echo "unknown")
DST_ORTHANC_INSTANCES=$(docker compose exec -T postgres psql -U pacs -d orthanc -tAc "SELECT COUNT(*) FROM resources WHERE resourcetype=3" 2>/dev/null || echo "unknown")

echo "   source:      patients=${SRC_PATIENTS} orders=${SRC_ORDERS} studies(ris)=${SRC_STUDIES_RIS} orthanc-studies=${SRC_ORTHANC_STUDIES} orthanc-instances=${SRC_ORTHANC_INSTANCES}"
echo "   destination: patients=${DST_PATIENTS} orders=${DST_ORDERS} studies(ris)=${DST_STUDIES_RIS} orthanc-studies=${DST_ORTHANC_STUDIES} orthanc-instances=${DST_ORTHANC_INSTANCES}"

if [ "${SRC_PATIENTS}" = "${DST_PATIENTS}" ] && [ "${SRC_ORDERS}" = "${DST_ORDERS}" ] && [ "${SRC_STUDIES_RIS}" = "${DST_STUDIES_RIS}" ]; then
  echo "   RIS row counts MATCH."
else
  echo "   WARNING: RIS row counts could not be confirmed to match (see note in step 4) — investigate before relying on this migration."
fi
if [ "${SRC_ORTHANC_STUDIES}" = "${DST_ORTHANC_STUDIES}" ] && [ "${SRC_ORTHANC_INSTANCES}" = "${DST_ORTHANC_INSTANCES}" ]; then
  echo "   Orthanc counts MATCH."
else
  echo "   WARNING: Orthanc counts could not be confirmed to match (see note in step 4) — investigate before relying on this migration."
fi

echo
echo "Done. The old stack's volumes were never modified — they remain a"
echo "fallback until you've confirmed the new deployment is correct."

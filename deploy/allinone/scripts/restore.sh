#!/bin/bash
# Restore a backup produced by the backend's nightly backup feature (Phase
# 1D) or by a manual snapshot. Interactive and explicit — never run
# unattended, since it overwrites live data.
#
# The backup file lives in the rispacs container's /data/backups; the
# restore itself runs against the sibling postgres container (that's where
# the actual database is since the Postgres-as-sibling-container change).
#
# Usage: restore.sh <postgres-container> <rispacs-container> <backup-file>
set -euo pipefail

PG_CONTAINER="${1:?Usage: restore.sh <postgres-container> <rispacs-container> <backup-file-in-/data/backups>}"
APP_CONTAINER="${2:?Usage: restore.sh <postgres-container> <rispacs-container> <backup-file-in-/data/backups>}"
FILE="${3:?Usage: restore.sh <postgres-container> <rispacs-container> <backup-file-in-/data/backups>}"

echo "This will restore ${FILE} into the running Postgres instance in"
echo "container '${PG_CONTAINER}', OVERWRITING the target database's current"
echo "contents. This is destructive and cannot be undone."
read -r -p "Type the exact filename again to confirm: " CONFIRM
if [ "${CONFIRM}" != "${FILE}" ]; then
  echo "Confirmation did not match. Aborting — nothing was changed."
  exit 1
fi

case "${FILE}" in
  ris_db-*) TARGET_DB="ris" ;;
  orthanc_db-*) TARGET_DB="orthanc" ;;
  dicom-storage-*)
    echo "This is a DICOM storage archive, not a database dump."
    echo "Restore it by extracting into /data/dicom while the rispacs"
    echo "container is stopped: docker stop ${APP_CONTAINER} && (extract"
    echo "archive into the data/dicom bind mount) && docker start ${APP_CONTAINER}."
    exit 1
    ;;
  *) echo "Unrecognized backup filename pattern: ${FILE}"; exit 1 ;;
esac

echo "Copying ${FILE} from ${APP_CONTAINER}:/data/backups/ to ${PG_CONTAINER}..."
docker exec "${APP_CONTAINER}" cat "/data/backups/${FILE}" | docker exec -i "${PG_CONTAINER}" sh -c \
  "gunzip -c | psql -U \"\$POSTGRES_USER\" -d ${TARGET_DB}"
echo "Restore complete. Re-run tests/verify application behavior before"
echo "resuming normal use."

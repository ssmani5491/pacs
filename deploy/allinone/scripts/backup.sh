#!/bin/bash
# Manual backup trigger for the all-in-one image.
#
# Does NOT duplicate the backend's own nightly backup feature (Product
# Validation Phase 1D, backend/src/backup/). It reuses that feature: the
# backend already runs pg_dump + a DICOM storage archive on its own @Cron
# schedule and writes to BACKUP_PATH (/data/backups inside this image), with
# sha256 + decompress verification and a BackupRun row per component.
#
# This script does NOT run a second, competing backup pipeline. It simply:
#  1. Confirms the backend process is running (so its scheduled job can run).
#  2. Lists what's already in /data/backups (the same output the nightly job
#     produces) so an operator can confirm a backup exists without needing
#     direct database access.
#
# A true "run it right now, don't wait for 2am" trigger would require a new
# backend API endpoint (none exists today — see README's "Known limitations"
# section); until that exists, use: docker exec <container> supervisorctl
# restart backend only if you specifically need to force the next scheduled
# tick sooner, which is not equivalent to an on-demand run.
set -euo pipefail

CONTAINER="${1:-rispacs-rispacs-1}"

echo "== Backend process status =="
docker exec "${CONTAINER}" supervisorctl status backend

echo
echo "== Existing backups in /data/backups =="
docker exec "${CONTAINER}" ls -la /data/backups/ 2>/dev/null || echo "(none yet)"

echo
echo "Note: /data/dicom must also be backed up at the file level separately"
echo "if you need DICOM image recovery beyond what the nightly DICOM_STORAGE"
echo "component already captures in /data/backups (a point-in-time tar.gz)."

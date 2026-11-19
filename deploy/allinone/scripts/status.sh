#!/bin/bash
# Readable status summary: supervisorctl status + the container's own
# HEALTHCHECK result.
set -euo pipefail
CONTAINER="${1:-rispacs-rispacs-1}"

echo "== Container health =="
docker inspect --format '{{.State.Health.Status}}' "${CONTAINER}" 2>/dev/null || echo "unknown (container not found?)"

echo
echo "== Service status (supervisorctl) =="
docker exec "${CONTAINER}" supervisorctl status

echo
echo "== Disk usage: /data =="
docker exec "${CONTAINER}" df -h /data

echo
echo "== Recent backup runs =="
docker exec "${CONTAINER}" ls -la /data/backups/ 2>/dev/null | tail -10 || echo "(no backups yet)"

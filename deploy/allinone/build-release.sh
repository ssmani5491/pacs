#!/bin/bash
# Builds and tags the all-in-one image with a version, saves it to a .tar.gz
# (with a SHA256 checksum) for offline hospital installs, and bundles an
# install folder (docker-compose.yml, the example config files, README) into
# one release zip ready to hand to hospital IT.
#
# Usage:
#   build-release.sh 1.0.0            # build + tag only
#   build-release.sh 1.0.0 --release  # build + tag + full release package
#   build-release.sh 1.0.0 --release out/dir   # ...into a specific directory
set -euo pipefail

VERSION="${1:?Usage: build-release.sh <version> [--release [output-dir]]}"
IMAGE="ourcompany/rispacs:${VERSION}"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SELF_DIR}/../.." && pwd)"

echo "== Building ${IMAGE} =="
docker build -f "${REPO_ROOT}/Dockerfile.allinone" -t "${IMAGE}" -t "ourcompany/rispacs:latest" "${REPO_ROOT}"

echo "== Image size =="
docker images "${IMAGE}" --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}"

if [ "${2:-}" = "--release" ]; then
  OUT_DIR="${3:-${REPO_ROOT}/dist}"
  RELEASE_DIR="${OUT_DIR}/rispacs-${VERSION}"
  mkdir -p "${RELEASE_DIR}/install"

  echo "== Saving image to ${RELEASE_DIR}/rispacs-${VERSION}.tar =="
  TAR_FILE="${RELEASE_DIR}/rispacs-${VERSION}.tar"
  docker save "${IMAGE}" -o "${TAR_FILE}"
  gzip -f "${TAR_FILE}"
  TAR_GZ="${TAR_FILE}.gz"

  echo "== Computing SHA256 checksum =="
  (cd "${RELEASE_DIR}" && sha256sum "$(basename "${TAR_GZ}")" > "$(basename "${TAR_GZ}").sha256")
  cat "${TAR_GZ}.sha256"

  echo "== Bundling the install folder =="
  cp "${SELF_DIR}/docker-compose.yml" "${RELEASE_DIR}/install/"
  cp "${SELF_DIR}/rispacs.ini.example" "${RELEASE_DIR}/install/"
  cp "${SELF_DIR}/db_password.txt.example" "${RELEASE_DIR}/install/"
  cp "${SELF_DIR}/README.md" "${RELEASE_DIR}/install/"
  cp -r "${SELF_DIR}/scripts" "${RELEASE_DIR}/install/"
  if [ -f "${SELF_DIR}/RELEASE_NOTES.md" ]; then
    cp "${SELF_DIR}/RELEASE_NOTES.md" "${RELEASE_DIR}/"
  fi

  echo "== Creating release zip =="
  ZIP_FILE="${OUT_DIR}/rispacs-${VERSION}-release.zip"
  rm -f "${ZIP_FILE}"
  if command -v zip >/dev/null 2>&1; then
    (cd "${OUT_DIR}" && zip -rq "$(basename "${ZIP_FILE}")" "rispacs-${VERSION}")
  elif command -v 7z >/dev/null 2>&1; then
    (cd "${OUT_DIR}" && 7z a -tzip -bd "$(basename "${ZIP_FILE}")" "rispacs-${VERSION}" >/dev/null)
  else
    echo "Neither 'zip' nor '7z' found — leaving the release as an unzipped" >&2
    echo "directory at ${RELEASE_DIR} instead." >&2
    ZIP_FILE="(not created — see ${RELEASE_DIR})"
  fi

  echo
  echo "== Release package contents (${RELEASE_DIR}) =="
  find "${RELEASE_DIR}" -type f | sort

  echo
  echo "Done."
  echo "  Image archive:   ${TAR_GZ}"
  echo "  Checksum:        ${TAR_GZ}.sha256"
  echo "  Release zip:     ${ZIP_FILE}"
  echo
  echo "Hand hospital IT the zip. Inside it: the image .tar.gz + checksum,"
  echo "and install/ (docker-compose.yml, example config, README, scripts)."
  echo "Verify the checksum after transfer with:"
  echo "  sha256sum -c rispacs-${VERSION}.tar.gz.sha256"
fi

#!/bin/bash
# mwl_scp.py reads plain os.environ (no .env loading of its own). A bare
# `source file` only sets shell-local variables, NOT exported env vars, so a
# Python subprocess would never see them (this was a real bug here: MWL_AET
# silently fell back to mwl_scp.py's own hardcoded default). Read as plain
# KEY=VALUE lines and export explicitly instead — same approach as
# run-backend.sh, for the same underlying reason.
set -e
while IFS= read -r line; do
  case "${line}" in ''|'#'*) continue ;; esac
  key="${line%%=*}"
  value="${line#*=}"
  export "${key}=${value}"
done < /data/config/mwl-scp.env
exec /opt/mwl-venv/bin/python -u /opt/mwl-src/mwl_scp.py

#!/bin/sh
# Creates the second database (orthanc) alongside the RIS db, on first init.
# Idempotent: skips if it already exists.
set -e
ORTHANC_DB="${ORTHANC_DB_NAME:-orthanc}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  SELECT 'CREATE DATABASE $ORTHANC_DB'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$ORTHANC_DB')\gexec
EOSQL
echo "init-db: ensured databases $POSTGRES_DB and $ORTHANC_DB"

#!/usr/bin/env bash
# Phase 6 test-data setup: create a GGH patient + CT orders so synthetic volumes
# C-STOREd under those accessions get matched -> correct GGH org -> visible to a
# GGH radiologist in the viewer. Prints the accession numbers to feed gen_volume.py.
# SYNTHETIC data only.
set -uo pipefail
BASE=${BASE:-http://localhost}
py() { python -c "$1" 2>/dev/null; }

ADM=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"ChangeMe!123"}' | py "import sys,json;print(json.load(sys.stdin)['accessToken'])")
AH="Authorization: Bearer $ADM"

GGH=$(curl -s "$BASE/api/organizations?pageSize=200" -H "$AH" \
  | py "import sys,json;d=json.load(sys.stdin);print(next(o['id'] for o in d['data'] if o.get('code')=='GGH'))")
echo "GGH org: $GGH"

# Reuse a patient if our marker MRN exists, else create.
PNAME="Viewer Test Patient"
PID=$(curl -s "$BASE/api/patients?pageSize=200&search=VIEWERVOL" -H "$AH" \
  | py "import sys,json;d=json.load(sys.stdin);print(next((p['id'] for p in d['data'] if p.get('mrn','').startswith('VIEWERVOL')),''))")
if [ -z "$PID" ]; then
  R=$(curl -s -X POST $BASE/api/patients -H "$AH" -H 'Content-Type: application/json' \
    -d "{\"mrn\":\"VIEWERVOL01\",\"name\":\"$PNAME\",\"dob\":\"1980-01-01\",\"gender\":\"O\",\"organizationId\":\"$GGH\"}")
  PID=$(echo "$R" | py "import sys,json;print(json.load(sys.stdin).get('id',''))")
  echo "created patient VIEWERVOL01: $PID"
else echo "patient exists: $PID"; fi

mkorder() { # desc modality -> prints accession
  local DESC=$1 MOD=$2
  local R=$(curl -s -X POST $BASE/api/orders -H "$AH" -H 'Content-Type: application/json' \
    -d "{\"patientId\":\"$PID\",\"modalityType\":\"$MOD\",\"procedureDesc\":\"$DESC\",\"studyDescription\":\"$DESC\",\"organizationId\":\"$GGH\",\"scheduledAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}")
  echo "$R" | py "import sys,json;print(json.load(sys.stdin).get('accessionNumber',''))"
}

echo "ACC_MAIN=$(mkorder 'CT CHEST VOLUME' CT)"
echo "ACC_PRIOR=$(mkorder 'CT CHEST PRIOR' CT)"
echo "ACC_LARGE=$(mkorder 'CT WHOLE BODY LARGE' CT)"

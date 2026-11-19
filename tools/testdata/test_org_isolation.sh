#!/usr/bin/env bash
# Phase 6 Module 10 — organization-isolation test for the DICOMweb proxy.
# Proves a radiologist from org A cannot read a study belonging to org B.
# SYNTHETIC data only. Requires the stack up + admin creds.
set -uo pipefail
BASE=${BASE:-http://localhost}
ADMIN_USER=${ADMIN_USER:-admin}
ADMIN_PASS=${ADMIN_PASS:-ChangeMe!123}

py() { python -c "$1" 2>/dev/null; }

echo "== login admin =="
ADM=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" \
  | py "import sys,json;print(json.load(sys.stdin)['accessToken'])")
[ -n "$ADM" ] || { echo "admin login FAILED"; exit 1; }
AH="Authorization: Bearer $ADM"

echo "== ensure 2nd org (Test Clinic / TCL) =="
ORGS=$(curl -s "$BASE/api/organizations?pageSize=200" -H "$AH")
TCL_ID=$(echo "$ORGS" | py "import sys,json;d=json.load(sys.stdin);print(next((o['id'] for o in d['data'] if o.get('code')=='TCL'),''))")
GGH_ID=$(echo "$ORGS" | py "import sys,json;d=json.load(sys.stdin);print(next((o['id'] for o in d['data'] if o.get('code')=='GGH'),''))")
if [ -z "$TCL_ID" ]; then
  TCL_ID=$(curl -s -X POST $BASE/api/organizations -H "$AH" -H 'Content-Type: application/json' \
    -d '{"code":"TCL","name":"Test Clinic"}' | py "import sys,json;print(json.load(sys.stdin).get('id',''))")
  echo "  created TCL org: $TCL_ID"
else echo "  TCL org exists: $TCL_ID"; fi
echo "  GGH org: $GGH_ID"

mkuser() { # username org
  local U=$1 ORG=$2
  local EX=$(curl -s "$BASE/api/users?pageSize=300" -H "$AH" \
    | py "import sys,json;d=json.load(sys.stdin);print(next((u['id'] for u in d['data'] if u.get('username')=='$U'),''))")
  if [ -z "$EX" ]; then
    local R=$(curl -s -X POST $BASE/api/users -H "$AH" -H 'Content-Type: application/json' \
      -d "{\"username\":\"$U\",\"fullName\":\"$U\",\"email\":\"$U@example.test\",\"password\":\"Test!1234\",\"organizationId\":\"$ORG\",\"roleKeys\":[\"radiologist\"]}")
    echo "  created $U: $(echo "$R" | py "import sys,json;print(json.load(sys.stdin).get('id','ERR:'+json.load(sys.stdin).get('message','')))" 2>/dev/null || echo "$R" | head -c 120)"
  else echo "  user $U exists"; fi
}
echo "== ensure radiologists =="
mkuser rad_ggh "$GGH_ID"
mkuser rad_tcl "$TCL_ID"

login() { curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"$1\",\"password\":\"Test!1234\"}" | py "import sys,json;print(json.load(sys.stdin).get('accessToken',''))"; }
RG=$(login rad_ggh); RT=$(login rad_tcl)
echo "  rad_ggh token: ${RG:+ok} | rad_tcl token: ${RT:+ok}"

STUDY_GGH=$(curl -s "$BASE/api/worklist?pageSize=100" -H "$AH" \
  | py "import sys,json;d=json.load(sys.stdin);print(next((r['studyInstanceUid'] for r in d['data'] if r.get('hasImages')),''))")
echo "== GGH real study under test: $STUDY_GGH =="

PASS=0; FAIL=0
check() { # label expected_regex actual
  if [[ "$3" =~ $2 ]]; then echo "  PASS: $1 ($3)"; PASS=$((PASS+1)); else echo "  FAIL: $1 (got $3, want $2)"; FAIL=$((FAIL+1)); fi
}

echo "--- rad_ggh -> GGH study metadata (expect 200) ---"
C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/dicom-web/studies/$STUDY_GGH/metadata" -H "Authorization: Bearer $RG")
check "rad_ggh reads own-org study" "^200$" "$C"

echo "--- rad_tcl -> same GGH study (expect 403 or 404) ---"
C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/dicom-web/studies/$STUDY_GGH/metadata" -H "Authorization: Bearer $RT")
check "rad_tcl blocked from other-org study" "^(403|404)$" "$C"

echo "--- rad_tcl QIDO list (expect 0 studies) ---"
N=$(curl -s "$BASE/api/dicom-web/studies" -H "Authorization: Bearer $RT" -H 'Accept: application/dicom+json' | py "import sys,json;d=json.load(sys.stdin);print(len(d) if isinstance(d,list) else 'ERR')")
check "rad_tcl sees zero studies" "^0$" "$N"

echo "--- rad_ggh QIDO list (expect >0) ---"
NG=$(curl -s "$BASE/api/dicom-web/studies" -H "Authorization: Bearer $RG" -H 'Accept: application/dicom+json' | py "import sys,json;d=json.load(sys.stdin);print(len(d) if isinstance(d,list) else 'ERR')")
check "rad_ggh sees studies" "^[1-9][0-9]*$" "$NG"

echo "== ISOLATION RESULT: PASS=$PASS FAIL=$FAIL =="
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)

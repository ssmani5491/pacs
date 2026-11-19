#!/usr/bin/env bash
# Phase 7 — full report lifecycle + negative tests (API level). Synthetic data.
set -uo pipefail
BASE=${BASE:-http://localhost}
py() { python -c "$1" 2>/dev/null; }
PASS=0; FAIL=0
ck() { if [[ "$3" =~ $2 ]]; then echo "  PASS: $1 ($3)"; PASS=$((PASS+1)); else echo "  FAIL: $1 (got '$3' want $2)"; FAIL=$((FAIL+1)); fi; }

login() { curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\"}" | py "import sys,json;print(json.load(sys.stdin).get('accessToken',''))"; }

RAD=$(login rad_ggh 'Test!1234')            # radiologist (full report perms) in GGH
RT=$(login rad_tcl 'Test!1234')             # radiologist in other org TCL
ADM=$(login admin 'ChangeMe!123')
echo "tokens: rad_ggh=${RAD:+ok} rad_tcl=${RT:+ok} admin=${ADM:+ok}"
AH="Authorization: Bearer $RAD"

# Pick the GGH study with images (300-slice volume).
STUDY=$(curl -s "$BASE/api/worklist?patientId=VIEWERVOL01&pageSize=10" -H "$AH" \
  | py "import sys,json;d=json.load(sys.stdin);print(next(r['id'] for r in d['data'] if r['accessionNumber']=='20261114000001'))")
echo "study under test: $STUDY"

# Template id (CT-CHEST)
TPL=$(curl -s "$BASE/api/report-templates?pageSize=50" -H "$AH" | py "import sys,json;d=json.load(sys.stdin);print(next(t['id'] for t in d['data'] if t.get('code')=='CT-HEAD-NORMAL'))")
echo "template: $TPL"

echo "--- 1. create report (with template) ---"
RID=$(curl -s -X POST $BASE/api/reports -H "$AH" -H 'Content-Type: application/json' -d "{\"studyId\":\"$STUDY\",\"templateId\":\"$TPL\"}" | py "import sys,json;print(json.load(sys.stdin).get('id',''))")
ck "report created" "^[0-9a-f-]{36}$" "$RID"

echo "--- 2. template seeded findings/impression into the draft ---"
HASFIND=$(curl -s "$BASE/api/reports/$RID" -H "$AH" | py "import sys,json;d=json.load(sys.stdin);print('yes' if d.get('findings') else 'no')")
ck "template content populated" "^yes$" "$HASFIND"

echo "--- 3. edit draft (findings + impression) ---"
ST=$(curl -s -X PATCH $BASE/api/reports/$RID -H "$AH" -H 'Content-Type: application/json' -d '{"findings":"No acute intracranial abnormality. Synthetic test.","impression":"Normal study.","reason":"initial dictation"}' -o /dev/null -w "%{http_code}")
ck "edit draft 200" "^200$" "$ST"

echo "--- 4. unauthorized finalize (rad_tcl, other org) -> 403/404 ---"
ST=$(curl -s -X POST $BASE/api/reports/$RID/finalize -H "Authorization: Bearer $RT" -o /dev/null -w "%{http_code}")
ck "cross-org finalize blocked" "^(403|404)$" "$ST"

echo "--- 5. submit preliminary ---"
ST=$(curl -s -X POST $BASE/api/reports/$RID/preliminary -H "$AH" | py "import sys,json;print(json.load(sys.stdin).get('status',''))")
ck "status PRELIMINARY" "^PRELIMINARY$" "$ST"

echo "--- 6. finalize ---"
ST=$(curl -s -X POST $BASE/api/reports/$RID/finalize -H "$AH" | py "import sys,json;print(json.load(sys.stdin).get('status',''))")
ck "status FINAL" "^FINAL$" "$ST"

echo "--- 7. sign with WRONG password -> 401 ---"
ST=$(curl -s -X POST $BASE/api/reports/$RID/sign -H "$AH" -H 'Content-Type: application/json' -d '{"password":"wrongpass"}' -o /dev/null -w "%{http_code}")
ck "sign wrong password 401" "^401$" "$ST"

echo "--- 8. sign with correct password (step-up) ---"
SIGN=$(curl -s -X POST $BASE/api/reports/$RID/sign -H "$AH" -H 'Content-Type: application/json' -d '{"password":"Test!1234"}')
LOCKED=$(echo "$SIGN" | py "import sys,json;d=json.load(sys.stdin);print(d.get('updated',{}).get('locked'))")
HASH=$(echo "$SIGN" | py "import sys,json;d=json.load(sys.stdin);print(d.get('sig',{}).get('signatureHash','')[:12])")
ck "report locked after sign" "^True$" "$LOCKED"
ck "signature hash recorded" "^[0-9a-f]{12}$" "$HASH"

echo "--- 9. edit a signed/locked report -> 409 immutable ---"
ST=$(curl -s -X PATCH $BASE/api/reports/$RID -H "$AH" -H 'Content-Type: application/json' -d '{"findings":"tamper"}' -o /dev/null -w "%{http_code}")
ck "signed report immutable" "^409$" "$ST"

echo "--- 10. re-finalize/re-sign a locked report -> 409 ---"
ST=$(curl -s -X POST $BASE/api/reports/$RID/sign -H "$AH" -H 'Content-Type: application/json' -d '{"password":"Test!1234"}' -o /dev/null -w "%{http_code}")
ck "re-sign blocked" "^409$" "$ST"

echo "--- 11. version history exists ---"
NV=$(curl -s "$BASE/api/reports/$RID/versions" -H "$AH" | py "import sys,json;print(len(json.load(sys.stdin)))")
ck "version history >=3" "^[3-9]|[0-9]{2}" "$NV"

echo "--- 12. capture signed content for immutability check ---"
BEFORE=$(curl -s "$BASE/api/reports/$RID" -H "$AH" | py "import sys,json;d=json.load(sys.stdin);print(d.get('findings',''))")

echo "--- 13. create addendum (reason required) ---"
AID=$(curl -s -X POST $BASE/api/reports/$RID/addendum -H "$AH" -H 'Content-Type: application/json' -d '{"reason":"Additional finding on review","findings":"Addendum: incidental note.","impression":"Unchanged impression."}' | py "import sys,json;print(json.load(sys.stdin).get('id',''))")
ck "addendum created" "^[0-9a-f-]{36}$" "$AID"

echo "--- 14. original signed report UNCHANGED after addendum ---"
AFTER=$(curl -s "$BASE/api/reports/$RID" -H "$AH" | py "import sys,json;d=json.load(sys.stdin);print(d.get('findings',''))")
ck "original findings unchanged" "^$(printf '%s' "$BEFORE" | sed 's/[.[\*^$]/\\&/g')$" "$AFTER"
LCK=$(curl -s "$BASE/api/reports/$RID" -H "$AH" | py "import sys,json;d=json.load(sys.stdin);print(d.get('locked'))")
ck "original still locked" "^True$" "$LCK"

echo "--- 15. addendum linked to parent ---"
PARENT=$(curl -s "$BASE/api/reports/$AID" -H "$AH" | py "import sys,json;d=json.load(sys.stdin);print(d.get('parentReportId',''))")
ck "addendum parent linkage" "^$RID$" "$PARENT"

echo "--- 16. PDF generation ---"
curl -s "$BASE/api/reports/$RID/pdf" -H "$AH" -o /tmp/report.pdf -w "  pdf: HTTP %{http_code} type=%{content_type} size=%{size_download}\n"
MAGIC=$(head -c 4 /tmp/report.pdf | tr -d '\0')
ck "pdf is a PDF file" "^%PDF" "$MAGIC"

echo "--- 17. cross-org cannot read the report -> 403/404 ---"
ST=$(curl -s "$BASE/api/reports/$RID" -H "Authorization: Bearer $RT" -o /dev/null -w "%{http_code}")
ck "cross-org report read blocked" "^(403|404)$" "$ST"

echo "== LIFECYCLE RESULT: PASS=$PASS FAIL=$FAIL =="
cp /tmp/report.pdf "C:/Users/user/AppData/Local/Temp/claude/cda97df1372ca28b/71be01e8-f1da-4e25-8444-32c2b5832bbc/scratchpad/sample_report.pdf" 2>/dev/null
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)

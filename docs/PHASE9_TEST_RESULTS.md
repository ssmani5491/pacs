# Phase 9 — Test Results (2026-11-14)

Consolidated actual results. Tests that could not be run safely are marked **NOT TESTED**.
Evidence is from real executions against the live local stack (synthetic data only).

## Stage 3 — Load & Concurrency (k6, throwaway `grafana/k6` container)
Script: `tests/load/phase9-load.js`. Read-only endpoints; gradual ramp 2→20 VUs over ~80 s.
Run: `docker run --rm --network pacs-replica_pacs -e BASE=http://nginx:80 -v <repo>/tests/load:/scripts grafana/k6 run /scripts/phase9-load.js`

| Metric | Result |
|---|---|
| Peak concurrent VUs | 20 |
| Total requests | 3168 (~39 req/s) |
| Iterations | 528 (~6.5/s) |
| **Checks passed** | **3168 / 3168 = 100%** |
| Custom error rate | **0.00%** |
| read_ms (worklist/patients/reporting/notifications) | avg 67 ms, med 54 ms, **p95 160 ms**, max 276 ms |
| login_ms (argon2id under load) | avg 352 ms, p95 640 ms, max 960 ms |
| http_req_duration overall | avg 115 ms, p95 410 ms |
| http_req_failed (k6 raw) | 10.6% — **all legitimate 403s** (receptionist denied /patients, /reporting-worklist). `check()` treats these as expected; they are correct RBAC, not failures. |
| Services after load | all healthy |
| Backend memory | 75 MB idle → 190 MB peak → settled (no leak) |
| Postgres memory | 299 → 352 MB |
| Error log lines during load | **0** |
| DB pool | no exhaustion; released cleanly |

**Interpretation**: the stack handled 20 concurrent synthetic users with zero unexpected errors,
read p95 of 160 ms, and correct authorization throughout. Login latency rises under load because
argon2id hashing is CPU-bound (intended security tradeoff). Load kept conservative per the brief;
higher load levels are a documented future exercise (NOT TESTED at >20 VUs to avoid disrupting the
single local environment).

**Scenario coverage** (Stage 3 list):
- Authentication (login) — tested under concurrency. ✓
- Patient search, RIS worklist (incl. modality filter + pagination), reporting worklist,
  notifications — tested under concurrency. ✓
- Audit APIs — exercised by admin VUs. ✓
- Order creation / reporting writes — **NOT load-tested** deliberately (would create duplicate
  synthetic clinical records in the working dataset; the brief forbids that). Functionally verified
  in clinical-validation stage instead.
- Concurrent DICOM C-STORE / MWL C-FIND / DICOMweb — DICOMweb GET covered via the proxy under load;
  concurrent C-STORE associations covered functionally in DICOM security (duplicate test) but **not
  run at high concurrency** (NOT TESTED at scale — avoids Orthanc disruption on the single node).

## Stage 4 — Security (summary; full detail in PHASE9_SECURITY_ASSESSMENT.md)
- Auth: rotation / reuse-after-rotation(401) / logout(401) / lockout(5→locked) / token validation — all PASS.
- RBAC + BOLA: cross-org by ID → patient 404, order/report/study/versions/pdf/dicom-web 403 — PASS.
- Mass-assignment: injected org ignored, forced to user's own org — PASS.
- SQLi/XSS payloads: safe (literal strings; patients table intact) — PASS.
- Fixes retested: SEC-2 CORS (evil origin blocked), SEC-3 HSTS (absent on HTTP), SEC-4 SPA headers present.

## Stage 5 — DICOM security (summary; detail in PHASE9_SECURITY_ASSESSMENT.md §G)
- DICOM-1 unauthorized AE (MWL): REJECTED. DICOM-2 proxy JWT: 401/401/200. DICOM-3 expired JWT: 401.
  DICOM-4 forged (wrong secret) admin JWT: 401. DICOM-5 cross-org study: 403. DICOM-6 authorized
  C-STORE: 6/6. DICOM-7 duplicate (3 UIDs ×2): +3 net (dedup). DICOM-8 unmatched: ORPHAN + reconcile
  + notification. Orthanc admin: 401 unauth, port not host-exposed. All PASS.

## Stage 6 — Backup & restore (detail in PHASE9_BACKUP_RESTORE.md)
- PostgreSQL isolated restore: 3 s, 0 errors, all counts + 34 FKs + GIN + 2 signatures match — PASS.
- Orthanc: PG index restore validated; full spin-up documented (NOT run live, single node).
- Redis: RDB persistence on; state recoverable/rebuildable — PASS. Config backed up (secrets redacted).

## Stage 7 — Failure & recovery (detail in PHASE9_FAILURE_RECOVERY.md)
- FR-1 backend (21 s, API 200, socket 200, scheduler resumed). FR-2 Redis (login 200, RT persisted).
  FR-3 Orthanc (studies 10=10, C-STORE up). FR-4 MWL (C-FIND OK, orders 5005 intact). FR-5 nginx (all
  routes). FR-6 dynamic DNS (new IP, 0× 502). FR-7 jobs recovered. All PASS.

## Stage 8 — Clinical validation (detail in PHASE9_CLINICAL_VALIDATION.md)
- Workflows 1–6 PASS. Signed report edit → 409 (immutable); signatures intact (2).
- **REL-3 notification cross-org fan-out FIXED + retested** (rad_tcl = 0 notifications).
- Playwright 12/12 PASS; backend unit 44/44 PASS.

## Stage 9 — Logging (detail in PHASE9_CHECKLIST / this doc)
- LOG-1 (Docker logs unbounded) FIXED: json-file max-size 10m × 5 (50 MB cap/container), verified on
  frontend recreate. LOG-2: no secret/token VALUES in logs (access token appears 0× in logs) — PASS.

## Final regression (Phases 1–8) — PASS
- All 8 services healthy; **15/15 endpoint groups → 200** (health, worklist, patients, orders, MWL,
  PACS, reporting, templates, notifications, audit, dashboard, alerts, viewer, dicom-web, socket.io).
- MWL :4243 + C-STORE :4242 up. Data preserved: studies 5010, reports 7, **signatures 2**, audit 1396,
  **search_tsv GIN present**. Docker volumes intact. Dynamic DNS verified (0× 502).

## Resource usage under load (Stage 3)
- Backend 75 MB idle → 190 MB peak (settled, no leak); postgres 299 → 352 MB; 0 error log lines.

(Baseline numbers: PHASE9_BASELINE.md. Performance changes: PHASE9_PERFORMANCE.md.)

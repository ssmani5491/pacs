# Phase 9 — Performance Engineering (2026-11-14)

Baseline: see PHASE9_BASELINE.md. Principle followed (per brief): **add indexes / change code only
when a query plan or measurement justifies it.** No speculative indexes were added.

## A. PostgreSQL — EXPLAIN ANALYZE of representative queries
All plans are healthy at the current synthetic volume (5007 studies / 5005 orders / 1004 patients).

| Query | Plan | Exec time |
|---|---|---|
| Worklist patient-name search (`studies ⋈ patients`, name ILIKE) | Index Scan Backward `studies_studyDate_idx` + Memoized patient PK lookups | **4.96 ms** |
| Reporting-worklist UNREPORTED count (anti-join on reports) | Merge Anti Join + Index Only Scan `studies_pkey` | **12.0 ms** |
| Audit filter by action + date desc | Index Scan Backward `audit_logs_createdAt_idx` | **0.18 ms** |
| Patients search by MRN (`%...%` ILIKE) | Seq Scan (1004 rows) | **0.12 ms** |

**Findings & decisions**
- No missing index is justified. The `ILIKE '%...%'` searches (patient MRN/name) cannot use a btree
  index, but execute sub-5 ms at this scale; adding `pg_trgm` GIN indexes would be unjustified
  complexity now. **Documented as a future option** if patient volume grows into the 100k+ range.
- No duplicate indexes found. `search_tsv` GIN index preserved and present.
- Dashboard metrics already run as indexed count queries in one `$transaction` (no N+1); 40 ms.
- Reporting-worklist `counts` runs 6 count queries but completes in ~27 ms; acceptable, left as-is.

## B. Backend API — response-time baseline
All read endpoints < 60 ms via nginx (see baseline table). Login ~180 ms is argon2id hashing
(intentional, security). No endpoint is a latency concern at baseline scale.

### PERF-1 (MEDIUM) — DICOMweb QIDO proxy did a double org-scan — FIXED + RETESTED
- **Evidence**: `GET /api/dicom-web/studies` = 205 ms vs 35 ms direct to Orthanc. Root cause:
  `DicomWebService.allowedStudyFilter()` (a full scan of the org's 5003 studies, 14 ms each) was
  called **twice per QIDO request** — once in the pre-check, once in the post-filter.
- **Fix**: compute the org allow-set **once** before the upstream fetch and reuse the same `Set` in
  the post-filter (`backend/src/dicomweb/dicomweb.service.ts`). Behaviour unchanged.
- **Retest**: QIDO via proxy **205.5 ms → 146.0 ms (~29% faster)**. **Org isolation re-verified**:
  rad_ggh sees 3 studies, rad_tcl (other org) sees 0, cross-org metadata → 403. No regression.
- Residual ~146 ms = Orthanc round-trip (~30 ms) + one 14 ms scan + JSON of all studies. Caching the
  allow-set in Redis was considered and **declined** (staleness/complexity risk vs. marginal gain at
  this scale); documented as a future option for very large orgs.

## C. Frontend
- Production build is Vite + React, tree-shaken; the viewer (OHIF) is a separate pinned image, so the
  RIS bundle stays small. Notification bell polls `/unread-count` every 20 s (light) with a Socket.IO
  push path. Worklist/large tables use **server-side pagination** already (Phase 3+).
- No change made: no measured frontend bottleneck. Route-level code-splitting is a documented future
  option (the RIS bundle is already small; OHIF — the heavy part — is already isolated).

## D. Redis
- 1.13 MB used, 129 keys, peak 1.17 MB. Keys: refresh tokens (TTL-bound, Phase 1), job locks
  (`lock:job:*`, PX-expiring, Phase 8). No unbounded key growth observed.
- **REL-2 (INFORMATIONAL)**: `maxmemory = 0` (unbounded) with no eviction policy. **Deliberately not
  changed at runtime**: an eviction policy risks evicting active refresh tokens / job locks and
  harming auth state. Recommended production setting documented (set a bound with `noeviction` so
  Redis errors rather than silently dropping auth keys). No `FLUSHALL/FLUSHDB` was run.

## E. Reliability fix — REL-1 (LOW): unbounded operational telemetry — FIXED
- **Evidence**: `service_health_checks` grew +8 rows/min (1368 rows at baseline), unbounded; same
  pattern for `background_job_records`. These are transient telemetry, **not** clinical/audit data.
- **Fix**: the existing hourly `NOTIF_CLEANUP` scheduler job now also prunes `service_health_checks`
  and `background_job_records` older than `OPS_TELEMETRY_RETENTION_DAYS` (default **7**). Audit,
  clinical, and DICOM records are untouched. (`backend/src/ops/ops.scheduler.ts`.)

## DICOM / OHIF performance
Measured separately in Stage DICOM (see PHASE9_TEST_RESULTS.md). Baseline carried from Phase 6:
first-image ~1.6 s, progressive loading, MPR real on the 300/2000-slice volumes. A 2000-slice
benchmark already exists; the 6,600-instance stress test is addressed in the DICOM stage.

## Summary of changes made this stage
| Change | File | Measured impact |
|---|---|---|
| QIDO single org-scan (PERF-1) | dicomweb.service.ts | 205→146 ms, isolation intact |
| Telemetry retention prune (REL-1) | ops.scheduler.ts | bounds health_checks/job_records at 7 days |
| (none) speculative indexes | — | not justified by plans |

No destructive change. No index dropped. search_tsv GIN preserved.

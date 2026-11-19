# PACS Storage Management — Completion Checklist (PACS Operations Module 3)

## Requirements (from the Module 3 brief)
- [x] Storage dashboard using **actual** Orthanc, PostgreSQL, and filesystem data (no mock)
- [x] Monitor Orthanc storage + archive capacity
- [x] Used / available / total storage + utilization %
- [x] Modality-wise study counts + storage consumption (real per-study `DiskSize`)
- [x] Patient / study / series / instance statistics (live Orthanc)
- [x] Daily / monthly growth
- [x] Configurable alerts at 70 / 80 / 90 / 95% (defaults; editable)
- [x] Integrate Phase 8 notifications + alerts (raise/recover, dedup, role fan-out)
- [x] Growth forecasting from actual history (linear; days-until-threshold)
- [x] Snapshot history + CSV export
- [x] Admin storage config (thresholds)

## Critical protections (must never happen)
- [x] Never deletes DICOM files — data plane is read-only
- [x] Never deletes archived files
- [x] Never automatically migrates studies
- [x] Never modifies original DICOM instances / UIDs / transfer syntax
- [x] Never resets PostgreSQL
- [x] Never deletes Docker volumes
- [x] All existing modules/services preserved (Modules 1 & 2, Phases 1–9 intact)
- [x] Uses actual data, not mock statistics

## Engineering
- [x] Additive migration `0010_pacs_storage` (CREATE TABLE only; no DROP)
- [x] `studies_search_tsv_idx` GIN index preserved
- [x] Server-side RBAC (`pacs.storage.view` / `pacs.storage.manage`) + org isolation
- [x] No Orthanc/PG/Redis credentials exposed to client; no arbitrary filesystem access
- [x] BigInt → Number serialization; CSV formula-injection guard; audit on config/export/snapshot
- [x] Daily scheduler (Redis-locked); no new Docker service
- [x] Frontend wired (route `/pacs/storage`, nav under PACS)

## Verification
- [x] Backend measurement checks S1–S10 PASS (measured vs live Orthanc/filesystem)
- [x] Playwright `tests/storage.spec.ts` 8/8 PASS
- [x] Full Playwright regression 28/28 PASS
- [x] Backend Jest units 44/44 PASS (throwaway devDeps container)
- [x] Protections re-verified after test run (Orthanc 2489/10 unchanged; sigs intact; GIN present)
- [x] Screenshots 33 (dashboard) / 34 (modality) / 35 (growth)

## Documentation
- [x] PACS_STORAGE_ARCHITECTURE.md
- [x] PACS_STORAGE_API.md
- [x] PACS_STORAGE_GUIDE.md
- [x] PACS_STORAGE_TEST_RESULTS.md
- [x] PACS_STORAGE_CHECKLIST.md
- [x] docs/PROGRESS.md updated

## Scope
- [x] Module 3 only — Module 4 not started (awaiting review/approval)

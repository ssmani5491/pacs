# PACS Operations History — Completion Checklist (PACS Operations Module 4)

## Requirements (from the brief)
- [x] Reverse push history: Job ID, destination, patient ID, study UID, modality, total/success/failed
      instances, duration, status, created-by, start/completion timestamps
- [x] Reverse push instance-level detail incl. per-instance error messages
- [x] Archive history: Job ID, study UID, patient ID (permission-gated), modality, original/compressed
      size, ratio, savings, SHA-256, verification status, duration, destination (path), created-by, completion
- [x] Archive detail + checksum verification (non-mutating)
- [x] Unified dashboard: reverse-push totals (total/success/failed/pending), archive totals
      (total/verified/failed), original/compressed/savings bytes, recent operations
- [x] Date summaries: today / 7d / 30d / custom
- [x] All metrics from actual DB records; no duplicate counting
- [x] Advanced filtering (date, type, destination, patient ID, study UID, modality, status, created-by,
      verification), combinable, server-side paginated + sorted
- [x] Operation details for every operation (reverse-push + archive)
- [x] CSV export: reverse-push, archive, unified, summaries
- [x] CSV: server-side, formula-injection-safe, permission-checked, org-isolated, capped (10,000),
      export timestamp + exporting user, audit event per export
- [x] CSV omits patient info unless permissions allow
- [x] RBAC: reuse pacs.reverse-push.view / pacs.archive.view (no new permission)
- [x] Frontend "PACS Operations" nav group (Reverse Push Monitor, Archive Compression,
      Storage Management, Transfer & Archive History)
- [x] Summary cards, filter panel, history table, status badges, operation detail, export, pagination
- [x] Actual APIs + records, no mock data

## Clarification (from approval)
- [x] On-demand archive re-verify does NOT modify the archive or any job/verification record; audited

## Critical protections
- [x] Reuse existing tables; **no migration**
- [x] `studies_search_tsv_idx` GIN preserved
- [x] Never resets PostgreSQL; never deletes Docker volumes
- [x] Never deletes DICOM studies or archived files
- [x] All 8 services + nginx dynamic DNS preserved
- [x] Phases 1–9 and PACS Ops Modules 1–3 preserved and functional

## Engineering
- [x] Service-layer union (Approach A); no new Docker service
- [x] Server-side RBAC (OR-gate) + org isolation; patient MRN gated by `patient.view`; archive path gated by `pacs.archive.manage`
- [x] Patient MRN + modality via batched Study→Patient join
- [x] BigInt → Number serialization; CSV `csv()` injection guard; audit on export + re-verify
- [x] Non-mutating re-verify via `ArchiveService.inspectIntegrity` (reuses Module 2 `verifyFile`)

## Verification
- [x] Integration suite `tests/operations-history.spec.ts` 14/14 PASS (RED watched first)
- [x] Accuracy cross-checked EXACT against raw SQL (totals + byte sums + no-dup + CSV row count)
- [x] Full Playwright regression 42/42 PASS
- [x] Backend Jest units 44/44 PASS
- [x] Protections re-verified after run (Orthanc 2489/10 unchanged; archive_jobs 4 / verified 2 unchanged
      — re-verify non-mutating proven; sigs 3; GIN present; no volume/DICOM/archive touched)
- [x] Screenshots 36 (dashboard) / 37 (unified) / 38 (detail drawer)

## Documentation
- [x] PACS_OPERATIONS_HISTORY_ARCHITECTURE.md
- [x] PACS_OPERATIONS_HISTORY_GUIDE.md
- [x] PACS_OPERATIONS_HISTORY_API.md
- [x] PACS_OPERATIONS_HISTORY_TEST_RESULTS.md
- [x] PACS_OPERATIONS_HISTORY_CHECKLIST.md
- [x] docs/PROGRESS.md updated

## Scope
- [x] Module 4 only — Module 5 not started (awaiting review/approval)

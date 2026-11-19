# PACS Storage Management — Test Results (PACS Operations Module 3)

Environment: all 8 services healthy. Data at test time: Orthanc **2489 instances / 16 series /
10 studies / 6 patients**; archive volume ~3.8 MB. Figures below are the real measured values.

## Backend measurement checks (S1–S10)

| # | Check | Result |
|---|---|---|
| S1 | `/dashboard` returns real Orthanc counts (2489 instances, 10 studies, 16 series, 6 patients) | **PASS** |
| S2 | Dashboard `orthanc.bytes` == live Orthanc `TotalDiskSize` (324202939) | **PASS** |
| S3 | Modality breakdown bytes summed from real per-study `DiskSize` (CT 324196112 + OTHER 6827 ≈ total) | **PASS** |
| S4 | Disk total/used/avail from `fs.statfsSync` (118.2 GB used / 1006.9 GB total, 11.7%) | **PASS** |
| S5 | Archive bytes = recursive walk of volume (3973504 B; `du -sb` 3985792 — differ only by dir-block accounting; both real) | **PASS** |
| S6 | Snapshot persisted to `storage_snapshots`; dashboard serves fresh snapshot (<10 min) else live compute | **PASS** |
| S7 | Growth: daily/monthly computed from snapshot series; forecast days-until p70/p80/p90/p95 with basis string | **PASS** |
| S8 | Threshold crossing raises Phase 8 `SystemAlert` (`storage:disk:utilization`) + pacs_admin notification; auto-recovers when below | **PASS** |
| S9 | CSV export returns `text/csv`, provenance comment + header row, formula-injection guarded; `STORAGE_HISTORY_EXPORT` audited | **PASS** |
| S10 | Config PATCH persists thresholds to `system_settings['storage.config']`; audited | **PASS** |

Alert test method: temporarily set `critical` below current utilization via `PATCH /config`, captured
a snapshot → `storage:disk:utilization` CRITICAL raised + notification created; restored thresholds,
re-captured → alert auto-recovered. Synthetic forecast snapshots used to exercise growth were removed
afterwards, leaving only real captures.

## Integration test suite (Playwright, `tests/storage.spec.ts`) — 8/8 PASS
1. storage endpoints require `pacs.storage.view` (receptionist → 403)
2. config PATCH + snapshot require `pacs.storage.manage` (radiologist → 403)
3. dashboard reports real Orthanc + filesystem measurements
4. dashboard orthanc bytes match live Orthanc; modality study counts sum to Orthanc study count
5. growth + forecast computed from snapshot history
6. config GET + admin PATCH round-trips (and restores)
7. history CSV export downloadable, correct headers, audited
8. storage org isolation (non-privileged org user → 403)

## Full regression
- **Playwright: 28/28 passed** (viewer, reporting, ops, reverse-push, archive, storage).
- **Backend unit (Jest) : 44/44 passed, 11/11 suites** (run in a throwaway `node:24` container with
  devDependencies; the deployed production image omits Jest/devDeps, which is why `node --test` in the
  running container reports `describe is not defined` — a harness artifact, not a code regression).

## Critical protections — verified before and after testing
- Orthanc unchanged: **2489 instances / 10 studies** before and after the full run.
- Report signatures preserved (3); no signed report/audit modified.
- `storage_snapshots` only grew by intended captures; config PATCH test restored thresholds.
- GIN index `studies_search_tsv_idx` present; no volume deleted; no DICOM/archive file deleted,
  migrated, or modified; PostgreSQL never reset.

## Not claimed
This is functional + integration verification on synthetic data in a dev environment. It is **not** a
production-readiness certification; real-world capacity planning depends on the deployment's actual
disk, retention policy, and ingest rate.

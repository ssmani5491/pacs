# PACS Operations History — Test Results (PACS Operations Module 4)

Environment: all 8 services healthy. Data at test time: 6 reverse-push jobs, 4 archive jobs
(2 VERIFIED, 1 FAILED, 1 CANCELLED), Orthanc 2489 instances / 10 studies. All figures below are real.

## Integration suite — `tests/operations-history.spec.ts` (14/14 PASS)

| # | Test | Result |
|---|---|---|
| 1 | History requires a source permission (receptionist 403, admin 200) | **PASS** |
| 2 | Unified list total == reverse-push total + archive total (no duplicate counting) | **PASS** |
| 3 | Reverse-push-only user sees only PUSH rows; archive endpoint → 403. Archive-only user sees only ARCHIVE rows; reverse-push endpoint → 403 | **PASS** |
| 4 | User without `patient.view` → `patientMrn` null on every row | **PASS** |
| 5 | Dashboard reverse-push/archive totals match list totals; archive byte sums > 0 and savingsBytes correct | **PASS** |
| 6 | Date filters: future custom window → all zero (no 500); `from>to` → empty | **PASS** |
| 7 | Combined filter (type), pagination (pageSize=1), sort createdAt desc (non-increasing) | **PASS** |
| 8 | CSV unified export: text/csv, provenance line, header, `OPS_HISTORY_EXPORT` audited | **PASS** |
| 9 | Archive CSV omits `patientMrn` column for a user without `patient.view` | **PASS** |
| 10 | Export without any source permission → 403 | **PASS** |
| 11 | Reverse-push detail returns instance-level results; cross-org → 403 | **PASS** |
| 12 | Archive detail hides `archivePath` without manage; **non-mutating re-verify** leaves `verifiedAt`/`status` unchanged and is audited | **PASS** |
| 13 | Existing Module 1/2/3 endpoints still respond (200) | **PASS** |
| 14 | UI: Transfer & Archive History page loads with all four tabs | **PASS** |

## Accuracy cross-check vs raw SQL (exact)
| Metric | API | Raw SQL | Match |
|---|---|---|---|
| reverse-push total | 6 | 6 | ✅ |
| archive total | 4 | 4 | ✅ |
| archive originalBytes | 5337596 | 5337596 | ✅ |
| archive compressedBytes | 3973504 | 3973504 | ✅ |
| unified list total | 10 | 6 + 4 = 10 (disjoint) | ✅ |
| unified CSV data rows | 10 | 10 | ✅ |

No duplicate counting: reverse-push and archive are counted as disjoint sets; a study that was both
pushed and archived counts once per source, never merged.

## Full regression
- **Playwright: 42/42 passed** (14 new ops-history + 28 existing: viewer, reporting, ops, reverse-push,
  archive, storage).
- **Backend unit (Jest): 44/44 passed, 11/11 suites** (throwaway `node:24` devDeps container; the
  deployed production image omits Jest/devDeps by design).

## Critical protections — verified before and after testing
- **Read-only proven under real runs:** after the full suite (incl. re-verify tests), `archive_jobs`
  still = 4 and `verified` archives still = 2 — no verification record mutated; no archive file changed.
- Orthanc unchanged: **2489 instances / 10 studies** before and after.
- Report signatures preserved (3); GIN `studies_search_tsv_idx` present; no migration applied.
- No DICOM/archive deleted, migrated, or modified; PostgreSQL not reset; no volume touched.
- nginx dynamic DNS resolver present; all 8 services healthy; Modules 1–3 + Phases 1–9 intact.

## Not claimed
Functional + integration verification on synthetic data in a dev environment. **Not** a
production-readiness certification. Large-history behavior is covered by pagination + the 10,000-row
export cap; a multi-million-row stress test was **NOT TESTED**.

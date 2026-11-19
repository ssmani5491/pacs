# PACS Archive Compression — Test Results (2026-11-14)

All tests on the live stack, synthetic studies, isolated archive volume. Compression + checksum +
extraction were **independently verified** (sha256sum on disk, gunzip+unzip entry counts), not trusted
from app state alone. No original Orthanc study was modified or deleted.

## Core compression + verification
| # | Test | Result | Evidence |
|---|---|---|---|
| A1 | Select study from Orthanc | PASS | 300-instance CT study resolved (org-scoped) |
| A2 | Create archive job (level 6) | PASS | QUEUED, level 6 |
| A3 | Real compression + auto-verify | PASS | **orig 698730 → comp 520903 B, 25.45% saved, VERIFIED** |
| A4 | Archive file on disk + SHA-256 | PASS | file 520903 B; **`sha256sum` on disk == DB record** (a90a388e…) |
| A5 | Independent extraction | PASS | gunzip + unzip → **300 DICOM files** inside (matches study) |
| A6 | **Originals untouched (CRITICAL)** | PASS | source Orthanc still 2489 instances / 10 studies after archiving |
| A7 | Manual verify endpoint | PASS | "sha256 OK; extracts to 300 entries" |
| A8 | Restore / extraction (copy-only) | PASS | extracted to restore/<id>, 300 entries, note confirms no re-import |
| A9 | **No-overwrite of verified archive** | PASS | 2nd job same study → **FAILED "verified archive already exists; refusing to overwrite"** |
| — | Large study (2000 instances, level 9) | PASS | VERIFIED, 25.57% saved; 4.4 MB → 3.3 MB |

## Reliability / control
| # | Test | Result | Evidence |
|---|---|---|---|
| A12 | Cancellation | PASS | QUEUED job → CANCELLED |
| A13 | **Interrupted-job recovery** | PASS | backend restarted mid-compression of the 2000-instance job (interrupted during download) → recovery **re-queued** it → re-ran → **VERIFIED**. Also fixed: recovery now runs OUTSIDE the execution lock so a stale lock from the crashed process cannot block it; lock TTL shortened to 60 s. |

## Security
| # | Test | Result | Evidence |
|---|---|---|---|
| A10 | Org isolation | PASS | rad_tcl → GGH archive job 403; list 403 |
| A11 | Permission enforcement | PASS | recept1 monitor 403; rad_ggh (no archive.manage) create 403 |

## Automated tests
- **Playwright archive.spec.ts: 4/4 PASS** (permissions, monitor shape, verified-job sha256+savings,
  org isolation).
- Full Playwright suite: **20/20 PASS** (12 core + 4 reverse-push + 4 archive). Backend unit **44/44**.

## Regression (Phases 1–9 + Module 1 intact)
- 8 services healthy; endpoints worklist/reporting/notifications/revpush-monitor/archive-monitor/
  viewer/dicom-web all 200; MWL :4243 + C-STORE :4242 up.
- **search_tsv GIN present; signatures intact (3)**; DB backed up pre-migration
  (`backups/ris-pre-archive-*.sql.gz`); all Docker volumes preserved; new `pacs_archive` volume added.
- Source Orthanc untouched (2489 instances).

## Known limitations
- Compression ratio on already-compressed DICOM is modest (~25% here on synthetic CT); real savings
  depend on the source transfer syntax. This is honest container compression, not transfer-syntax
  recompression (which is out of scope by design).
- Restore extracts to a server-side folder for inspection; it does NOT re-import into Orthanc
  (copy-only; re-import would be a separate, explicitly-authorized workflow).
- Transfer/worker parallelism: one job runs at a time per the scheduler lock (serialized across jobs);
  within a job, gzip runs on a worker thread. Multi-job parallelism is a documented enhancement.

# DICOM Reverse Push — Test Results (2026-11-14)

All tests executed against the live stack with synthetic data. A **throwaway second Orthanc**
(`orthanc-dest`, AE DESTPACS, port 4242) on the pacs network served as the destination PACS and was
removed after testing (never added to docker-compose). **Receipt was verified ON THE DESTINATION**,
not from the sender's log.

## End-to-end (acceptance core)
| # | Test | Result | Evidence |
|---|---|---|---|
| T1 | Create destination | PASS | destination row created |
| T2 | Test Connection (real C-ECHO) | PASS | Orthanc SCU C-ECHO to DESTPACS → **acknowledged (ok=true)** |
| T3 | Select study from Orthanc | PASS | 150-instance CT study resolved (org-scoped) |
| T4 | Create reverse-push job | PASS | QUEUED, **150 instances enumerated** |
| T5 | Actual C-STORE transfer | PASS | job **COMPLETED, 150/150** |
| **T6** | **Verify on destination** | **PASS** | **destination Orthanc = 150 instances** (verified on receiver) |
| T7 | StudyInstanceUID match | PASS | destination StudyInstanceUID == source UID exactly |
| T8 | Instance-level status | PASS | 150 DicomTransferInstance rows, all SUCCESS; speed computed |
| — | Large transfer | PASS | 2000-instance study → destination received 2000; job COMPLETED 2000/2000 |
| — | Destination totals | PASS | after both: **2150 instances / 2 studies** on destination |

## Negative / edge
| # | Test | Result | Evidence |
|---|---|---|---|
| T9 | 2nd job after completion | PASS | allowed (201) — dedup blocks only concurrently-active |
| T10 | Invalid destination (unreachable host) | PASS | C-ECHO → ok=false (graceful) |
| T11 | SSRF protection | PASS | dest host=postgres/redis → **400 blocked** |
| T12 | Active-duplicate prevention | PASS | 2nd job for same dest+study while 1st active → **409** |
| T13 | Job cancellation | PASS | → CANCELLED (association released safely) |
| T14 | Organization isolation | PASS | rad_tcl → GGH destination/job = 403 |
| T15 | Permission enforcement | PASS | recept1 list dest = 403; rad_ggh create dest = 403 |
| — | Restart recovery | PASS | 2000-instance job interrupted by backend redeploy → reconciled from Orthanc job state → COMPLETED on next tick |

## Partial-failure / retry
Partial-failure is modeled (PARTIALLY_COMPLETED when some instances fail; retry re-sends only FAILED
instances). In testing all instances to the healthy destination succeeded, so a **forced** partial
failure (e.g. destination rejecting some SOP classes) was **NOT induced** — the retry path is
implemented and unit-reachable but a real rejected-C-STORE scenario against a misconfigured destination
is documented as NOT TESTED (would require a destination configured to reject specific instances).

## Automated tests
- **Playwright reverse-push.spec.ts: 4/4 PASS** (permission enforcement, SSRF protection, monitor
  shape, org isolation).
- Full Playwright suite (regression): **12/12 PASS**. Backend unit: **44/44 PASS**.

## Regression (Phases 1–9 intact)
- 8 services healthy; endpoints health/worklist/reporting/notifications/audit/dashboard/viewer/
  dicom-web/revpush-monitor all 200; MWL :4243 + C-STORE :4242 up.
- **Source Orthanc untouched**: 2489 instances / 10 studies (reverse push reads, never modifies source).
- search_tsv GIN present; signatures intact; all Docker volumes preserved; DB backed up pre-migration
  (`backups/ris-pre-revpush-*.sql.gz`).

## Known limitations
- Forced partial-failure / rejected-C-STORE scenario NOT TESTED (needs a destination that rejects
  specific instances). Retry-of-failed path implemented.
- Transfer speed is an estimate (~256 KB/instance / duration), not measured bytes-on-wire.
- Orthanc's async store job is per-job (not per-instance callbacks), so instance rows are marked in
  bulk from the job's terminal Success/Failure; FailedInstancesCount is honored for partial outcomes.

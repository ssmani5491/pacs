# PACS Archive Compression — Checklist (PACS Operations Module 2) ✅ (2026-11-14)

Legend: [x] done/verified · [~] partial/documented · [NT] not tested

## Requirements (brief 1–10)
- [x] 1. Configure source + destination archive storage (source=Orthanc; dest=pacs_archive volume; config API)
- [x] 2. Select studies for archiving (by Study Instance UID, org-scoped, must have Orthanc images)
- [x] 3. Real **lossless** archive compression (Orthanc study ZIP + gzip; DICOM bytes untouched)
- [x] 4. Configurable compression levels (0–9) + worker threads (Node worker_threads pool)
- [x] 5. Record original size, compressed size, ratio, savings % (all stored + shown)
- [x] 6. Verify integrity with **SHA-256** (stored + re-checked; auto-verify + manual verify endpoint)
- [x] 7. Archive extraction + restoration (restore endpoint: gunzip + extract, copy-only)
- [x] 8. Interrupted-job recovery (reconcile RUNNING jobs; re-queue if incomplete; verified test)
- [x] 9. Persistent archive job history (archive_jobs table; JOBS view)
- [x] 10. Integrate notifications + audit + monitoring (pacs_admin notifications; full audit; monitor dashboard)

## Critical protection (brief)
- [x] Never delete original Orthanc instances (copy-only; verified source untouched: 2489 instances)
- [x] Never modify original DICOM files / UIDs / transfer syntax (container compression only)
- [x] **Never overwrite an existing verified archive** (2nd job → FAILED with explicit message)
- [x] Never reset PostgreSQL / delete volumes (additive migration 0009; DB backed up first)
- [x] Synthetic data for testing; isolated archive volume + restore/tmp subfolders
- [x] Preserved Phases 1–9 + Module 1 (20/20 Playwright, 44/44 unit, endpoints 200, GIN present)
- [x] ZIP+gzip documented lossless container; NOT confused with DICOM transfer-syntax compression
- [x] Copy-only; automatic source deletion OUT OF SCOPE (not implemented)

## Security
- [x] pacs.archive.view / pacs.archive.manage, server-side, org isolation
- [x] Audit on config/create/cancel/verify/restore/done; no Orthanc creds exposed
- [x] No arbitrary filesystem access (paths derived from sanitized study UID, under archive root)

## Testing (brief)
- [x] Actual compression (25.45% / 25.57% on synthetic CT) — PASS
- [x] Checksum verification (sha256 on disk == DB; re-verify endpoint) — PASS
- [x] Extraction (300 DICOM files recovered) — PASS
- [x] Restoration (restore endpoint, copy-only) — PASS
- [x] Interrupted-job recovery (restart mid-job → re-queued → VERIFIED) — PASS
- [x] Org isolation + permission enforcement — PASS
- [x] Isolated test storage (archive volume subfolders; cleaned after)

## Acceptance
- [x] Real lossless archives produced + verified; sizes/ratio/savings recorded; integrity checksum;
      extraction/restore; interrupted-recovery; persistent history; notifications/audit/monitoring;
      originals preserved; no-overwrite protection; all prior functionality intact.

## Known limitations / NOT TESTED
- Modest ratio on already-compressed DICOM (depends on source transfer syntax) — documented.
- Restore extracts server-side for inspection; re-import into Orthanc is a separate future workflow.
- One job at a time (scheduler-serialized); multi-job parallelism = enhancement.
- [NT] Very large (6600-instance) archive stress — not run (resource/time; 2000-instance validated).

**Module 2 complete. Do NOT start Module 3 until this is reviewed and approved.**

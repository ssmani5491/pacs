# DICOM Reverse Push — Checklist (PACS Operations Module 1) ✅ (2026-11-14)

Legend: [x] done/verified · [~] partial/documented · [NT] not tested

## Destination configuration (§4)
- [x] Fields: name, AE title, IP, port, calling AE, timeouts, max concurrent, active, description
- [x] Multiple destinations supported
- [x] Test Connection via **real DICOM C-ECHO** (Orthanc native SCU)
- [x] Only pacs.destination.manage can configure
- [x] SSRF / unauthorized-network protection (internal infra denylist → 400)
- [x] No credentials exposed

## Study selection (§5)
- [x] Select by Study Instance UID; org-scoped; only studies with Orthanc images
- [~] UI selection is by Study UID (paste from worklist); multi-study/date-range/modality batch picker
      is a documented enhancement (API accepts one study per job; multiple jobs = multiple studies)
- [x] Confirmation before submit (modal); shows destination + study

## Transfer engine (§6) — Orthanc native C-STORE SCU
- [x] Retrieve instances from Orthanc; register modality; **real C-STORE**; capture destination ack
- [x] Instance-level success/failure recorded; association released safely
- [x] Success only when destination acknowledges (Orthanc store job Success, 0 failed)
- [x] No simulated transmission

## Job management (§7)
- [x] States PENDING/QUEUED/RUNNING/COMPLETED/PARTIALLY_COMPLETED/FAILED/CANCELLED
- [x] Tracks all fields (id, destination, study, counts, timing, speed, retry, error, createdBy)
- [x] Pause / Resume / Cancel / Retry (retry re-sends only failed instances)
- [x] Persistent job records + idempotency (one active job per dest+study; unique instance rows; Redis lock)
- [x] Duplicate execution prevented

## Monitor UI (§8)
- [x] Server status (engine), destination connectivity + last test
- [x] Queue summary (pending/active/completed/failed + partial/cancelled)
- [x] Transmission summary (total/success/failed files, success %)
- [x] Jobs list (status, destination, study, progress, speed, created) + controls
- [x] Job detail page (per-instance status, timing, errors)
- [x] Real backend data (no mock progress/fake success)

## Database (§9)
- [x] Additive migration 0008 (PacsDestination, DicomTransferJob, DicomTransferInstance)
- [x] UUID PKs, org relations, FKs, idempotency constraints, indexes, timestamps
- [x] No clinical record modified; **search_tsv GIN preserved**; DB backed up pre-migration

## API (§10) + Security (§11)
- [x] All destination + reverse-push endpoints implemented
- [x] JWT + RBAC + org isolation enforced server-side
- [x] Permissions pacs.reverse-push.view/manage, pacs.destination.manage
- [x] SSRF guard, input validation, audit logging; no Orthanc creds exposed; no arbitrary fs/network

## Testing (§12) + Regression (§13)
- [x] Separate synthetic Orthanc destination; receipt verified ON the destination (UIDs + counts)
- [x] Destination config, C-ECHO, invalid dest, real C-STORE, multi-instance, cancel, dup prevention,
      transfer history, org isolation, permissions — all PASS
- [~] Forced partial transfer / rejected C-STORE / network-timeout mid-transfer — NOT TESTED (needs a
      destination that rejects specific instances); retry path implemented
- [x] Restart-recovery of interrupted jobs — PASS
- [x] Playwright 4/4 (module) + 12/12 (full) ; backend unit 44/44
- [x] Phases 1–9 intact; 8 services; source Orthanc untouched; volumes preserved

## Acceptance criteria (§15)
- [x] 1 Multiple destinations · [x] 2 C-ECHO association test · [x] 3 select from Orthanc ·
  [x] 4 real C-STORE · [x] 5 instance-level status · [x] 6 partial failures identified (modeled) ·
  [x] 7 retry failed · [x] 8 progress from real job data · [x] 9 persistent history · [x] 10 audit+RBAC ·
  [x] 11 synthetic destination receives + verified · [x] 12 prior functionality intact

## Known limitations
- Forced partial-failure scenario NOT TESTED. Multi-study batch selection UI = enhancement (one study
  per job today). Transfer speed is an estimate. Not production-ready for real hospital PACS without a
  real destination test + operational review.

**Module 1 complete. Do NOT start Module 2 (Archive Compression) until this is accepted.**

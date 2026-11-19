# Phase 4 Checklist — Orthanc Integration & DICOM C-STORE  ✅ COMPLETE (2026-11-13)

Legend: [x] done · [~] partial

## Config
- [x] Set AE Title = GGHPACS, DICOM port 4242 (env + orthanc)
- [x] Orthanc DICOMweb + worklist already enabled (Phase 1) — verify
- [x] Secure Orthanc admin (auth required; not exposed via nginx publicly)

## Schema (additive migration 0004)
- [x] DicomReceptionLog (per C-STORE/study event: status, modality, aet, counts, error)
- [x] ModalityDevice: lastSuccessAt, lastFailureAt (connectivity history)
- [x] Study: add isReconciled flag (orphan handling already has isOrphan)
- [x] Protect search_tsv index (strip Prisma DROP by hand)

## Module 1: Orthanc integration (NestJS client)
- [x] OrthancService: REST client (system, studies, series, instances, metadata)
- [x] Health monitoring endpoint
- [x] Storage/statistics retrieval

## Module 2+4: Ingest (C-STORE → RIS)
- [x] POST /ingest/orthanc-study (called by on-stored.lua) — real, not mock
- [x] Pull study metadata from Orthanc REST
- [x] Extract all required DICOM tags
- [x] Upsert Patient→Study→Series→Instance (never silent overwrite)
- [x] Accession + Study UID matching to RIS order
- [x] Duplicate SOP detection (instances deduped via upsert on SOP Instance UID; re-ingest updates, never duplicates)
- [x] Orphan/unmatched → reconciliation queue
- [x] Full audit trail (DICOM_RECEIVED, STUDY_INGESTED, etc.)

## Module 3: Metadata extraction
- [x] All required tags mapped (patient/study/series/instance)

## Module 5: Modality connectivity
- [x] test-connection (TCP probe from Phase 2); modality status endpoint exposes lastSuccessAt/lastFailureAt
- [~] Auto-update of lastSuccess/lastFailure on each reception + per-modality log linkage
      (DB fields + status API exist; the ingest doesn't yet resolve callingAET→device to stamp them —
      finish alongside Phase 5 MWL when AE identity is wired)

## Module 6: Reconciliation
- [x] GET unmatched studies queue
- [x] POST reconcile (attach study to patient/order manually)
- [x] Duplicate study detection

## Module 7: Storage
- [x] Storage usage + disk stats via Orthanc statistics
- [x] Confirm no binaries in Postgres (metadata only)

## Module 8: Testing (real DICOM)
- [x] Generate synthetic DICOM (no real PHI)
- [x] Send via storescu (DCMTK) or pynetdicom to :4242
- [x] Verify: association, C-STORE, Orthanc storage, DB registration, worklist update
- [x] Duplicate SOP handling, unmatched handling, audit

## Module 9: Frontend
- [x] PACS monitoring dashboard (Orthanc health, storage, stats)
- [x] DICOM reception logs page
- [x] Reconciliation page

## Module 10: Security
- [x] Ingest endpoint restricted (internal only / shared secret)
- [x] Orthanc not publicly exposed; admin via auth
- [x] Metadata validation; audit admin ops

## Acceptance
- [x] External DICOM client → Orthanc → Postgres → RIS worklist, automatically

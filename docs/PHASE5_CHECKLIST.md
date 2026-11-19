# Phase 5 Checklist — DICOM Modality Worklist (MWL SCP)  ✅ COMPLETE (2026-11-13)

Legend: [x] done · [~] partial

## Architecture
- [x] Dedicated MWL SCP service (pynetdicom) querying RIS Postgres live on each C-FIND
- [x] AE Title GGHMWL, configurable port (default 4243), in docker-compose
- [x] Reads scheduled_orders + patient join; excludes CANCELLED/COMPLETED/inactive
- [x] Writes MWL query logs to the DB (reuse/extend logging)

## 1. MWL SCP (real C-FIND)
- [x] ModalityWorklistInformationFind SOP class, association handling
- [x] Configurable AE title + port; multiple calling modalities
- [x] Correct DICOM attributes/VRs for MWL dataset
- [x] Handle invalid queries / association failures gracefully

## 2. Database integration (tag mapping)
- [x] Patient ID, Name, BirthDate, Sex
- [x] AccessionNumber, RequestedProcedureID/Description
- [x] ScheduledProcedureStepSequence: step id, date, time, modality, AET, physician
- [x] ReferringPhysicianName, InstitutionName
- [~] Department / PerformingPhysician returned as empty (fields not yet on the order; wire when added)
- [x] Correct VRs; no invented tags

## 3. Modality config
- [x] Uses existing modality_devices (AE title, host, port, active)
- [~] lastSuccessAt/lastFailureAt: schema fields + status API exist; MWL SCP logs every query to
      mwl_query_logs with callingAET, but does not yet stamp the matching device row (defer to when
      calling-AE→device resolution is wired, same as the Phase 4 note)
- [x] MWL query log table (callingAet, status, count, timestamp, filters)

## 4. Query matching
- [x] Patient ID, name (wildcard *), accession, modality, scheduled date (single + range)
- [~] Station AET: accepted + recorded in filters, not yet bound to a column (no per-station scheduling field)
- [x] DICOM matching: single-value, wildcard (* ?), universal, date range

## 5. Order status
- [x] Exclude CANCELLED/COMPLETED/inactive from worklist
- [x] No duplicate accession numbers (already enforced unique)

## 6. Monitoring
- [x] MWL query log table + API
- [x] MWL monitoring dashboard (query counts, last query, per-device stats)
- [x] Frontend MWL logs page

## 7. Testing (real C-FIND via pynetdicom)
- [x] Association, query by PatientID / Accession / Modality / ScheduledDate
- [x] Wildcard name, cancelled-order exclusion, unmatched query
- [x] Invalid called-AE → association rejected (REJECTED logged)
- [~] "Inactive modality": the MWL scopes by order status, not by device active flag — an inactive
      device is a reception/association concern, not an MWL order filter; not separately tested
- [x] Verify returned datasets + attributes; MWL query logging (SUCCESS/NO_MATCH/REJECTED)

## 8. End-to-end acceptance
- [x] patient → CT order → MWL C-FIND returns it → query by accession →
      C-STORE matching study → study matches order → RIS worklist status correct

## Rules
- [x] Additive migration only; protect search_tsv GIN; preserve volumes/data

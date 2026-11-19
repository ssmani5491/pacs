# Phase 3 Checklist — Patients, Orders, RIS Worklist  ✅ COMPLETE (2026-11-13)

Legend: [x] done · [~] partial

## Schema (additive migration only)
- [x] Patient: add email, address, referringDoctorId, departmentId, status, registrationDate; index name/mrn
- [x] ScheduledOrder: add departmentId, assignedUserId, priority, clinicalHistory, studyDescription, studyId link
- [x] Study: already has needed fields + indexes (verify)
- [x] New migration 0003 (no reset)

## Module 1: Patient Management
- [x] API: list (paginate/search/sort), get, create, update, activate/deactivate
- [x] Patient ID generation (GG00###### style, per-org sequence)
- [x] Duplicate detection (name+dob+gender) with override
- [x] Patient history endpoint (studies + orders)
- [x] Patient merge with audit
- [x] RBAC patient.manage/view; org isolation; audit; validation
- [x] Frontend: list, registration form, details page
- [x] Tests

## Module 2: Examination Order Management
- [x] API: CRUD + cancel + assign radiologist + priority
- [x] Accession number generation (unique)
- [x] RBAC order.manage; org isolation; audit; validation
- [x] Frontend: order list + create/edit
- [x] Tests (accession uniqueness)

## Module 3: RIS Worklist
- [x] API: unified worklist query over studies+orders with all filters + status tabs + pagination/sort
- [x] Status tabs: All/Ready/Draft/Preliminary/Final/Cancelled/Pending
- [x] Filters: patientId, name, accession, modality, date range, doctor, dept, org, status
- [x] Frontend worklist table (12 columns) — reproduces Pixray structure
- [x] Row actions: details (works now), viewer/report (wired, point to Phase 6/7 stubs)
- [x] Tests (filtering, pagination)

## Module 4: Study Assignment
- [x] API: assign/reassign + history + pending list
- [x] Audit every change
- [~] Frontend: worklist shows assigned radiologist (assign-button UI deferred to Phase 7 reporting flow; assign API fully working + tested)
- [x] Tests

## Module 5: Patient & Study History
- [x] Patient details page: demographics + prior studies/orders table
- [x] Prepared for prior-comparison in viewer

## Module 6: Dashboard Integration
- [x] Extend /admin/dashboard with patient/order/study/report stats + modality breakdown
- [x] Frontend cards updated; Phase 2 cards preserved
- [x] Tests

## Performance
- [x] Seed 1,000 synthetic patients + 5,000 orders/studies (synthetic only)
- [x] Measure worklist search + pagination latency

## Verification
- [x] 6 services healthy; Phase 1/2 intact
- [x] Unit + live e2e + browser screenshots
- [x] docs/PROGRESS.md updated

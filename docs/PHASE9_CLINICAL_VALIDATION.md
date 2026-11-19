# Phase 9 — Clinical Workflow Integrity (2026-11-14)

Verified end-to-end clinical workflows against the live stack. Automated regression (Playwright 12/12,
backend unit 44/44) plus targeted invariant checks. Synthetic data only; no clinical record altered.

## Workflow 1 — Patient → Study (PASS, verified across phases)
Patient registration → examination order → MWL C-FIND returns the order → modality C-STORE → Orthanc
registration → ingest → RIS worklist. Verified live: MWL C-FIND association works; C-STORE stores
instances; ingest registers Patient→Study→Series→Instance; worklist shows the study. (Phase 3–5 +
re-confirmed in Phase 9 DICOM security: authorized C-STORE 6/6, study appears.)

## Workflow 2 — Reporting (PASS)
Study open → OHIF image review → preliminary → finalize → authenticated signature (password step-up +
SHA-256 hash) → PDF. Playwright `reporting.spec.ts` "full report lifecycle + immutability + addendum +
pdf" PASS. Live: signed report edit → **409 (immutable)**; signatures intact (2).

## Workflow 3 — Addendum (PASS)
Signed report → addendum (separate linked Report row) → **original report byte-for-byte unchanged** →
version history preserved. Covered by the Playwright lifecycle test (addendum assertion) and Phase 7
validation. Original FINAL report stays locked; addendum is its own DRAFT row with parentReportId.

## Workflow 4 — Reconciliation (PASS)
Unmatched C-STORE study → ingested as **ORPHAN** (reception log ORPHAN, isReconciled=false) → queued
for reconciliation → **ORPHAN_STUDY notification generated** → audit record written. Verified live in
Phase 9 DICOM security (DICOM-8): orphan row present, reconciliation queue populated, notification + a
reception log entry created.

## Workflow 5 — Organization isolation (PASS)
Two orgs (GGH, TCL), separate users (rad_ggh, rad_tcl). Cross-org access blocked at object level:
patient 404, order/report/study/versions/pdf/DICOMweb all 403. Notification isolation reconfirmed
after the Phase 9 fix (REL-3): rad_tcl total = 0; rad_ggh sees only its own. Playwright `viewer` +
`reporting` + `ops` org-isolation tests PASS.

### REL-3 (MEDIUM) — notification cross-org fan-out — FIXED + RETESTED
- **Evidence**: an orphan study (no matched org) produced a role-based `STUDY_MATCHED` notification
  with `organizationId = null`; `resolveRecipients` used `organizationId: input.organizationId ??
  undefined`, so Prisma dropped the org filter and **fanned the notification out to radiologists in
  EVERY organization** — rad_tcl received a copy of a GGH-origin event.
- **Risk**: operational notification leaked across org boundaries (not clinical data, but an isolation
  gap). MEDIUM.
- **Fix**: `notifications.service.ts` — role fan-out now requires a concrete `organizationId` (a
  null-org role notification does NOT fan out cross-org); read-side `recipientScope` also tightened to
  match the user's org exactly (null matches only null). Stale leaked synthetic notifications removed.
- **Retest**: rad_tcl notifications = **0**; rad_ggh unaffected; Playwright 12/12 PASS.

## Workflow 6 — Concurrent report access (PASS — no silent overwrite)
The report lifecycle is server-enforced and version-snapshotted. Two users editing: each PATCH writes
a new monotonic ReportVersion snapshot (no lost-update of history); a FINAL/locked report rejects edits
with **409** (verified live). Signatures are immutable (hash over content+signer+server-time+version).
Autosave posts PATCHes that each version; the signed state is a hard stop. No change was made to the
signature implementation. (Formal optimistic-locking "conflict detection" UI is a documented
enhancement — see limitations.)

## Audit completeness (PASS)
Clinical actions write append-only audit rows (LOGIN, ORDER_ASSIGN/CANCEL, REPORT_PRELIMINARY/FINALIZE/
SIGN/ADDENDUM, STUDY_INGESTED/ORPHAN, ALERT_*, AUDIT_EXPORT). Audit viewer filters + CSV export +
org isolation verified in Phase 8 + Phase 9 security. Audit history never deleted.

## Regression summary (Phases 1–8)
- Playwright **12/12 PASS** (viewer 4, reporting 3, ops 5).
- Backend unit **44/44 PASS**.
- All routes 200; MWL :4243 + C-STORE :4242 up; search_tsv GIN present; data preserved.

## Limitations / documented enhancements
- Concurrent-edit **conflict-detection UI** (optimistic locking with a version token surfaced to the
  user) is not implemented; the server prevents history loss (append-only versions) and blocks edits
  to signed reports, but two simultaneous DRAFT editors could overwrite each other's latest text
  (both versions are retained in history). Documented as a future enhancement; signature integrity is
  unaffected.

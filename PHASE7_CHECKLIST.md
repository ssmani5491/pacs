# Phase 7 Checklist — Radiology Reporting Engine ✅ (2026-11-14)

Legend: [x] done/verified · [~] partial / documented limitation

## Module 1 — Report editor
- [x] 10 sections: Patient Info, Exam Details, Clinical History, Technique, Comparison,
      Findings, Impression, Recommendations, Reporting Radiologist, Report Date/Time
- [x] Auto-populate patient + study from the selected RIS study
- [x] Enter/edit content (radiologist)
- [x] Auto-save (1.2s debounce) with clear status (Saving / ✓ Saved / Unsaved / ⚠ failed)
- [x] Unsaved-change guard (beforeunload)

## Module 2 — Report lifecycle (server-enforced, transactional)
- [x] DRAFT → PRELIMINARY → FINAL; create/save/edit draft/submit preliminary/finalize/sign/lock
- [x] View history; controlled addendum
- [x] Blocked: cross-org finalize (403), edit of signed report (409), re-sign (409),
      wrong-password sign (401); backdating impossible (server timestamps only)
- [x] Finalized reports immutable; corrections via linked ADDENDUM, original preserved byte-for-byte

## Module 3 — Template management
- [x] CT/MRI/X-ray/US/MG/other modalities; admin CRUD UI (/admin/report-templates)
- [x] Fields: name, code, modality, department, organization, technique, findings,
      impression, recommendations, default content, active
- [x] Seeds a new report's sections; global (no-org) templates visible to all; 4 seeded

## Module 4 — Reporting worklist
- [x] Dashboard with buckets: UNREPORTED, DRAFT, PRELIMINARY, FINAL, ADDENDUM (+counts)
- [x] Filters: patient, accession, modality, date, assigned radiologist, my-assignment
- [x] Opens the report editor; editor can open the study in OHIF

## Module 5 — OHIF integration
- [x] "Open in Viewer" from the report editor (uses the Phase 6 secure proxy, unchanged)
- [x] "Report" from the RIS worklist and the viewer context; patient/study/accession/modality shown
- [x] Study access validated (org isolation) before patient info is shown
- [~] Structured measurements: integration point prepared (no fake auto-annotations; honest)

## Module 6 — Digital signature
- [x] Authenticated radiologist + report.sign permission
- [x] Step-up re-authentication (password) at sign time
- [x] Records signer identity, SERVER timestamp, report version, SHA-256 signatureHash,
      verification string; locks the report; signature history preserved
- [x] Clearly labeled "authenticated electronic approval — NOT a legally recognised digital
      signature" (no over-claim)

## Module 7 — PDF generation (server-side, pdfkit pinned 0.20.2)
- [x] Hospital name/logo config, patient/exam details, clinical history, findings, impression,
      recommendations, radiologist (+ qualification), signature info, date/time, accession,
      version; addenda included
- [x] Preview/download (inline PDF via /api/reports/:id/pdf); print via browser
- [x] Authenticated + org-isolated + audited; not exposed to unauthorized users (report.download)

## Module 8 — Voice dictation
- [x] Browser mic + local Web Speech API into Findings/Impression; manual correction before save
- [~] Engine configurable + pluggable; OFF by default and labeled, because the browser Web Speech
      API may route audio to an OS/cloud engine — no PHI leaves without the user starting dictation

## Module 9 — Report macros
- [x] Model + API + apply-in-editor; personal / org-shared scope; report.create gates writes
- [~] UI is insert-from-list in the editor; a dedicated macro-admin screen is a thin add (deferred)

## Module 10 — Version history
- [x] Report id, version, snapshot (previous/updated content), modified-by, timestamp, reason, status
- [x] Previous signed versions remain accessible and unchanged (immutable snapshots)

## Module 11 — Addendum
- [x] Original unchanged; addendum linked (parentReportId); author, timestamp, reason, content, auth, audit
- [x] Original + addenda displayed together (editor + PDF)

## Module 12 — Security & permissions (server-side RBAC)
- [x] Separate perms: report.view/create/edit/preliminary/finalize/sign/amend/download, template.manage
- [x] Organization isolation enforced on every read/write; audit on every important action
- [~] Department-level isolation: org isolation enforced; department scoping present on templates/macros,
      not a hard per-report department wall (documented)

## Module 13 — Database
- [x] Reused existing Report/ReportTemplate/ReportVersion/ReportSignature models
- [x] Additive migration 0006 only (parentReportId, comparison, organizationId, reportType, version,
      timestamps; template code/org/technique/recommendations; version reason; signature version/method/
      verification; new report_macros table). No destructive statements.
- [x] Relationships: Patient → Order → Study → Report → ReportVersion / ReportSignature (+ addendum self-rel)
- [x] Transactions for lifecycle transitions
- [x] Preserved all records + indexes; **search_tsv GIN intact**

## Module 14 — Testing (synthetic data)
- [x] 18/18 API lifecycle+negative tests (scratchpad/test_report_lifecycle.sh)
- [x] 3/3 reporting Playwright tests; full suite 7/7 (viewer + reporting)
- [x] Browser: worklist → editor → template → auto-save → finalize → sign (step-up) → lock →
      history + signature; PDF sample generated
- [x] Backend unit 34/34; Phases 1-6 intact

## Rules
- [x] Phases 1-6 preserved; no PG reset; no volume deletion; no DICOM-record changes
- [x] Orthanc/MWL/OHIF/nginx-DNS preserved; real DB ops; additive migration; versions pinned

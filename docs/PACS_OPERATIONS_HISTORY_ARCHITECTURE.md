# PACS Operations History — Architecture (PACS Operations Module 4)

## Overview
A unified, **read-only** reporting layer over the existing reverse-push (Module 1) and archive
(Module 2) records: a combined dashboard with date summaries, filtered/paginated/sorted history
lists, per-operation detail, non-mutating archive re-verify, and secure CSV export. It **reuses the
existing tables and services** — no new engine, **no migration**, no new permission. Built on the
existing 8 services.

**Strictly read-only over the data plane:** it never writes to `DicomTransferJob`,
`DicomTransferInstance`, or `ArchiveJob`; never deletes/migrates/modifies DICOM or archives; never
overwrites a verified archive; never resets PostgreSQL or touches a volume's contents.

## Approach (chosen: service-layer union, "Approach A")
One `OperationsHistoryService` queries the two existing job tables per request (filtered by the
caller's visible sources + org + filters), normalizes each record to a common `OperationRow`, and for
the unified list fetches `page·pageSize` from each visible source at the DB level, merges, sorts, and
slices. Dashboard metrics use `count` / `groupBy` / `aggregate(_sum)` — no row loading. Alternatives
(a DB UNION view; a materialized history table + sync job) were rejected as they'd add a migration and
duplicate data, against the brief's "reuse existing records / avoid unnecessary migrations".

## Components
```
React OperationsHistory ──HTTP──> NestJS /api/pacs/operations/history/*
  (DASHBOARD/UNIFIED/                 │ OperationsHistoryController (no @RequirePermissions:
   REVERSE PUSH/ARCHIVE tabs)         │   OR-gate + per-source filtering enforced in the service;
                                      │   global JwtAuthGuard still requires auth)
                                      │ OperationsHistoryService
                                      │   ├─ visibleSources / requireAnySource / canSeePatient / orgWhere
                                      │   ├─ studyLookup  (batched Study→Patient join: MRN + modality)
                                      │   ├─ normalize{Transfer,Archive}Job → OperationRow
                                      │   ├─ list / listReversePush / listArchive  (filters, sort, page)
                                      │   ├─ dashboard  (count/groupBy/_sum + recent)
                                      │   ├─ {reversePush,archive}Detail
                                      │   ├─ reverifyArchive → ArchiveService.inspectIntegrity (read-only)
                                      │   └─ exportCsv  (reverse-push|archive|unified|summary)
                                      ▼
            Prisma → dicom_transfer_jobs (+instances, +destination), archive_jobs, studies (+patient)
            AuditService.log → audit_logs   (OPS_HISTORY_EXPORT, OPS_HISTORY_ARCHIVE_REVERIFY)
```

## Data sources (all real — no mock)
| Field | Source |
|---|---|
| Reverse-push job fields, per-instance results, retries | `DicomTransferJob` (+ `DicomTransferInstance`, `PacsDestination`) |
| Archive job fields, sizes, ratio, sha256, verification | `ArchiveJob` |
| Patient MRN (Patient ID) + Modality | RIS `Study` (joined by `studyId`, fallback `studyInstanceUid`) → `Patient.mrn` + `Study.modality` |
| Dashboard counts / byte sums | Prisma `count` / `groupBy(status)` / `aggregate(_sum)` over the two tables |

Neither job table stores Patient ID or Modality; they are resolved by a single batched `studyLookup`
per request (RIS knows the modality + patient; the job knows the study). Missing join → `null`
(never fabricated).

## RBAC (no new permission)
Endpoints carry no `@RequirePermissions` (the global guard is AND-combined and can't express OR).
The service enforces: **at least one** of `pacs.reverse-push.view` / `pacs.archive.view` (else 403);
reverse-push data requires `reverse-push.view`, archive data requires `archive.view`; super admin sees
both. The unified list/dashboard include only the caller's visible sources. **Patient MRN** (in rows,
detail, and CSV) is shown only to callers with `patient.view`; otherwise it is `null`/omitted. The
archive **path** is shown only to callers with `pacs.archive.manage`. Org isolation on every query.

## Non-mutating archive re-verify
`reverifyArchive` delegates to `ArchiveService.inspectIntegrity` — a read-only method that re-hashes
the stored archive (reusing Module 2's `verifyFile`: SHA-256 + gunzip + ZIP entry count) and compares
to the recorded `sha256`, but **writes no ArchiveJob/verification record and never modifies the archive
file**. The only write is an `OPS_HISTORY_ARCHIVE_REVERIFY` audit event. This is deliberately distinct
from Module 2's `verifyJob`, which updates the job row.

## CSV export
Server-side, four kinds (`reverse-push` / `archive` / `unified` / `summary`). Row cap **10,000**.
Every cell passes the shared formula-injection guard (`csv()`: leading `= + - @` → prefixed `'`).
First line is a provenance comment (`# Operations history export | kind=… | by <user> | <iso> | <n> rows`);
patient MRN column present only with `patient.view`. Every export writes an `OPS_HISTORY_EXPORT` audit
event (kind, row count, filters).

## No migration / data model
Module 4 adds **no** schema objects. It reads `dicom_transfer_jobs`, `dicom_transfer_instances`,
`archive_jobs`, `studies`, `patients`, `pacs_destinations` as they already exist. The `studies`
`search_tsv` GIN index is untouched.

## Security & protections (verified)
- Read-only data plane: no writes to job/instance/verification records; no DICOM/archive deletion,
  migration, or modification; verified archives never overwritten.
- No Orthanc/PG/Redis credentials or infra paths exposed to unauthorized users (archive path gated).
- No arbitrary filesystem access (re-verify reads only the recorded archive path via Module 2's helper).
- Org isolation + server-side RBAC on every route; patient identifiers gated by `patient.view`.
- All 8 services, nginx dynamic DNS, Phases 1–9 and PACS Ops Modules 1–3 preserved.

## Test-only fixtures
Two code-map roles `test_rp_only` (reverse-push.view + patient.view) and `test_ar_only`
(archive.view, no patient.view) + users `ophist_rp` / `ophist_ar` exist solely so per-source
visibility and patient redaction can be proven with real JWTs. They are assigned to no production user.

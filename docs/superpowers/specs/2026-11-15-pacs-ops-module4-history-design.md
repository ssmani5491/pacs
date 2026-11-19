# PACS Operations Module 4 — Transfer & Archive History Management (Design)

Status: **awaiting approval** · Date: 2026-11-15 · Project: `D:\GG Project\Pacs_13-11`

## Intent & why
Give PACS operators one place to review the full operational history of DICOM reverse-push transfers
(Module 1) and archive-compression jobs (Module 2): a unified dashboard with date summaries, powerful
server-side filtering/sorting/pagination, per-operation detail, and secure CSV export. Today that
history is split across two separate monitor pages with no combined view, no cross-cutting filters,
and no unified export. This is a **read-only reporting layer** — it adds visibility, not behaviour.

## Goals
- Reverse-push history: job-level list + instance-level detail (incl. per-instance errors), reusing
  `DicomTransferJob` / `DicomTransferInstance`.
- Archive history: job-level list + detail, reusing `ArchiveJob`; on-demand checksum verification via
  the existing archive verify path.
- Unified dashboard: totals (reverse-push jobs/success/failed/pending; archive jobs/verified/failed;
  original/compressed bytes; total savings), recent operations, and date summaries (today / 7d / 30d /
  custom), all from actual DB records with no duplicate counting.
- Advanced filtering (date range, operation type, destination, patient ID, study UID, modality,
  status, created-by, verification status), combinable, server-side paginated + sorted.
- CSV export for reverse-push / archive / unified / summaries — server-generated, formula-injection
  safe, permission-checked, org-isolated, size-limited, with export timestamp + exporting user +
  an audit event.
- New nav group "PACS Operations" grouping the four module pages.

## Non-goals / anti-goals
- **No** new transfer or archive engine; **no** writes to `DicomTransferJob`/`ArchiveJob`/instances.
- **No** deletion/migration/modification of DICOM or archives; **no** overwrite of verified archives.
- **No** new permission (per decision below); **no** migration (Approach A).
- **No** mock data anywhere; **no** patient identifiers to users lacking `patient.view`.
- Not a production-readiness certification — functional/integration verification on synthetic data.

## Constraints (from the brief + project rules)
Reuse existing tables/models/services; avoid unnecessary migrations (none here); preserve `search_tsv`
GIN; never reset PostgreSQL or delete volumes; never delete DICOM/archives; preserve all 8 services,
nginx dynamic DNS, Phases 1–9 and PACS Ops Modules 1–3. All access enforced server-side; org isolation.

## Approaches considered
- **A — Service-layer union over live queries (CHOSEN).** One `OperationsHistoryService` queries the
  two existing job tables per request (filtered by the caller's visible sources + org + filters),
  normalizes each to a common `OperationRow`, and for the unified list fetches `offset+limit` from
  each source at the DB level, merges, sorts, and slices (bounded). Dashboard uses `count`/`groupBy`
  aggregates — no row loading. **No migration, reuses models directly, per-source RBAC is trivial.**
- **B — Database UNION view.** Simpler pagination but needs a migration, must track both tables'
  columns, and per-source RBAC + the `Study` join are awkward in a view. Rejected: against
  "avoid unnecessary migrations / reuse models".
- **C — Materialized history table + sync job.** Duplicates data (spec says reuse / avoid duplicate
  counting), needs a migration + sync job, risks drift. Rejected: overkill for a reporting view.

## Key decisions (as decided)
1. **RBAC — per-source filtering, no new permission.** Reuse `pacs.reverse-push.view` and
   `pacs.archive.view`. Every history endpoint requires **at least one** of the two (custom check, since
   `@RequirePermissions` is AND-combined). The service returns only the source(s) the caller holds:
   reverse-push rows need `reverse-push.view`, archive rows need `archive.view`. Unified dashboard
   counts include only visible sources. A caller with neither → 403.
2. **Patient ID gated by `patient.view`.** Patient identifiers (and patient-linked fields) are included
   in rows, detail, and CSV **only** if the caller holds `patient.view`; otherwise those fields are
   omitted/redacted. Study UID and operational fields are always visible to a source viewer.
3. **Patient ID + Modality via `Study` join.** Neither job table stores them; the service left-joins
   RIS `Study` by `studyId` (fallback `studyInstanceUid`) to populate `patientId` + `modality`. Missing
   join → fields null (never fabricated).
4. **No duplicate counting.** Reverse-push and archive are distinct record sets counted independently;
   "total operations" = reverse-push jobs + archive jobs (disjoint). Bytes/savings come only from
   archive jobs. A study archived *and* pushed counts once in each source's totals, never merged.
5. **Export limits.** CSV capped (default 10,000 rows, same guard style as existing exports); every
   export writes an audit event (`OPS_HISTORY_EXPORT`) with user, filters, row count, timestamp; the
   file carries a provenance comment line and formula-injection-escaped cells.
6. **Org isolation** on every query (same guard/scoping as Modules 1–3); non-privileged cross-org → 403.

## The how (what the builder implements)

### Backend — `backend/src/pacs/`
- **`operations-history.service.ts`**
  - `visibleSources(user)` → `{ reversePush: bool, archive: bool }` from permissions (super_admin = both).
  - `normalizeTransferJob(job, study?)` and `normalizeArchiveJob(job, study?)` → common `OperationRow`
    (`{ type:'REVERSE_PUSH'|'ARCHIVE', id, studyInstanceUid, patientId?, modality?, status, createdBy,
    createdAt, startedAt, completedAt, summary:{…type-specific…} }`), patient fields gated.
  - `dashboard(user, range)` → aggregates via `count`/`groupBy` per visible source + date window
    (today/7d/30d/custom); bytes/savings via `aggregate(_sum)` over archive jobs; `recent` = latest N
    normalized rows across visible sources.
  - `list(user, filters, page)` → unified list: build per-source `where` (org + filters + patient/UID/
    modality via Study subquery), fetch `skip:0,take:offset+limit` ordered by the sort key from each
    visible source, merge, globally sort, slice to the page; return `{ rows, total, page, pageSize }`
    where `total` = sum of per-source filtered counts.
  - `listReversePush` / `listArchive` → single-source paginated lists (DB-level skip/take/order).
  - `reversePushDetail(user, jobId)` → job + instances (success/failed with error, retry history,
    destination details) — reuses existing data; archive-path/credentials never exposed to non-managers.
  - `archiveDetail(user, jobId)` → archive job fields (path shown only with `pacs.archive.manage`).
  - `reverifyArchive(user, jobId, ip)` → **non-mutating** on-demand integrity check: re-hash the
    archive file + re-check it extracts, compare against the stored `sha256`/`verified`, and return a
    pass/fail result **without modifying the archive file or any ArchiveJob / verification record**.
    (This is NOT Module 2's `verify`, which updates the job row — history must leave records untouched.)
    Writes only an `OPS_HISTORY_ARCHIVE_REVERIFY` audit event. Read-only hash/extract into a temp dir
    that is cleaned up.
  - `exportCsv(user, kind, filters, ip)` → kind ∈ reverse-push|archive|unified|summary; reuses the
    existing `csv()` formula-injection helper + row cap + audit.
  - Helpers: `serialize` (BigInt→Number), date-window resolver, sort-field allow-list.
- **`operations-history.controller.ts`** — `@Controller('pacs/operations/history')`:
  `GET /dashboard`, `GET /list`, `GET /reverse-push`, `GET /archive`,
  `GET /reverse-push/:jobId`, `GET /archive/:jobId`, `POST /archive/:jobId/verify` (manage),
  `GET /export` (`@Res`, CSV, `?kind=`). Custom "at least one source view" guard per route; patient
  gating inside the service.
- **`pacs.module.ts`** — register the new controller + service (providers/controllers/exports),
  alongside Modules 1–3. Inject `PrismaService`, `AuditService`, `ArchiveService` (for verify),
  existing RBAC/user context.

### Frontend — `frontend/src/`
- **`pages/OperationsHistory.tsx`** — tabs **DASHBOARD / UNIFIED / REVERSE PUSH / ARCHIVE**:
  - DASHBOARD: summary cards (reverse-push + archive totals, bytes, savings), date-range selector
    (Today/7d/30d/Custom), recent-operations list.
  - UNIFIED/REVERSE PUSH/ARCHIVE: filter panel (date range, type [unified], destination, patient ID,
    study UID, modality, status, created-by, verification status), history table with status badges,
    server-side pagination + column sort, row → detail.
  - Detail drawer/page per operation (reverse-push: instance-level success/fail + errors + retries;
    archive: sizes/ratio/savings/sha256/verify/extract + verify button).
  - Export controls (per current tab + filters) → CSV download with Bearer, like Storage/Audit export.
  - Polls on demand (refresh button); no mock data; patient column hidden when `!can('patient.view')`.
- **`App.tsx` + `Layout.tsx`** — new nav **group "PACS Operations"** containing Reverse Push Monitor,
  Archive Compression, Storage Management, **Transfer & Archive History** (`/pacs/operations/history`).
  (Existing PACS items may be regrouped under this heading without changing their routes.)

### Tests — `tests/operations-history.spec.ts` (Playwright, API + one UI flow)
Covers the brief's 16 checks: reverse-push/archive/unified accuracy **verified against direct DB
queries**, date filters, combined filters, pagination, sorting, CSV export + formula-injection guard,
cross-org isolation, permission enforcement (incl. per-source: reverse-push-only user sees no archive
rows and vice-versa; neither → 403), audit logging, a large-dataset page (synthetic), and regression
that Modules 1/2/3 endpoints still behave. Plus full Playwright + backend-unit regression.

## Verification plan
- Per-source + patient-gating RBAC proven (receptionist 403; single-source user sees only their source;
  non-`patient.view` user gets redacted patient fields).
- Dashboard/list/export totals **cross-checked against raw SQL counts/sums** (no duplicate counting).
- Critical protections re-verified before/after: Orthanc instance/study counts unchanged, signatures
  intact, `studies_search_tsv_idx` present, no volume/DICOM/archive touched, 8 services healthy.
- Screenshots of dashboard, unified history + filters, and a detail view.
- Docs: `PACS_OPERATIONS_HISTORY_{ARCHITECTURE,GUIDE,API,TEST_RESULTS,CHECKLIST}.md`; `PROGRESS.md`
  + memory updated.

## Left to the builder
Exact card/table layout and badge styling (match existing pages); default page size (propose 25) and
export cap (propose 10,000); sort-field allow-list contents; detail as drawer vs full page (propose
drawer, consistent with existing job-detail modals). None change scope.

## Scope
Module 4 only. Do **not** start Module 5 without explicit approval. Deliver a full completion report
with actual test results.

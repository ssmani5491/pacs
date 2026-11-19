# PACS Operational Integration — Architecture (PACS Operations Module 5)

## Overview
Module 5 makes PACS Operations Modules 1–4 behave as one platform. It is a **read-only composition
layer** that reuses the existing services and records — **no new engine, no migration, no new table,
no new Docker service, no new permission, no new production user.** It adds:

1. **Command Centre** — one dashboard aggregating reverse-push, archive, storage, service health, and
   alerts (`GET /api/pacs/operations/overview`).
2. **Per-study operational aggregate** — one study's transfer + archive history, integrity, and
   storage (`GET /api/pacs/operations/history/study/:uid`), surfaced from the RIS worklist.
3. **Exceptions Console** — a consolidated, classified view of operational failures with recovery via
   **existing** endpoints only (`GET /api/pacs/operations/exceptions`).
4. **Notification gap-closure** — one deduped notification on on-demand archive integrity-verification
   failure, via the existing `NotificationsService`.

**Strictly read-only over the data plane** (except the one additive notification emit): it never writes
to `DicomTransferJob`, `DicomTransferInstance`, or `ArchiveJob`; never deletes/migrates/modifies DICOM
or archives; never overwrites a verified archive; never resets PostgreSQL or touches a volume's
contents. Recovery actions in the Exceptions Console call the **existing** Module 1/2 and Phase 8
mutation endpoints — Module 5 adds no new mutation logic.

## Approach (chosen: service-layer composition)
A thin `OperationalIntegrationService` orchestrates the existing services for the Command Centre and
Exceptions Console; the per-study aggregate is added to Module 4's `OperationsHistoryService` to reuse
its RBAC OR-gate, org isolation, patient gating, and normalizers. Rejected alternatives: a materialized
"operations" table (adds a migration + a second source of truth) and a separate Module-5 engine service
(would duplicate Module 4's helpers).

## Components
```
Frontend                                 Backend (NestJS, existing 8 services)
──────────────────────────────────────   ─────────────────────────────────────────────────────────
OperationalCommandCentre.tsx ──HTTP──▶   OperationalIntegrationController  @Controller('pacs/operations')
  /pacs/operations/command-centre           GET overview      → OperationalIntegrationService.overview()
OperationsExceptions.tsx     ──HTTP──▶      GET exceptions    → OperationalIntegrationService.exceptions()
  /pacs/operations/exceptions                 (no @RequirePermissions: OR-gate enforced in service)
StudyOperationsDrawer.tsx    ──HTTP──▶   OperationsHistoryController (Module 4)
  (opened from Worklist.tsx)                 GET history/study/:uid → OperationsHistoryService.studyOperations()

OperationalIntegrationService composes (read-only):
  • OperationsHistoryService.dashboard()  (Module 4 — source of truth for transfer/archive totals + recent)
  • StorageService.dashboard()            (Module 3)
  • HealthService.latest()                (Phase 8 — 8-service app-level health)
  • AlertsService.openCount()/list()      (Phase 8)
Recovery (Exceptions Console) → EXISTING endpoints only:
  • /api/pacs/reverse-push/jobs/:id/retry|cancel      (pacs.reverse-push.manage)
  • /api/pacs/archive/jobs/:id/verify                 (pacs.archive.manage)
  • /api/system/alerts/:id/acknowledge                (system.alert.acknowledge)
Notification gap-closure → ArchiveService.verifyJob() emits one deduped HIGH notification on failure.
```

## RBAC model (server-authoritative; no new permission)
- Guards: global `JwtAuthGuard` (auth on every route) + global `PermissionsGuard` (**AND-combined**).
  The Command Centre/Exceptions/study routes carry **no** `@RequirePermissions` because they need
  **OR** semantics (any one of several view permissions); the OR-gate + per-section filtering is
  enforced in the service (the established Module 4 pattern).
- Per-section permissions (Command Centre tiles): transfer → `pacs.reverse-push.view`; archive →
  `pacs.archive.view`; storage → `pacs.storage.view`; health → `system.health.view`; alerts →
  `system.alert.view`. At least one is required (else 403).
- Recovery authorization (Exceptions Console): the existing `*.manage` / `system.alert.acknowledge`
  permission; `canRecover` reflects it; the server endpoint remains authoritative.
- Permissions resolve from the **code `ROLES` map** (`rbac/permissions.ts`), not the DB
  `role_permissions` table.

## Organization isolation
Every query is org-scoped (`orgScope(user)` / Module 4's `orgWhere`; super-admin unrestricted). The
per-study aggregate resolves the study, then org-checks it: a study in another org (or no org, for a
scoped user) returns **404** — never 403 — so the endpoint does not reveal that another org's study
exists.

## Patient information gating
Patient MRN is shown only to callers with `patient.view`, on every surface (Command Centre recent
strip, Exceptions rows, Study Operations). The archive path (infrastructure) stays gated by
`pacs.archive.manage` in Module 4's detail endpoints and is never emitted by Module 5.

## Data preservation
No migration, no schema change, no new table/column. `search_tsv` GIN index untouched. No new Docker
service (stays at 8). NGINX dynamic DNS (`resolver 127.0.0.11`) untouched. The only write Module 5 adds
is one additive notification row on integrity-verification failure.

## Related
Builds on Module 1 (reverse push), Module 2 (archive), Module 3 (storage), Module 4 (transfer & archive
history), Phase 8 (notifications/alerts/health). See the per-module docs.

# PACS Operations Module 5 — Operational Integration — Design

**Status:** DESIGN ONLY. Awaiting approval. No code written, no files modified, no migrations.
**Date:** 2026-11-15
**Author:** Claude (Opus 4.8)
**Approver:** project owner
**Depends on / reuses:** Modules 1 (Reverse Push), 2 (Archive Compression), 3 (Storage Management),
4 (Transfer & Archive History), Phase 8 (Notifications/Alerts/Health), Phase 3 (Worklist/Studies).

---

## 1. Intent and the "why"

Modules 1–4 each shipped a working page, but they stand alone. An operator who wants to answer
"is this study safely transferred and archived, and if not, what do I do?" today must visit four
different screens and correlate by hand. Module 5 makes the application behave as **one PACS
Operations platform**: a single command centre for operational visibility, a study-centric path
from the worklist into operations, a consolidated place to triage failures with safe recovery, and
operational notifications that are complete and de-duplicated.

Module 5 is deliberately **integration, not new machinery**. The recon below shows nearly every
capability it needs already has a safe, tested API. The work is composition (one dashboard, two new
read-only aggregates, cross-links) plus a small, carefully-deduped notification gap-closure — not a
new engine, service tier, or data plane.

## 2. Goals / non-goals / anti-goals

**Goals (the five brief areas, "Full integration suite" scope — approved):**
- **A. Unified Operations Command Centre dashboard** — one page aggregating reverse-push, archive,
  storage, transfer/archive failures, pending/running jobs, recent completions, service health, and
  active alerts, reusing existing APIs with no duplicate metrics.
- **B. Operational workflow integration** — from the RIS worklist, view a study's transfer + archive
  status and (when authorized) initiate a reverse push, then track it — all via existing endpoints.
- **C. Consolidated Exceptions console** — one view of failed/partial transfers, failed archives,
  integrity failures, interrupted jobs, storage alerts, and unavailable services; each with error
  detail, related study/job, timestamp, status, the *available* recovery action, the required
  permission, and audit — recovery reusing **only existing safe service methods**.
- **D. Operational notifications** — audit what already fires; close the genuine gaps (integrity
  failure in particular) via the existing `NotificationsService` with `dedupKey`, org-scoped, to the
  right roles. No new notification system.
- **E. Study-level operational visibility** — one authorized read-only aggregate per study: patient
  ID (gated by `patient.view`), study UID, modality, instance count, transfer history, archive
  history, latest integrity verification, and storage info where available — all from real DB/Orthanc
  records.

**Non-goals:**
- No new DICOM/transfer/compression/storage engine.
- No new Docker service (stay at 8).
- No new broad permission; reuse existing per-module permissions.
- No schema migration unless genuinely required (see §6 — the design requires **none**).
- No automatic transfer/compression/deletion. Every mutating action is explicit, user-initiated,
  authorized, and audited.

**Anti-goals (would make this a failure even if it "works"):**
- Duplicating metrics or queries Module 4 already owns (two sources of truth for the same number).
- Adding notification noise or re-notifying for the same event (dedup must hold).
- Any new retry/cancel/verify/restore *mutation logic* — Module 5 calls existing methods only.
- Any cross-org leak (a user seeing another org's studies/jobs/alerts) or patient-ID leak to users
  without `patient.view`.
- Introducing a permission that bypasses existing reverse-push/archive/storage restrictions.

## 3. Existing-architecture assessment (what I read)

| Capability | Where it already lives | Module 5 reuse |
|---|---|---|
| Unified read-only union of transfer+archive, per-source RBAC OR-gate, org isolation, patient-MRN gating, batched `studyLookup` (study→MRN+modality), dashboard totals/byte-sums/recent | `backend/src/pacs/operations-history.service.ts` (Module 4) | **Core reuse.** Command Centre dashboard (A) and study aggregate (E) extend this service. |
| Reverse-push monitor + jobs + **retry/cancel/pause/resume** | `reverse-push.controller.ts` / `.service.ts` (`/api/pacs/reverse-push/*`, `/api/pacs/destinations/*`) | Recovery actions (C); push launch (B) via existing `POST /reverse-push/jobs`. |
| Archive monitor + jobs + **verify/restore/cancel**; non-mutating `inspectIntegrity` | `archive.controller.ts` / `archive.service.ts` | Recovery actions (C); integrity status (E). |
| Storage dashboard + thresholds + alerts | `storage.service.ts` (`/api/pacs/storage/*`) | Storage tile (A); per-study/disk storage info (E). |
| Service health (real app-level, 8 services), ops dashboard metrics, **alerts list + acknowledge/resolve** | `ops.controller.ts` (`/api/system/*`), `health/metrics/alerts` services | Health tile + alerts tile (A); unavailable-service + storage-alert rows (C); ack/resolve (C). |
| Notifications: dedup (`dedupKey`), role/org fan-out, Socket.IO + 20s polling | `notifications.service.ts` (Phase 8) | Notification gap-closure (D); Command Centre consumes existing bell/stream. |
| Worklist row already exposes `studyInstanceUid` + `hasImages` (`!!orthancStudyId`) | `worklist.service.ts:85-87` | Study→operations link (B/E) needs **no worklist change**. |
| Reverse-push **completion/failure** notification (deduped `revpush-done:<jobId>`, org-scoped, pacs_admin) | `reverse-push.service.ts:389` | **Already wired** — D must not duplicate. |
| Archive **completion/failure** notification (deduped `archive-done:<jobId>`) | `archive.service.ts:410` | **Already wired** — D must not duplicate. |
| Storage threshold alert + notification (deduped per level/day) | `storage.service.ts:164-165` | **Already wired.** |

**Permission catalogue** (`rbac/permissions.ts`): `pacs.reverse-push.view/manage`,
`pacs.destination.manage`, `pacs.archive.view/manage`, `pacs.storage.view/manage`,
`system.health.view`, `system.dashboard.view`, `system.alert.view/acknowledge/resolve`,
`patient.view`, `worklist.view`, `study.view` — **all the permissions Module 5 needs already exist.**
Permissions resolve from the **code `ROLES` map**, not the DB `role_permissions` table
(jwt.strategy builds `req.user.permissions` from `ROLES[roleKey].permissions`).

**Guard model:** global `JwtAuthGuard` (auth on every route) + global `PermissionsGuard`
(**AND-combined**; a route with no `@RequirePermissions` still requires auth). Routes needing
**OR** semantics (view A *or* B) carry no decorator and enforce the OR-gate in the service — exactly
the Module 4 pattern Module 5 continues.

## 4. Current integration gaps (what's genuinely missing)

1. **No single operational home.** Four separate pages; no Command Centre. → Build A.
2. **No study→operations bridge.** Worklist exposes the UID but nothing links a study to its
   operational history, and there is **no per-study operations aggregate endpoint**. → Build E
   (one new read-only endpoint) + B (worklist cross-link + push modal wired to existing create-job).
3. **No consolidated exceptions view.** Failures are scattered across per-module job lists; no one
   place with recovery-action + required-permission + audit. → Build C (read-only aggregation of
   failed/partial/interrupted/alert/unavailable states; actions call existing endpoints).
4. **Notification completeness.** Transfer-done, archive-done, and storage-threshold notifications
   **already fire and are deduped.** The genuine remaining gap is **on-demand integrity-verification
   failure** (and confirming interrupted-job recovery surfaces somewhere). → Build D as a *narrow,
   honest* gap-closure, not a re-build. Doc will state precisely what was already wired.

## 5. Approaches considered

- **(A) Service-layer composition over existing APIs** — one new controller/service for the Command
  Centre + Exceptions aggregation; extend Module 4's service for the study aggregate; frontend ties
  it together; narrow notification gap-closure in the owning services. *No migration, no new service,
  reuses all tested machinery.* **CHOSEN.**
- **(B) Materialized "operations" table / denormalized dashboard cache** — precompute an integrated
  view. *Rejected:* adds a migration + a second source of truth + sync drift, directly against the
  reuse/avoid-migration/no-duplicate-metrics rules. Current read performance is already sub-200ms.
- **(C) New "operational-integration" engine service** — a fresh service owning its own study
  aggregate and composition. *Rejected for the study aggregate* (approved: extend Module 4 to reuse
  its RBAC/org/studyLookup directly, one source of truth). A thin Module-5 service is still used for
  the Command Centre + Exceptions *composition* only (it orchestrates existing services; it owns no
  new data).

**Approved refinements (from brainstorming):**
- Scope = **Full integration suite** (all five areas as distinct deliverables).
- Study aggregate (E) = **extend `OperationsHistoryService`** (`studyOperations` +
  `GET /pacs/operations/history/study/:uid`), reusing its OR-gate/org/patient-gating/studyLookup;
  **no new permission.**
- Notifications (D) = **close the gaps with dedup**; audit and honestly document already-wired vs
  newly-added; the only clear new emit is integrity-verification failure.

## 6. Design

### 6.1 Backend

**New thin service `operational-integration.service.ts` + `.controller.ts`** (`backend/src/pacs/`),
registered in `pacs.module.ts`. It owns **no new tables** and **no new mutation logic** — it composes
existing services. All routes under `@Controller('pacs/operations')`, no route-level
`@RequirePermissions` (OR-gate in service, Module-4 pattern), org-isolated, audited where they read
sensitive composites.

- `GET /pacs/operations/overview` → **Command Centre (A).** Composes: Module 4 `dashboard()`
  (transfer+archive totals, byte sums, recent), storage `dashboard()` (disk/capacity, highest crossed
  threshold), `health.latest()` (8-service status), `alerts.openCount()` + top open alerts, and
  pending/running job counts. Each sub-block is included **only if the caller can see that source**
  (reuses `visibleSources` + `system.health.view`/`system.alert.view` checks). No metric is
  recomputed that Module 4/Storage already computes — it calls their methods.
- `GET /pacs/operations/exceptions` → **Exceptions console (C).** Read-only union of: reverse-push
  jobs in `FAILED`/`PARTIALLY_COMPLETED` (+ interrupted = `RUNNING` past a staleness window, matching
  the existing recovery-reconciliation notion), archive jobs in `FAILED` (+ `verified=false` where
  integrity was attempted), open storage alerts, and unhealthy services from `health.latest()`.
  Each row is normalized to: `{ source, id, studyInstanceUid?, patientMrn? (gated), modality?,
  status, errorDetail, timestamp, recovery: { action, endpoint, requiredPermission } | null,
  canRecover (per caller perms) }`. **The row names the existing endpoint**; the console never
  implements recovery itself.
- Study aggregate (E) lives in **Module 4's service** (approved): add
  `studyOperations(user, studyUid)` + `GET /pacs/operations/history/study/:uid`. Returns
  `{ study: { studyInstanceUid, patientMrn? (gated), modality, instanceCount, orthancStudyId? },
  transfers: OperationRow[], archives: OperationRow[], latestIntegrity: { verified, verifiedAt,
  sha256?, detail } | null, storage: { studyBytes? } | null }`. Reuses `requireAnySource`,
  `orgWhere`/`assertOrg`, `canSeePatient`, `studyLookup`. Instance count + Orthanc bytes via existing
  `OrthancService.getStudyStatistics()` (already added in Module 3). **No new permission.**

**Recovery actions (C):** none are new endpoints. The Exceptions console's "recover" buttons POST to
the **existing** `reverse-push/jobs/:id/retry|cancel`, `archive/jobs/:id/verify|restore|cancel`, and
`system/alerts/:id/acknowledge|resolve`, each already guarded by its existing `*.manage` /
`system.alert.*` permission and already audited. Module 5 adds **no retry semantics** — it exposes
only what each module already deemed safe. "Never retry automatically unless existing implementation
supports safe retry" is honored: only reverse-push and archive, which have explicit tested retry/verify
paths, expose those actions; everything else is view-only or ack/resolve.

**Notifications (D):** audit confirms transfer-done, archive-done, storage-threshold are **already
deduped + org-scoped**. Module 5 adds, in the **owning** service (`archive.service.ts`), a deduped
notification on **on-demand integrity-verification failure** (`dedupKey: integrity-fail:<jobId>:<day>`,
`pacs_admin`, org-scoped, `HIGH`) — via the existing `NotificationsService.create`, no new system.
Each new emit gets a dedup test. The doc will tabulate already-wired vs newly-added. (If the audit
during implementation shows integrity failure *is* already covered, D becomes a no-op and is reported
as such — no invented work.)

### 6.2 Frontend

- **New page `OperationalCommandCentre.tsx`** (`/pacs/operations/command-centre`) — summary tiles
  (transfer, archive, storage, health, alerts, pending/running), recent-operations strip, top open
  alerts with ack/resolve (perm-gated), and deep-links into the four module pages. Polls (reusing the
  existing polling pattern) + consumes the existing notification stream. Tiles render only for sources
  the user can see.
- **New page `OperationsExceptions.tsx`** (`/pacs/operations/exceptions`) — the Exceptions console:
  filterable table of exception rows, each with error detail, related study/job link, and a recovery
  button shown **only when `canRecover`**; clicking calls the existing endpoint and refreshes.
- **Study→operations bridge (B/E):** add an "Operations" affordance on the worklist row / study
  context that opens a **Study Operations drawer** (reusing the Module 4 `OperationsHistory` drawer
  styling, `.modal-bg`) backed by `GET .../history/study/:uid`; from there, an authorized user can
  launch a reverse push (existing create-job modal) and track it. Patient column/section hidden
  without `patient.view`.
- **Nav:** the existing **"PACS Operations"** group gains **Operations Command Centre** (first) and
  **Exceptions**; the four existing entries remain. (`Layout.tsx`.)
- `App.tsx`: two new routes + the study-operations drawer wiring.

### 6.3 RBAC & security

- **No new permission.** Command Centre/Exceptions require **any** of the relevant view perms
  (OR-gate in service); each tile/row is filtered to what the caller may see. Recovery buttons gate
  on the existing `*.manage` / `system.alert.*` perms (server is authoritative; UI gating is a
  convenience).
- **Org isolation** on every query (`orgWhere`/`assertOrg`, super-admin unrestricted) — same as
  Module 4.
- **Patient MRN** shown only with `patient.view`, everywhere (Command Centre recent strip, Exceptions
  rows, Study Operations).
- **No Orthanc credentials / infra paths** exposed; archive path stays gated by `pacs.archive.manage`
  (existing rule). Health tile reports status, not secrets.
- **Audit:** recovery actions are audited by the existing endpoints; the new composite reads that
  expose study/patient composites log an `OPS_INTEGRATION_*` view/export event consistent with Module
  4's auditing of sensitive reads/exports.

## 7. Database changes

**None.** No new table, no column, no migration. The design is pure composition over existing tables
(`DicomTransferJob`/`Instance`, `ArchiveJob`, `StorageSnapshot`, `system_alerts`,
`service_health_checks`, `Study`/`Patient`, `notifications`). `search_tsv` GIN untouched. This
satisfies "additive migrations only, and only when genuinely required" — it is not required.

## 8. Operational workflows

1. **Operator opens Command Centre** → sees transfer/archive/storage/health/alerts at a glance; clicks
   a tile to drill into the owning module page.
2. **Triage a failure** → Exceptions console lists it with error detail + related study; operator with
   the right `*.manage` perm clicks Retry (reverse-push) / Verify or Restore (archive) / Acknowledge or
   Resolve (alert) — each an existing, audited endpoint. No auto-retry.
3. **Study-centric** → from the worklist, open Study Operations drawer: transfer history, archive
   history, latest integrity, instance/storage info; if authorized, launch a reverse push (existing
   modal) and watch it progress. Patient ID shown only with `patient.view`.
4. **Notification** → on integrity failure (new) / transfer or archive failure (existing), `pacs_admin`
   gets one deduped, org-scoped in-app + socket notification linking to the relevant page.

## 9. Test plan (per brief §6; executed tests will be reported with real results, unexecuted marked NOT TESTED)

- **Dashboard accuracy** — Command Centre numbers EXACT-match the owning APIs (Module 4 dashboard,
  storage dashboard, alerts count, health) and raw SQL; no double counting.
- **Study-level visibility** — `study/:uid` returns correct transfer/archive/integrity/instance/storage
  for a seeded study; MRN present with `patient.view`, absent without.
- **Reverse-push & archive integration** — push launched from the study drawer creates a real job
  (existing engine) and is tracked; archive status surfaces correctly.
- **Failure/exception visibility** — seeded FAILED/PARTIAL transfer, FAILED archive, open storage
  alert, and an unhealthy service each appear as exception rows with correct recovery action +
  required permission.
- **Retry/recovery authorization** — recovery button hidden/403 without the `*.manage`/`alert.*`
  perm; allowed with it; action audited; **no new mutation path** (asserts it calls the existing
  endpoint).
- **Org isolation** — cross-org user sees none of another org's overview/exceptions/study data (403 /
  empty).
- **RBAC OR-gate** — view with only reverse-push.view shows transfer blocks only; only archive.view
  shows archive blocks only.
- **Patient-ID restriction** — MRN redacted without `patient.view` across all three new surfaces.
- **Audit events** — composite reads + recovery actions recorded.
- **Notification dedup** — integrity-failure emits exactly once per job/day; existing transfer/archive
  notifications still single-fire (regression).
- **Modules 1–4 regression** — all existing endpoints still 200; Playwright full suite; backend unit.
- **Docker health** — 8 services healthy; **no 9th service**.
- **NGINX dynamic DNS** — backend recreate → new IP, 0× 502 (resolver 127.0.0.11 preserved).
- **Data preservation** — Orthanc 2489/10 unchanged, archives untouched, signatures intact, GIN
  present, no volume/DB reset.

## 10. Risks & limitations

- **Metric drift risk** — mitigated by calling the owning services' methods, never re-deriving numbers.
- **Notification over-reach** — mitigated by auditing what's already wired and adding only the one
  genuine gap with a dedup key + test; if nothing is missing, D is reported as a no-op.
- **Interrupted-job definition** — "interrupted" = `RUNNING` beyond a staleness window; this is a
  heuristic surfaced read-only (the actual recovery is the existing scheduler reconciliation), not a
  new state machine.
- **Scale** — composition inherits Module 4's pagination + 10k export cap; multi-million-row stress
  NOT TESTED (will be marked so).
- **Scope honesty** — Module 5 is integration; it adds no new transfer/compression/storage capability
  and cannot free space, delete, or auto-recover anything.

## 11. Exact files expected to change (implementation phase — not now)

**New:**
- `backend/src/pacs/operational-integration.service.ts` (Command Centre + Exceptions composition)
- `backend/src/pacs/operational-integration.controller.ts` (`/api/pacs/operations/overview`,
  `/api/pacs/operations/exceptions`)
- `frontend/src/pages/OperationalCommandCentre.tsx`
- `frontend/src/pages/OperationsExceptions.tsx`
- `tests/operational-integration.spec.ts`
- `docs/PACS_OPERATIONAL_INTEGRATION_{ARCHITECTURE,GUIDE,API,TEST_RESULTS,CHECKLIST}.md`
- `docs/superpowers/plans/2026-11-15-pacs-ops-module5-integration.md` (the plan, next step)

**Modified (additive only):**
- `backend/src/pacs/operations-history.service.ts` + `operations-history.controller.ts`
  (add `studyOperations` + `GET .../history/study/:uid`)
- `backend/src/pacs/archive.service.ts` (one deduped integrity-failure notification, **if** the audit
  confirms it's missing)
- `backend/src/pacs/pacs.module.ts` (register the new controller/service)
- `frontend/src/App.tsx` (2 routes + study-operations drawer wiring)
- `frontend/src/components/Layout.tsx` (2 new nav entries in "PACS Operations")
- `docs/PROGRESS.md` (**only after implementation is approved & completed**, per brief §7)

**No migration file. No docker-compose service. No nginx change required** (new routes are under the
already-proxied `/api` prefix).

## 12. Confirmation: Modules 1–4 remain untouched

- Modules 1–3 service/controller **behavior** is unchanged; Module 5 only *calls* their existing
  methods/endpoints. (Archive gets one additive notification emit *only if* integrity-failure is
  confirmed unwired — no behavior change to compression, verify, or restore.)
- Module 4 gains an **additive** read-only method + route; its existing union/dashboard/export are
  unchanged.
- No existing table, migration, DICOM instance, signed report, archive file, DICOM UID, or
  `studies_search_tsv_idx` GIN index is modified. Eight-service architecture and NGINX dynamic DNS
  preserved.

---

**Next step on approval:** invoke `superpowers:writing-plans` to produce the task-by-task
implementation plan from this design. **No implementation, no migrations, no module beyond 5 until you
approve.**

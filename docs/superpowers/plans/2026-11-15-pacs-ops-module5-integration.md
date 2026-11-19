# PACS Operations Module 5 — Operational Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Modules 1–4 behave as one PACS Operations platform via a permission-aware Command Centre dashboard, a consolidated Exceptions console (recovery through existing APIs only), a per-study operational-visibility aggregate, and a narrow, verified notification gap-closure — all read-mostly, reusing existing services, with no new migration or Docker service.

**Architecture:** A thin composition service (`operational-integration.*`) orchestrates existing Module 1–4 + Phase 8 services for the Command Centre (A) and Exceptions (C); the per-study aggregate (E) is added to Module 4's `OperationsHistoryService` to reuse its RBAC/org/patient-gating/studyLookup; the worklist→operations bridge (B) uses the existing create-job API. Notifications (D) are verified first, then only genuine gaps closed with dedup in the owning service. No new table, no new permission, no new container.

**Tech Stack:** NestJS 10, Prisma 5.22, Node 24, React/Vite/TS, Playwright 1.49.1, Jest. Throwaway `node:24-alpine` container for tsc/jest.

**Spec:** `docs/superpowers/specs/2026-11-15-pacs-ops-module5-integration-design.md`

## Global Constraints

- **No database migration. No new Docker service (stay at 8). No new permission** — reuse existing `pacs.*`, `system.*`, `patient.view`, `worklist.view`, `study.view`.
- **No new mutation logic.** Recovery actions call only existing endpoints: `reverse-push/jobs/:id/retry|cancel`, `archive/jobs/:id/verify|restore|cancel`, `system/alerts/:id/acknowledge|resolve`. Module 5 never retries automatically.
- **Permissions resolve from the code `ROLES` map** (`rbac/permissions.ts`), not DB `role_permissions`; jwt.strategy builds `req.user.permissions` from `ROLES[roleKey].permissions`. Any test-only role needs a code-map entry + a redeploy.
- **Guard model:** global `JwtAuthGuard` + global `PermissionsGuard` (AND-combined). OR-gate routes carry **no** `@RequirePermissions` and enforce the OR in the service (Module 4 pattern).
- **Org isolation on every query** (`orgWhere`/`assertOrg`; super-admin unrestricted). **Patient MRN only with `patient.view`** on every surface. **Archive path only with `pacs.archive.manage`.** Never expose Orthanc credentials or infra paths.
- **Preserve:** all clinical data, DICOM instances, archive files, signed reports, signatures, DB volumes, `studies_search_tsv_idx` GIN index, NGINX resolver `127.0.0.11` + dynamic upstreams.
- **Real data only.** Report actual test results; mark unexecuted tests **NOT TESTED**; never claim an unexecuted test passed.
- **Module 5 only.** No enhancements beyond this plan.

## Review Focus

- **Cross-org leak via the study aggregate** — a user requests `study/:uid` for a study in another org; expected: 403 (or empty), never another org's transfer/archive/patient data. (Test in Task 3.)
- **Patient-MRN leak without `patient.view`** — Command Centre recent strip, Exceptions rows, and study aggregate must all redact MRN for a caller lacking `patient.view`, not just the list endpoints. (Tests in Tasks 2, 3, 4.)
- **Recovery action privilege escalation** — the Exceptions console must not expose or succeed at a recovery call for a caller lacking the specific `*.manage`/`alert.*` permission; the server (existing endpoint) is authoritative, and the console must not wrap it in anything that bypasses its guard. (Test in Task 4.)
- **Interrupted-job false positives** — the heuristic "RUNNING past staleness window = interrupted" must be clearly separated from confirmed `FAILED`/`PARTIALLY_COMPLETED`, labeled as heuristic, and must not mutate anything. (Test in Task 4.)
- **Notification double-fire** — the integrity-failure emit (if added) must dedup per job/day, and existing transfer-done/archive-done/storage notifications must still single-fire (regression). (Test in Task 5.)

---

## File Structure

**New (backend):** `backend/src/pacs/operational-integration.service.ts`, `operational-integration.controller.ts`.
**New (frontend):** `frontend/src/pages/OperationalCommandCentre.tsx`, `frontend/src/pages/OperationsExceptions.tsx`.
**New (tests/docs):** `tests/operational-integration.spec.ts`, `docs/PACS_OPERATIONAL_INTEGRATION_{ARCHITECTURE,GUIDE,API,TEST_RESULTS,CHECKLIST}.md`.
**Modified (additive):** `operations-history.service.ts` + `operations-history.controller.ts` (study aggregate), `archive.service.ts` (one notification, only if verified missing), `pacs.module.ts` (register), `frontend/src/App.tsx` (routes + drawer), `frontend/src/components/Layout.tsx` (nav), `docs/PROGRESS.md` (after completion only).

**Deploy/verify note:** the only fast test harness is API-level Playwright + backend Jest against the deployed stack. Implement backend Tasks 2–5 with spec tests written first (RED = 404/missing on undeployed routes), deploy once, drive to GREEN. Run `tsc --noEmit` (throwaway container) after each backend edit so a mid-task type error surfaces immediately.

---

## Task 1: Verify existing operational notifications (brief item 5) — investigation + ledgered finding

**Files:**
- Read only: `backend/src/pacs/reverse-push.service.ts`, `archive.service.ts`, `storage.service.ts`, `notifications/notifications.service.ts`.
- No code change in this task unless a genuine gap is found (then Task 5 makes the single additive change).

**Interfaces:**
- Consumes: existing `NotificationsService.create({ category, priority, roleKey, organizationId?, dedupKey, title, body, link, studyId? })`.
- Produces: a documented table (already-wired vs missing) consumed by Task 5 and the docs.

- [ ] **Step 1: Enumerate every operational notification emit.** Grep `notifications.create` / `alerts.raise` across `backend/src/pacs`. Record for each: trigger event, `dedupKey`, roleKey, org-scoping, priority. Known from design recon: reverse-push done/failed (`revpush-done:<jobId>`), archive done/failed (`archive-done:<jobId>`), storage threshold (`storage-alert:<level>:<day>`) — all already deduped + org-scoped.
- [ ] **Step 2: Identify the genuine gap.** Determine whether **on-demand integrity-verification failure** (archive `verifyJob` failing, and the Module 4 `inspectIntegrity` re-verify failing) emits a notification today. Record the verdict.
- [ ] **Step 3: Ledger the finding** as `Task 1: already-wired = {revpush-done, archive-done, storage-alert}; gap = <integrity-failure: present|absent>`. If absent → Task 5 adds exactly one deduped emit. If present → Task 5 is a no-op and the docs report D as "no new notification needed."

**Completion:** a ledger line stating the verified already-wired set and the single gap verdict. No test (investigation task); its output gates Task 5's scope.

---

## Task 2: Command Centre overview endpoint (brief items 1) — permission-aware aggregation

**Files:**
- Create: `backend/src/pacs/operational-integration.service.ts`, `backend/src/pacs/operational-integration.controller.ts`
- Modify: `backend/src/pacs/pacs.module.ts` (register controller + provider)
- Test: `tests/operational-integration.spec.ts` (overview cases)

**Interfaces:**
- Consumes (existing, signatures confirmed): `OperationsHistoryService.dashboard(u, q)` → `{ reversePush|null, archive|null, recent[], ... }` and `.visibleSources(u)` → `{reversePush, archive}`; `StorageService.dashboard(u)`; `MetricsService.dashboard(u)`; `HealthService.latest()` → `ServiceHealth[]` (`{service,status,responseMs,detail}`); `AlertsService.openCount(u)` → `{open, critical}` and `.list(u, q)`.
- Produces: `OperationalIntegrationService.overview(u)` and `GET /api/pacs/operations/overview`.

- [ ] **Step 1: Write the failing test** `tests/operational-integration.spec.ts` → "overview: permission-aware tiles". As admin, `GET /pacs/operations/overview` returns `{ transfer, archive, storage, health, alerts, pending, recent }` where numbers EXACT-match the owning APIs (assert `transfer.total` === Module 4 dashboard `reversePush.total`; `alerts.open` === `/system/alerts/summary` open). As `test_rp_only` (reverse-push.view only), assert `storage`/`health` tiles are `null`/omitted and `archive` is `null`, while `transfer` is present.
- [ ] **Step 2: Run test, verify it fails** — `cd tests && ./node_modules/.bin/playwright test operational-integration -g "overview"`. Expected: FAIL (route 404 before deploy).
- [ ] **Step 3: Implement `overview(u: AuthUser)`** in `operational-integration.service.ts`. Inject `OperationsHistoryService`, `StorageService`, `MetricsService`, `HealthService`, `AlertsService`, `AuditService`. Build each tile **only if the caller can see that source**: `transfer`/`archive`/`recent` from `operationsHistory.dashboard` + `visibleSources`; `storage` only if `u.isSuperAdmin || permissions.includes(PACS_STORAGE_VIEW)`; `health` only if `SYSTEM_HEALTH_VIEW`; `alerts` only if `SYSTEM_ALERT_VIEW`. Recompute no metric already computed by an owning service — call its method. `pending` derives from the dashboard status buckets (no new query). Require at least one visible source else `ForbiddenException`. Add `@Controller('pacs/operations')` with `GET overview` (no `@RequirePermissions`; OR-gate in service). Register in `pacs.module.ts`.
- [ ] **Step 4: Run test, verify it passes** (after single batch deploy at Task 5; `tsc --noEmit` now). Expected: `tsc` clean now; GREEN after deploy.
- [ ] **Step 5: Ledger** `Task 2: overview endpoint added, permission-aware tiles, no recomputed metrics`.

---

## Task 3: Per-study operational aggregate (brief items 2, 3) — org-isolated, patient-gated

**Files:**
- Modify: `backend/src/pacs/operations-history.service.ts` (add `studyOperations`), `operations-history.controller.ts` (add route)
- Test: `tests/operational-integration.spec.ts` (study aggregate cases)

**Interfaces:**
- Consumes (existing in the same service): `requireAnySource(u)`, `orgWhere(u)`, `assertOrg(u, orgId)`, `canSeePatient(u)`; Prisma `dicomTransferJob`/`archiveJob`; `OrthancService.getStudyStatistics(orthancStudyId)` (NOTE: takes the Orthanc study id, not the DICOM UID — resolve `Study.orthancStudyId` first).
- Produces: `OperationsHistoryService.studyOperations(u: AuthUser, studyUid: string)` → `{ study: { studyInstanceUid, patientMrn|null, modality, instanceCount, orthancStudyId|null }, transfers: OperationRow[], archives: OperationRow[], latestIntegrity: {verified, verifiedAt, sha256|null, detail}|null, storage: {studyBytes}|null }`; `GET /api/pacs/operations/history/study/:uid`.

- [ ] **Step 1: Write the failing test** → "study aggregate: org-isolated + patient-gated". Seed/choose a GGH study with ≥1 transfer and ≥1 archive job. (a) admin `GET .../history/study/:uid` → transfers + archives arrays correct, `study.patientMrn` present, `study.modality` set. (b) `test_ar_only` (archive.view, **no** patient.view) → `patientMrn` is `null`, `transfers` empty (no reverse-push.view), `archives` present. (c) cross-org user → 403. (d) unknown UID → 404.
- [ ] **Step 2: Run test, verify it fails** — `-g "study aggregate"`. Expected: FAIL (route 404).
- [ ] **Step 3: Implement `studyOperations`.** OR-gate via `requireAnySource`. Fetch the `Study` by `studyInstanceUid` with `select: { id, studyInstanceUid, modality, orthancStudyId, organizationId, patient: { select: { mrn } } }`; if none → `NotFoundException`; `assertOrg(u, study.organizationId)`. Query `dicomTransferJob` (only if `reversePush` visible) and `archiveJob` (only if `archive` visible) by `{ studyInstanceUid, ...orgWhere(u) }`, normalize via existing `normalizeTransferJob`/`normalizeArchiveJob` (respect `canSeePatient`). `latestIntegrity` = latest archive job's `{verified, verifiedAt, sha256, verifyDetail}` (sha256/path stay manage-gated). `instanceCount` + `storage.studyBytes` from `orthanc.getStudyStatistics(study.orthancStudyId)` **only if `orthancStudyId` present**, else `null` (never fabricate). Inject `OrthancService` (same DI pattern `storage.service.ts` already uses in this module). Add the controller route **before** nothing ambiguous (distinct literal path `study/:uid`). Audit an `OPS_INTEGRATION_STUDY_VIEW` event.
- [ ] **Step 4: Run test, verify it passes** (post-deploy; `tsc --noEmit` now).
- [ ] **Step 5: Ledger** `Task 3: studyOperations added to Module 4 service; org-isolated, patient-gated, no new permission`.

---

## Task 4: Exceptions console endpoint (brief items 4, 6) — existing recovery APIs + heuristic labeling

**Files:**
- Modify: `backend/src/pacs/operational-integration.service.ts` (add `exceptions`), `operational-integration.controller.ts` (add route)
- Test: `tests/operational-integration.spec.ts` (exceptions cases)

**Interfaces:**
- Consumes: Prisma `dicomTransferJob`/`archiveJob`; `AlertsService.list(u, q)`; `HealthService.latest()`; existing recovery endpoints (named in each row, not called here).
- Produces: `OperationalIntegrationService.exceptions(u: AuthUser)` → `{ data: ExceptionRow[] }` where `ExceptionRow = { source, id, studyInstanceUid?, patientMrn?|null, modality?, status, kind: 'FAILED'|'PARTIAL'|'INTERRUPTED_HEURISTIC'|'INTEGRITY_FAILED'|'STORAGE_ALERT'|'SERVICE_DOWN', errorDetail, timestamp, recovery: { action, endpoint, requiredPermission }|null, canRecover: boolean }`; `GET /api/pacs/operations/exceptions`.

- [ ] **Step 1: Write the failing test** → "exceptions: recovery-gated + heuristic labeled". Seed a FAILED transfer, a FAILED archive, and (if feasible) ensure an open storage alert / a known service state. Assert: (a) each seeded failure appears with correct `kind`, `errorDetail`, related `studyInstanceUid`, and a `recovery.endpoint` pointing at the **existing** path (e.g. `/api/pacs/reverse-push/jobs/:id/retry`) + correct `requiredPermission`. (b) An interrupted (RUNNING-past-window) job, if present, has `kind: 'INTERRUPTED_HEURISTIC'` and is **not** labeled FAILED. (c) As a view-only user (no `*.manage`), `canRecover` is `false` for every row; as a manager, `true` for the matching source. (d) MRN redacted without `patient.view`.
- [ ] **Step 2: Run test, verify it fails** — `-g "exceptions"`. Expected: FAIL (route 404).
- [ ] **Step 3: Implement `exceptions(u)`.** OR-gate. Read-only union over visible sources: transfer jobs in `{ status: { in: ['FAILED','PARTIALLY_COMPLETED'] } }` (+ `RUNNING` with `startedAt` older than a staleness window `STALE_MS` → `INTERRUPTED_HEURISTIC`, clearly separated, never mutated); archive jobs in `{ status: 'FAILED' }` and completed-but-`verified=false` → `INTEGRITY_FAILED`; open storage alerts via `alerts.list` filtered to `source STORAGE`; unhealthy services from `health.latest()` where `status !== 'HEALTHY'` (only if `SYSTEM_HEALTH_VIEW`). All org-isolated; MRN via `canSeePatient`. For each row set `recovery` to the existing endpoint + its `requiredPermission` (retry/cancel → `pacs.reverse-push.manage`; verify/restore/cancel → `pacs.archive.manage`; ack/resolve → `system.alert.acknowledge`/`resolve`; service-down → `recovery: null`). `canRecover` = caller holds that permission. The service **does not call** any recovery method. Add `GET exceptions` route. Audit `OPS_INTEGRATION_EXCEPTIONS_VIEW`.
- [ ] **Step 4: Run test, verify it passes** (post-deploy; `tsc --noEmit` now).
- [ ] **Step 5: Ledger** `Task 4: exceptions console added, recovery via existing endpoints only, interrupted = heuristic (non-mutating), canRecover per-perm`.

---

## Task 5: Notification gap-closure (brief item 5) — conditional, deduped, single batch deploy

**Files:**
- Modify (only if Task 1 found the gap): `backend/src/pacs/archive.service.ts` (one deduped integrity-failure `notifications.create`)
- Test: `tests/operational-integration.spec.ts` (notification cases)

**Interfaces:**
- Consumes: existing `NotificationsService.create(...)` with `dedupKey`.
- Produces: at most one new deduped emit (`dedupKey: integrity-fail:<jobId>:<day>`, `roleKey: 'pacs_admin'`, org-scoped, `priority: 'HIGH'`, `link: '/pacs/archive'`). If Task 1 found it already wired, this task adds **no code** and records a no-op.

- [ ] **Step 1: Write the failing test** → "integrity failure notifies once (deduped)". Trigger an integrity failure (archive verify/re-verify on a job whose stored hash won't match, using a safe synthetic job — never corrupt a real verified archive). Assert exactly one `pacs_admin` notification with the integrity dedupKey; a second trigger same day adds none. Regression: assert transfer-done and archive-done notifications still single-fire.
- [ ] **Step 2: Run test, verify it fails** (if gap real) — Expected: FAIL (no integrity notification). If Task 1 proved it already wired, convert this to a regression assertion that it fires once and ledger the no-op.
- [ ] **Step 3: Implement the single deduped emit** in `archive.service.ts` at the integrity-failure path, via existing `NotificationsService.create`. No new notification system, no new table.
- [ ] **Step 4: Deploy once** (`docker compose build backend frontend && docker compose up -d`), then run the full `operational-integration.spec.ts` to GREEN (Tasks 2–5 routes live). Expected: all PASS.
- [ ] **Step 5: Ledger** `Task 5: integrity-failure notification <added|already-present, no-op>; dedup verified; existing notifications single-fire (regression)`.

---

## Task 6: Frontend — Command Centre, Exceptions, study-operations bridge, nav (brief items 1, 2, 4, 6)

**Files:**
- Create: `frontend/src/pages/OperationalCommandCentre.tsx`, `frontend/src/pages/OperationsExceptions.tsx`
- Modify: `frontend/src/App.tsx` (2 routes + study-operations drawer), `frontend/src/components/Layout.tsx` (2 nav entries under "PACS Operations")
- Test: `tests/operational-integration.spec.ts` (UI smoke cases, reuse viewer.spec login pattern)

**Interfaces:**
- Consumes: `api`, `qs`, `getAccess`, `useAuth().can` from `../lib/api`/`../lib/auth`; the three new endpoints; the existing reverse-push create-job modal/API for push launch; `.modal-bg` drawer styling (Module 4 pattern).
- Produces: two pages + routes `/pacs/operations/command-centre`, `/pacs/operations/exceptions`, and a Study Operations drawer opened from the worklist/study context.

- [ ] **Step 1: Write the failing UI test** → "command centre + exceptions render; recovery gated". Login (copy `viewer.spec.ts` pattern: `getByRole('textbox').first().fill('admin')` + `input[type=password]` + Sign in + `waitForURL`), navigate to `/pacs/operations/command-centre`, assert tiles render; navigate to `/pacs/operations/exceptions`, assert the table renders and a recovery button is present for a manager (and absent/disabled for a view-only user if a second login is feasible).
- [ ] **Step 2: Run test, verify it fails** — Expected: FAIL (routes/pages absent).
- [ ] **Step 3: Implement the pages.** Command Centre: tiles for transfer/archive/storage/health/alerts/pending + recent strip + top open alerts with ack/resolve buttons gated by `can('system.alert.acknowledge'|'resolve')`; each tile rendered only when its data is present (server already omits by permission); deep-links into the four module pages; poll ~15s (existing pattern). Exceptions: filterable table of exception rows; a recovery button per row shown only when `row.canRecover`, which POSTs to `row.recovery.endpoint` then refreshes; `INTERRUPTED_HEURISTIC` rows visually distinguished from confirmed failures. Study Operations drawer: `.modal-bg`, backed by `GET .../history/study/:uid`, with transfer/archive/integrity/instance/storage sections (patient section hidden without `can('patient.view')`) and an authorized "Push study" action using the existing create-job modal. Add routes in `App.tsx`; add **Operations Command Centre** (first) + **Exceptions** to the "PACS Operations" nav group in `Layout.tsx` (keep the four existing entries).
- [ ] **Step 4: Build + deploy frontend, run UI test to GREEN.** `docker compose build frontend && docker compose up -d frontend`. Expected: PASS; bundle contains the new headings.
- [ ] **Step 5: Ledger** `Task 6: Command Centre + Exceptions pages + study drawer + nav; recovery/patient gated client-side (server authoritative)`.

---

## Task 7: Full regression, protections, screenshots, docs (brief items 7, 8)

**Files:**
- Create: `docs/PACS_OPERATIONAL_INTEGRATION_{ARCHITECTURE,GUIDE,API,TEST_RESULTS,CHECKLIST}.md`
- Modify: `docs/PROGRESS.md` (Module 5 section — after implementation complete)
- Test: run the full existing Playwright suite + backend Jest; capture screenshots.

**Interfaces:**
- Consumes: the whole deployed stack.
- Produces: verified regression + protection evidence + 5 docs + PROGRESS update.

- [ ] **Step 1: Full Playwright regression** — `cd tests && ./node_modules/.bin/playwright test`. Expected: all existing specs (viewer, reporting, ops, reverse-push, archive, storage, operations-history) + the new `operational-integration.spec.ts` PASS. Record exact counts. Any failure → systematic-debugging, not a report edit.
- [ ] **Step 2: Backend Jest** — throwaway `node:24-alpine` container, `jest`. Expected: existing suites still pass (record count).
- [ ] **Step 3: Accuracy cross-check** — assert Command Centre `transfer`/`archive` totals EXACT-match raw SQL counts and Module 4's dashboard; no double counting.
- [ ] **Step 4: Protections re-verified (brief item 8 + data-preservation):** Orthanc instance/study counts unchanged (expected 2489/10), `archive_jobs` + `verified` counts unchanged (re-verify/exceptions are read-only), signatures count unchanged, `studies_search_tsv_idx` GIN present, no migration applied, no volume/DICOM/archive touched, **all 8 Docker services healthy, no 9th**, NGINX dynamic DNS intact (backend recreate → new IP, 0× 502). Record actuals.
- [ ] **Step 5: Screenshots** — Command Centre, Exceptions console, Study Operations drawer (next sequential numbers after 38).
- [ ] **Step 6: Write the 5 docs + update PROGRESS.md.** Docs state: what was built, the notification verdict from Task 1 (already-wired vs added), RBAC (no new permission), interrupted-job heuristic caveat, actual test results, and NOT TESTED items (multi-million-row stress). `PROGRESS.md` gets the Module 5 COMPLETE section only now.
- [ ] **Step 7: Ledger** `Task 7: full regression <counts>, 8 services healthy no 9th, protections re-verified, screenshots + 5 docs + PROGRESS`.

---

## Self-review notes (checked against spec)

- **Spec coverage:** A→Task 2 + Task 6; B→Task 3 (aggregate) + Task 6 (drawer/push); C→Task 4 + Task 6; D→Task 1 (verify) + Task 5 (close); E→Task 3. Security/RBAC/org/patient woven through Tasks 2–4 + 6. Regression/8-service/preservation→Task 7. Brief items 1–8 each mapped.
- **No new permission / migration / service:** enforced in Global Constraints and every task; study aggregate extends Module 4 (approved); recovery via existing endpoints only.
- **Type consistency:** `OperationRow` and `normalize*`/`studyLookup`/`requireAnySource` reused verbatim from `operations-history.service.ts`; new `ExceptionRow` defined once in Task 4; `getStudyStatistics` takes the Orthanc study id (resolved from `Study.orthancStudyId`) — called out in Task 3.
- **Review Focus:** five uncovered-input risks listed, each tied to a task's test (cross-org study 403, MRN redaction on all three surfaces, recovery privilege gate, interrupted-vs-failed separation, notification dedup).
- **Proportion:** plan cites signatures + test assertions, not full bodies; implementer writes idiomatic NestJS/React from the interfaces.

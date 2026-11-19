# PACS Operations Module 4 — Transfer & Archive History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Transfer & Archive History" module unifying reverse-push (Module 1) and archive (Module 2) records into a dashboard, filtered/paginated lists, per-operation detail, non-mutating archive re-verify, and secure CSV export.

**Architecture:** Service-layer union (Approach A) over existing `DicomTransferJob`/`DicomTransferInstance` and `ArchiveJob` tables — no migration, no new permission, no writes to job records. Per-source RBAC (reuse `pacs.reverse-push.view` / `pacs.archive.view`, ≥1 required); patient MRN gated by `patient.view`; patient MRN + modality joined from RIS `Study → Patient`. New NestJS controller+service in `backend/src/pacs/`, a React page, and a Playwright spec whose accuracy checks are cross-verified against raw SQL.

**Tech Stack:** NestJS 10 / Prisma 5.22 / Node 24 backend; React + Vite + TS frontend; Playwright + Jest tests; Docker Compose (8 services). PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-11-15-pacs-ops-module4-history-design.md`

## Global Constraints
- Read-only over the data plane: **never** write to `DicomTransferJob`, `DicomTransferInstance`, `ArchiveJob`, or any instance/verification record; never delete/migrate/modify DICOM or archives; never overwrite a verified archive.
- **No migration** (Approach A). Preserve `studies_search_tsv_idx` GIN. Never reset PostgreSQL / delete Docker volumes. Preserve all 8 services, nginx dynamic DNS, Phases 1–9 and PACS Ops Modules 1–3.
- **No new permission.** Endpoints require **at least one** of `pacs.reverse-push.view` / `pacs.archive.view`; service returns only the source(s) the caller holds. Patient MRN (and patient-linked fields) included only if caller holds `patient.view`.
- Org isolation on every query (reuse existing `assertOrg`/scoping). Super admin = all sources + all orgs.
- Real DB records only — no mock data. CSV: server-side, formula-injection-escaped (reuse the `csv()` helper), row cap **10,000**, provenance comment line (user + ISO timestamp + row count), audit event per export.
- Patient "Patient ID" = `Patient.mrn`. Patient join path: `job.studyId → Study`, fallback `job.studyInstanceUid → Study.studyInstanceUid`, then `Study.patient.mrn` + `Study.modality`.
- Default page size 25 (max 200 via existing `PaginationQuery`). Operation detail returned as a single object for a drawer UI. Archive path/credentials shown only with `pacs.archive.manage`.
- On-demand archive re-verify is **non-mutating**: re-hash + re-extract, compare to stored `sha256`/`verified`, return pass/fail, **modify no archive file and no job/verification record**; write only an `OPS_HISTORY_ARCHIVE_REVERIFY` audit event.

## Review Focus
- **Caller with neither source permission** → `403` (not an empty 200). Covered in Task 2 tests.
- **Single-source caller** (reverse-push-only / archive-only) → unified list + dashboard omit the other source entirely; counts exclude it. Covered in Task 3 & 4 tests.
- **Caller without `patient.view`** → rows/detail/CSV omit MRN (never leak the identifier). Covered in Task 3 & 6 tests.
- **Custom date range with `from > to` or malformed dates** → empty/clamped result, not a 500. Covered in Task 4 tests.
- **CSV cell beginning `=`/`+`/`-`/`@`** (e.g. a crafted `createdBy` or error string) → escaped with a leading `'`. Covered in Task 6 tests.

---

## Task 1: Read-only archive integrity inspector (non-mutating re-verify)

**Files:**
- Modify: `backend/src/pacs/archive.service.ts` (add one public method; reuse private `verifyFile`)
- Test: `tests/operations-history.spec.ts` (verify-path assertions added here; file created in Task 2 if run first — order tasks so Task 2's file exists, else create minimal file here)

**Interfaces:**
- Consumes: existing `ArchiveService` private `verifyFile(file: string, expectedSha: string): Promise<{ ok: boolean; detail: string }>`, private `require`, `assertOrg`, `this.root`, `serialize`.
- Produces: `ArchiveService.inspectIntegrity(user: AuthUser, id: string): Promise<{ jobId: string; ok: boolean; detail: string; expectedSha: string | null; archivePath: string | null }>` — **reads only**, updates no row.

- [ ] **Step 1: Write the failing test** (in `tests/operations-history.spec.ts`): as admin, POST `/api/pacs/operations/history/archive/:jobId/verify` for a VERIFIED job → 200 `{ ok: true }`; then assert the `ArchiveJob` row's `verifiedAt` is unchanged by re-reading it via the archive jobs API before/after (timestamps equal). Assert an audit row `OPS_HISTORY_ARCHIVE_REVERIFY` exists (via audit viewer API).
- [ ] **Step 2: Run to verify it fails** — Run: `cd tests && ./node_modules/.bin/playwright test operations-history.spec.ts -g "re-verify"` · Expected: FAIL (route 404 / method missing).
- [ ] **Step 3: Implement `inspectIntegrity`** in `archive.service.ts`: lookup job (`findUnique`), `assertOrg`, require `PACS_ARCHIVE_VIEW`; if `!archivePath || !sha256` → `{ ok:false, detail:'no archive', … }`; else `const r = await this.verifyFile(path.join(this.root, job.archivePath), job.sha256)`; return the result object. **No `archiveJob.update`.** (Audit is written by the Module-4 controller/service, not here, to keep ArchiveService's own audit action name intact.)
- [ ] **Step 4: Run to verify it passes** (after Task 2 wires the route) — deferred verification noted; unit-level: `cd tests && ./node_modules/.bin/playwright test operations-history.spec.ts -g "re-verify"` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend/src/pacs/archive.service.ts tests/operations-history.spec.ts && git commit -m "feat(ops-history): non-mutating archive integrity inspector"`

## Task 2: OperationsHistoryService + controller skeleton, RBAC gate

**Files:**
- Create: `backend/src/pacs/operations-history.service.ts`
- Create: `backend/src/pacs/operations-history.controller.ts`
- Modify: `backend/src/pacs/pacs.module.ts` (register controller + service; ensure `AuditService`, `ArchiveService`, `PrismaService` injectable)
- Test: `tests/operations-history.spec.ts`

**Interfaces:**
- Consumes: `AuthUser` (`permissions: string[]`, `isSuperAdmin`, `organizationId`), `PrismaService`, `AuditService.log`, `ArchiveService.inspectIntegrity` (Task 1), `PERMISSIONS` (`PACS_REVERSE_PUSH_VIEW`, `PACS_ARCHIVE_VIEW`, `PATIENT_VIEW`, `PACS_ARCHIVE_MANAGE`).
- Produces:
  - `visibleSources(u: AuthUser): { reversePush: boolean; archive: boolean }`
  - `private requireAnySource(u: AuthUser): void` (throws `ForbiddenException` if neither)
  - `private canSeePatient(u: AuthUser): boolean`
  - `private orgWhere(u: AuthUser): { organizationId?: string }` (super admin → `{}`; else `{ organizationId: u.organizationId }`)
  - Controller base path `pacs/operations/history`.

- [ ] **Step 1: Write the failing test**: `GET /api/pacs/operations/history/dashboard` as `recept1` (no pacs perms) → **403**; as `admin` → 200. As `rad_ggh` (has reverse-push/archive view? verify seed) — if not, use admin for 200.
- [ ] **Step 2: Run to verify it fails** — Run: `cd tests && ./node_modules/.bin/playwright test operations-history.spec.ts -g "requires a source permission"` · Expected: FAIL (404).
- [ ] **Step 3: Implement** the service with the helpers above + a stub `dashboard(u)` returning `{}` after `requireAnySource(u)`; implement the controller `GET /dashboard` calling it with a custom in-handler check (since `@RequirePermissions` is AND-only, do the OR check inside the service via `requireAnySource`). Register in `pacs.module.ts`.
- [ ] **Step 4: Run to verify it passes** — same command · Expected: PASS (403 for recept1, 200 for admin).
- [ ] **Step 5: Commit** — `git add backend/src/pacs/operations-history.* backend/src/pacs/pacs.module.ts tests/operations-history.spec.ts && git commit -m "feat(ops-history): service+controller skeleton with per-source RBAC gate"`

## Task 3: Row normalization + unified/per-source lists (filters, pagination, sort)

**Files:**
- Modify: `backend/src/pacs/operations-history.service.ts`
- Modify: `backend/src/pacs/operations-history.controller.ts` (add `GET /list`, `/reverse-push`, `/archive`)
- Test: `tests/operations-history.spec.ts`

**Interfaces:**
- Consumes: `buildOrderBy`, `skipTake`, `paginate`, `PaginationQuery` from `common/pagination`; Prisma models `dicomTransferJob` (incl. `destination`), `archiveJob`, `study` (include `patient`).
- Produces:
  - `type OperationRow = { type: 'REVERSE_PUSH' | 'ARCHIVE'; id: string; studyInstanceUid: string; patientMrn: string | null; modality: string | null; status: string; createdBy: string | null; createdAt: string; startedAt: string | null; completedAt: string | null; summary: Record<string, any> }`
  - `private studyLookup(studyIds: string[], uids: string[]): Promise<Map<key,{ mrn: string|null; modality: string|null }>>` (one batched query; key by studyId then uid)
  - `normalizeTransferJob(job, lookup, seePatient): OperationRow` / `normalizeArchiveJob(job, lookup, seePatient): OperationRow`
  - `buildFilters(u, q): { rpWhere, arWhere }` honoring: dateFrom/dateTo (on `createdAt`), type, destinationId (rp only), patientMrn (→ Study/Patient subquery), studyUid, modality (→ Study subquery), status, createdBy, verified (ar only)
  - `list(u, q): Paginated<OperationRow>` (unified), `listReversePush(u, q)`, `listArchive(u, q)`

- [ ] **Step 1: Write failing tests**: (a) `GET /list` as admin returns rows with `type` ∈ {REVERSE_PUSH, ARCHIVE} and a `total` equal to (count of transfer jobs + count of archive jobs) in-org [number asserted by a direct `/reverse-push` + `/archive` total sum]; (b) a reverse-push-only user's `/list` returns only `type==='REVERSE_PUSH'` rows; (c) a user **without** `patient.view` gets `patientMrn === null` on every row; (d) sort by `createdAt desc` returns non-increasing timestamps; (e) `pageSize=1` returns exactly 1 row and `totalPages>1` when >1 record.
- [ ] **Step 2: Run to verify they fail** — Run: `cd tests && ./node_modules/.bin/playwright test operations-history.spec.ts -g "list"` · Expected: FAIL.
- [ ] **Step 3: Implement** normalization + lists. Unified `list`: compute per-source filtered `count`s (sum = `total`); from each **visible** source fetch `take: (page*pageSize)` ordered by the shared sort key (`createdAt` default; allow-list `['createdAt','completedAt','status']`), concat, globally sort, then slice `skipTake`. Patient/modality via one batched `studyLookup`. Gate `patientMrn` with `seePatient`.
- [ ] **Step 4: Run to verify they pass** — same command · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(ops-history): normalized unified + per-source lists with filters/sort/pagination"`

## Task 4: Unified dashboard with date summaries

**Files:**
- Modify: `backend/src/pacs/operations-history.service.ts`
- Modify: `backend/src/pacs/operations-history.controller.ts` (`GET /dashboard?range=today|7d|30d|custom&from=&to=`)
- Test: `tests/operations-history.spec.ts`

**Interfaces:**
- Consumes: Prisma `count`, `groupBy`, `aggregate(_sum)`.
- Produces: `dashboard(u, range): Promise<{ range, reversePush:{ total, success, failed, pending }, archive:{ total, verified, failed, originalBytes, compressedBytes, savingsBytes }, recent: OperationRow[] }>` — only visible sources populated; `resolveWindow(range, from?, to?): { gte?, lte? }` with `from>to` → empty window.

- [ ] **Step 1: Write failing tests**: (a) admin `/dashboard?range=30d` → `reversePush.total` equals a direct count of transfer jobs in the last 30 days (assert equality against `/reverse-push?dateFrom=...` total); `archive.verified` equals count of `verified===true`; `archive.originalBytes`/`compressedBytes` equal `_sum` over archive jobs [assert > 0 given seeded archives]; (b) `range=custom&from=2999-01-01&to=2999-12-31` → all totals 0, no 500; (c) `from` after `to` → 0, no 500; (d) reverse-push-only user → `archive` block omitted/zeroed and not counted.
- [ ] **Step 2: Run to verify they fail** — Run: `... -g "dashboard"` · Expected: FAIL.
- [ ] **Step 3: Implement** `dashboard` using `count`/`groupBy(status)`/`aggregate._sum` scoped by org + window + visible sources; `recent` = latest 10 normalized rows across visible sources. No duplicate counting (sources disjoint).
- [ ] **Step 4: Run to verify they pass** — same command · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(ops-history): unified dashboard with today/7d/30d/custom summaries"`

## Task 5: Operation detail + non-mutating re-verify route

**Files:**
- Modify: `backend/src/pacs/operations-history.service.ts`
- Modify: `backend/src/pacs/operations-history.controller.ts` (`GET /reverse-push/:jobId`, `GET /archive/:jobId`, `POST /archive/:jobId/verify`)
- Test: `tests/operations-history.spec.ts`

**Interfaces:**
- Consumes: `ArchiveService.inspectIntegrity` (Task 1); Prisma `dicomTransferJob.findUnique({ include: { instances, destination } })`, `archiveJob.findUnique`.
- Produces:
  - `reversePushDetail(u, jobId): { job fields, destination: {name,aeTitle,host,port}, instances: {sopInstanceUid,status,error,sentAt}[], retryCount, lastError }` — org+source gated; patient MRN gated.
  - `archiveDetail(u, jobId): { job fields incl. sizes/ratio/savings/sha256/verified/verifyDetail/instanceCount/completedAt, archivePath?(manage only), compressionLevel, workerCount }` — org+source gated.
  - `reverifyArchive(u, jobId, ip): { ok, detail }` → calls `inspectIntegrity`, writes audit `OPS_HISTORY_ARCHIVE_REVERIFY`, **no record mutation**.

- [ ] **Step 1: Write failing tests**: (a) `/reverse-push/:id` as admin returns `instances` array with per-instance `status`/`error`; (b) `/archive/:id` without `pacs.archive.manage` has `archivePath` absent/null, with manage present; (c) `POST /archive/:id/verify` returns `{ ok:true }` for a VERIFIED job and the job's `verifiedAt` is **unchanged** (re-read via `/archive/:id`), and an `OPS_HISTORY_ARCHIVE_REVERIFY` audit row exists; (d) cross-org user → 403 on both detail routes.
- [ ] **Step 2: Run to verify they fail** — Run: `... -g "detail|re-verify"` · Expected: FAIL.
- [ ] **Step 3: Implement** the three service methods + routes. For archivePath gating use `canSeeManage(u)=u.isSuperAdmin||permissions.includes(PACS_ARCHIVE_MANAGE)`.
- [ ] **Step 4: Run to verify they pass** — same command · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(ops-history): operation detail + non-mutating audited archive re-verify"`

## Task 6: Secure CSV export (4 kinds)

**Files:**
- Modify: `backend/src/pacs/operations-history.service.ts`
- Modify: `backend/src/pacs/operations-history.controller.ts` (`GET /export?kind=reverse-push|archive|unified|summary` via `@Res`)
- Test: `tests/operations-history.spec.ts`

**Interfaces:**
- Consumes: the `csv(v)` formula-injection helper (copy the exact one-liner used in `storage.service.ts`); `AuditService.log`.
- Produces: `exportCsv(u, kind, q, ip): Promise<string>` — applies the same filters/visible-source rules; caps at 10,000 rows; first line `# Operations history export | kind=<k> | by <user> | <iso> | <n> rows`; header row per kind; patient MRN column present only with `patient.view`; audit `OPS_HISTORY_EXPORT` with `{ kind, rows, filters }`.

- [ ] **Step 1: Write failing tests**: (a) `GET /export?kind=unified` → `text/csv`, provenance comment line, header row; (b) totals: number of data rows ≤ 10,000 and equals the `/list` total when under cap; (c) a seeded record whose `createdBy` or `lastError` starts with `=` appears escaped as `'=…` [seed one transfer instance error like `=cmd()` via synthetic job, or assert the escape function on a crafted value]; (d) export as a user without `patient.view` has no MRN column; (e) export without any source perm → 403.
- [ ] **Step 2: Run to verify they fail** — Run: `... -g "export|injection"` · Expected: FAIL.
- [ ] **Step 3: Implement** `exportCsv` + route; reuse `csv()`; build rows from the same list builders (bypassing pagination, capped).
- [ ] **Step 4: Run to verify they pass** — same command · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(ops-history): secure CSV export (reverse-push/archive/unified/summary)"`

## Task 7: Frontend OperationsHistory page + "PACS Operations" nav group

**Files:**
- Create: `frontend/src/pages/OperationsHistory.tsx`
- Modify: `frontend/src/App.tsx` (route `/pacs/operations/history`)
- Modify: `frontend/src/components/Layout.tsx` (new nav group "PACS Operations" containing Reverse Push Monitor, Archive Compression, Storage Management, Transfer & Archive History)
- Test: `tests/operations-history.spec.ts` (one UI flow)

**Interfaces:**
- Consumes: `api` + `getAccess` from `lib/api`, `useAuth().can`; backend routes from Tasks 3–6.
- Produces: page with tabs DASHBOARD / UNIFIED / REVERSE PUSH / ARCHIVE; summary cards; date-range selector; filter panel (date, type[unified], destination, patient MRN, study UID, modality, status, created-by, verified); history table with status badges + server-side pagination + column sort; row → detail drawer (reverse-push instances+errors+retries / archive sizes+sha256+verify button); export button (current tab+filters). Patient column hidden when `!can('patient.view')`. No mock data.

- [ ] **Step 1: Write the failing UI test**: Playwright logs in as admin, navigates `/pacs/operations/history`, expects heading "Transfer & Archive History", the four tab buttons, and ≥1 row in UNIFIED after load; clicks a row → detail drawer shows. (Mirror the style of `tests/*.spec.ts` UI checks.)
- [ ] **Step 2: Run to verify it fails** — Run: `cd tests && ./node_modules/.bin/playwright test operations-history.spec.ts -g "UI"` · Expected: FAIL (route 404 in SPA).
- [ ] **Step 3: Implement** the page + route + nav group. Build frontend (`docker compose ...` build/deploy per existing frontend flow) so the bundle serves.
- [ ] **Step 4: Run to verify it passes** — same command · Expected: PASS.
- [ ] **Step 5: Commit** — `git add frontend/src/pages/OperationsHistory.tsx frontend/src/App.tsx frontend/src/components/Layout.tsx tests/operations-history.spec.ts && git commit -m "feat(ops-history): OperationsHistory page + PACS Operations nav group"`

## Task 8: Full regression, screenshots, docs, memory

**Files:**
- Create: `docs/PACS_OPERATIONS_HISTORY_{ARCHITECTURE,GUIDE,API,TEST_RESULTS,CHECKLIST}.md`
- Modify: `docs/PROGRESS.md`
- Modify: memory (`pacs-replica-phase-progress.md`, new/updated decisions file, `MEMORY.md`)
- Screenshots: `docs/screenshots/36-ops-history-dashboard.png`, `37-ops-history-unified.png`, `38-ops-history-detail.png`

- [ ] **Step 1: Full Playwright regression** — Run: `cd tests && ./node_modules/.bin/playwright test --reporter=list` · Expected: all specs pass (existing 28 + new). Record the count.
- [ ] **Step 2: Backend unit regression** — Run Jest in a throwaway `node:24` devDeps container (same method as Module 3) · Expected: 44/44 (or current baseline).
- [ ] **Step 3: Accuracy cross-check vs raw SQL** — query `dicom_transfer_jobs`/`archive_jobs` counts + `_sum(originalBytes/compressedBytes)` directly in PostgreSQL and assert they match the dashboard/export totals. Record actual numbers.
- [ ] **Step 4: Critical-protection re-verify** — Orthanc instance/study counts unchanged; signatures intact; `studies_search_tsv_idx` present; no volume/DICOM/archive touched; 8 services healthy.
- [ ] **Step 5: Screenshots** 36–38 via Playwright.
- [ ] **Step 6: Write the five docs + update PROGRESS.md + memory.**
- [ ] **Step 7: Commit** — `git commit -am "docs(ops-history): Module 4 docs, screenshots, progress + memory; full regression green"`

---

## Self-review notes
- **Spec coverage:** reverse-push history (T3,T5) · archive history (T3,T5) · unified dashboard+summaries (T4) · filtering/pagination/sort (T3) · detail (T5) · non-mutating re-verify (T1,T5) · CSV export ×4 (T6) · RBAC per-source + patient gate (T2,T3,T5,T6) · frontend+nav (T7) · all 16 test checks (T3–T8) · docs/screenshots (T8). No migration (constraint). No gaps found.
- **Review Focus** five items each pinned to a task's tests (T2 neither-perm 403; T3/T4 single-source; T3/T6 patient redaction; T4 bad date range; T6 formula injection).
- **Type consistency:** `OperationRow`, `visibleSources`, `inspectIntegrity` signatures reused verbatim across T1–T7.

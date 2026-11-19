# Progress Log

## Phase 1 — Foundation ✅ COMPLETE (2026-11-13)

Delivered:
- **Monorepo scaffold**: backend (NestJS), frontend (Vite/React), orthanc, nginx, scripts, docs.
- **Docker stack** (`docker-compose.yml`): postgres 16, redis 7, orthanc, backend, frontend,
  nginx — each with a health check. `.env.example` with all config, no real secrets.
  `docker compose config` validates clean.
- **Database** (`backend/prisma/schema.prisma`): all 23 brief entities — organizations,
  departments, users, roles, permissions, user_roles, role_permissions, patients, doctors,
  modality_devices, scheduled_orders, studies, series, instances, report_templates, reports,
  report_versions, report_signatures, study_assignments, audit_logs, notifications,
  system_settings. UUID PKs, DICOM UIDs, worklist indexes, org/dept isolation fields.
  - Migrations: `0001_init` (all tables), `0002_search_vector` (tsvector + GIN for report/worklist search).
- **Auth**: login/logout, JWT access + rotating refresh tokens (Redis-tracked, revocable),
  argon2id hashing, failed-login tracking + 15-min lockout, password change (revokes sessions).
- **RBAC**: permission catalogue + 10 proposed roles, `@RequirePermissions` decorator, global
  `PermissionsGuard`, JWT strategy that resolves a user's effective permissions.
- **Audit**: append-only `AuditService`, wired into auth events.
- **Health**: `/api/health` (checks DB), nginx `/healthz`.
- **Tests**: RBAC guard unit tests — 5/5 passing. Backend `tsc` + `nest build` clean.

Static verification:
- `npx prisma validate` → valid.
- `npx jest` → 5 passed (re-run during deploy: 5/5 again).
- `npm run build` → success.
- `docker compose config` → valid.

## Phase 1 — LIVE DEPLOYMENT & VERIFICATION ✅ (2026-11-13)

`docker compose up -d --build` executed. All six services built/pulled and reached
**healthy**. Volumes and data preserved throughout (no resets).

Final fleet status:
| service | status |
| --- | --- |
| postgres | healthy |
| redis | healthy |
| orthanc | healthy (PostgreSQL index plugin active) |
| backend | healthy |
| frontend | up (static nginx, no healthcheck by design) |
| nginx | healthy |

### Verification results (actual)
- **PostgreSQL** — `pg_isready` OK; `ris` + `orthanc` DBs present; RIS tables exist. ✅
- **Redis** — `PING → PONG`. ✅
- **Orthanc** — `/system` returns; `DatabaseBackendPlugin=libOrthancPostgreSQLIndex.so`
  confirms it connected to the `orthanc` DB. ✅
- **Backend** — `GET /api/health → {status:ok, db:up}` via nginx. ✅
- **Frontend** — index served through nginx. ✅
- **NGINX** — reverse proxy routes `/`, `/api`, `/healthz`. ✅
- **Prisma migrations** — `0001_init` + `0002_search_vector` applied; seed created
  GGH org + `admin`. ✅
- **Auth / JWT / logout (live, 8/8 PASS):** login returns access+refresh; wrong password
  →401; authenticated request passes JWT guard; no-token →401; **refresh rotation** issues
  a new refresh token and **revokes the old** (→401); **logout revokes** the refresh (→401). ✅
- **RBAC (live):** seeded `recept1` (receptionist) → resolves to 3 permissions vs
  super_admin's 21; login succeeds with scoped role. Guard unit tests cover allow/deny. ✅
- **Audit logging (live):** LOGIN, LOGIN_FAILED, LOGOUT recorded with timestamps and user. ✅
- **Automated tests re-run:** `jest` 5/5 PASS. ✅

### Issues encountered & fixes applied
1. **`orthanc` DB not created** — `init-db.sh` used `${ORTHANC_DB_NAME}` but that var wasn't
   passed into the postgres container, so `CREATE DATABASE` ran with an empty name.
   *Fix:* added `ORTHANC_DB_NAME` to the postgres service env; hardened `init-db.sh` with a
   `${VAR:-orthanc}` default. Created the missing DB live without a data reset.
2. **Prisma OpenSSL failure on Alpine** — backend stuck in a migrate retry loop
   ("Could not parse schema engine response"). Alpine/musl lacked OpenSSL and the Prisma
   engine binary target. *Fix:* `apk add openssl` in both Dockerfile stages +
   `binaryTargets=["native","linux-musl-openssl-3.0.x"]` in schema. Rebuilt backend;
   migrations + seed then ran cleanly.
3. **Orthanc healthcheck used curl** — image ships no curl/wget, so it reported unhealthy
   (cascading nginx→unhealthy). *Fix:* bash `/dev/tcp` probe against port 8042.
4. **backend/nginx healthchecks used `localhost`** — resolved to IPv6 `::1` (refused) in
   these images. *Fix:* switched healthchecks to `127.0.0.1`; added `start_period` so the
   backend's migrate+seed startup isn't flagged early.

### Remaining issues
- None blocking. Note: Prisma prints a harmless `libssl` detection warning before OpenSSL
  loads; functionally clean after the fix. Frontend has no healthcheck (intentional for a
  static bundle). HTTPS/TLS at nginx is config-ready but not enabled (on-prem dev).

### Role names are PROPOSED
The 10 roles (super_admin, org_admin, dept_admin, radiologist, reporting_doctor, technician,
receptionist, referring_doctor, pacs_admin, auditor) come from the brief, not confirmed Pixray
screens. Reconcile when the Admin > User screenshot arrives.

## Next: Phase 2 — Org structure
Org / department / doctor / user / modality CRUD + admin UI. Blocked-ish on exact Pixray
field lists (works with standard fields meanwhile, documented as assumptions).

## Phase 2 — Administrative Modules ✅ COMPLETE (2026-11-13)

Six modules delivered, backend + frontend + tests, all working against the live DB.

### Completed modules
Organization, Department, Doctor, User (flexible fields), Modality (flexible fields),
Administration Dashboard.

### API endpoints (all under /api, JWT + RBAC enforced)
- `GET /auth/me` — identity + effective permissions
- Organizations: `GET /organizations`, `GET /:id`, `POST`, `PATCH /:id`, `PATCH /:id/active`
- Departments: `GET /departments`(+`?organizationId`), `GET /:id`, `POST`, `PATCH /:id`, `PATCH /:id/active`
- Doctors: `GET /doctors`, `GET /:id`, `POST`, `PATCH /:id`, `PATCH /:id/active`
- Users: `GET /users`, `GET /:id`, `POST`, `PATCH /:id`, `PATCH /:id/active`, `POST /:id/reset-password`
- Modalities: `GET /modalities`, `GET /:id`, `POST`, `PATCH /:id`, `PATCH /:id/active`, `POST /:id/test-connection`
- Roles: `GET /roles` (picker)
- Admin: `GET /admin/dashboard`
All list endpoints support `?page&pageSize&search&sortBy&sortDir`.

### Database changes
None to the schema — Phase 2 uses the existing Phase 1 Prisma models
(organizations, departments, doctors, users + user_roles, modality_devices).
No migration added. No data reset; existing volumes preserved.

### Test results
- Backend unit tests: **17/17 pass** (orgs, departments, users, modalities, RBAC guard).
- Live end-to-end API test against running stack: **19/19 pass** — CRUD, validation (400),
  duplicate conflict (409), pagination/search, org isolation, passwordHash exclusion,
  RBAC denial (403 for receptionist on /users), modality test-connection, dashboard counts.
- Browser integration (Playwright): login → dashboard (live counts) → Organizations table
  (GGH row) → Users → Modalities create modal. All render and function.
- Phase 1 auth re-verified intact.

### Screenshots (docs/screenshots/)
01-login · 02-dashboard · 03-organizations · 04-users · 05-modality-form

### Issue encountered & fixed
- **Guard ordering bug:** the global PermissionsGuard ran before the per-controller
  JwtAuthGuard, so `req.user` was unset → admin got 403 "No authenticated user" on all
  writes. *Fix:* registered JwtAuthGuard as a global APP_GUARD before PermissionsGuard,
  added `@Public()` for login/refresh/health. Re-tested: 19/19 pass.

### Flexible-per-instruction (NOT finalised)
- **User** fields and **Modality** fields use standard sets, clearly noted in the UI as
  "pending screenshot". Role picker is live but role NAMES are still the proposed set.
  Will reconcile when the Admin→User and New Modality screenshots arrive.

### Remaining issues
- None blocking. Client-side permission gating is permissive-by-design (server is
  authoritative). Multi-role assignment supported by API but UI exposes a single role for now.

## Next: Phase 3 — Patients, examination orders, RIS worklist.

## Phase 3 — Patients, Orders, RIS Worklist ✅ COMPLETE (2026-11-13)

### Modules completed
Patient Management, Examination Order Management, RIS Worklist, Study Assignment,
Patient & Study History, Dashboard Integration.

### Database migrations
- `0003_phase3_patients_orders` (additive, applied live, no reset):
  - patients: + email, address, mobile, referringDoctorId, departmentId, status,
    registrationDate (+ indexes status, org+registrationDate; FK to doctors)
  - scheduled_orders: + departmentId, assignedUserId, priority, clinicalHistory,
    studyDescription, studyId (+ indexes status, org+scheduledAt)
  - **Manually removed Prisma's destructive DROP of studies.search_tsv + its GIN index**
    (maintained by raw SQL in 0002); verified the FTS index survived. No data reset.

### API endpoints (all JWT + RBAC; list endpoints paginated/searchable/sortable)
- Patients: `GET /patients`, `GET /:id`, `GET /:id/history`, `POST`, `PATCH /:id`,
  `PATCH /:id/status`, `POST /patients/merge`
- Orders: `GET /orders`(+`?status`), `GET /:id`, `POST`, `PATCH /:id`, `PATCH /:id/cancel`, `PATCH /:id/assign`
- Worklist: `GET /worklist` (all filters + status tab), `GET /worklist/counts`,
  `GET /worklist/pending-assignment`, `GET /worklist/:id/assignments`, `POST /worklist/:id/assign`
- Dashboard: `GET /admin/dashboard` extended with clinical + reporting + modality stats

### Frontend screenshots (docs/screenshots/)
06-worklist (search panel, status tabs w/ live counts, 12-col table) ·
07-dashboard-clinical (clinical + reporting + modality cards) · 08-patients (1000 rows) ·
09-patient-details (demographics + prior studies + orders)

### Automated test results
- Backend unit: **31/31 pass** (8 suites incl. patients, orders, worklist filters).
- Live e2e API: **18/18 pass** — patient create/auto-MRN/age, duplicate block+override,
  order create + unique accession, worklist list/filter/counts, study assign + history +
  worklist display, patient history, dashboard clinical stats + 9-modality breakdown,
  RBAC denial (receptionist blocked from assign).
- Audit verified: PATIENT_CREATE/UPDATE, ORDER_CREATE/CANCEL, STUDY_ASSIGN recorded.

### Performance test results (1,000 patients, 5,000 orders, 5,000 studies — synthetic)
Averaged over 3 runs, through nginx:
- worklist page 1: ~29ms · worklist page 100 (deep): ~30ms · pageSize=100: ~41ms
- filter modality=CT: ~28ms · filter status=FINAL: ~27ms · patient-name search: ~33ms
- worklist counts (6 tabs aggregate): ~26ms · patients list: ~25ms · orders list: ~28ms
All comfortably sub-50ms. Scales toward the real 48k+ row dataset.

### Remaining issues
- Study-assign **button** in the worklist UI is deferred to the Phase 7 reporting flow;
  the assign API + history + "assigned radiologist" column are complete and tested.
- Patient picker on the order form loads a 100-row page (typeahead to be added for huge sets;
  API already supports ?search).
- Prisma `migrate diff` will keep trying to drop search_tsv on future migrations — documented;
  will formalise by modeling it as an Unsupported column or keeping the manual-edit practice.
- Synthetic perf dataset (PERF* records) left in the DB for ongoing testing; removable on request.

## Next: Phase 4 — Orthanc integration + DICOM C-STORE receiver.

## Phase 4 — Orthanc Integration & DICOM C-STORE ✅ COMPLETE (2026-11-13)

### Modules completed
Orthanc REST integration, DICOM C-STORE reception (via Orthanc SCP), automatic study
ingestion, metadata extraction, modality connectivity status, study reconciliation,
storage monitoring, PACS monitoring frontend.

### DICOM configuration
- **AE Title: GGHPACS** · **DICOM port: 4242** (C-STORE SCP, published on host)
- DICOMweb at `/dicom-web` (via nginx); Orthanc admin behind Basic auth, not publicly exposed
- Ingest flow: modality → Orthanc C-STORE → OnStableStudy Lua hook → POST /api/ingest/orthanc-study
  (shared-secret protected) → backend pulls metadata via Orthanc REST → registers in Postgres

### Database changes
- Migration `0004_phase4_dicom` (additive, no reset):
  - New table `dicom_reception_logs` (status, modality, aet, series/instance counts, message)
  - modality_devices: + lastSuccessAt, lastFailureAt
  - studies: + studyTime, isReconciled
  - **Permanently fixed the recurring search_tsv problem:** declared `search_tsv
    Unsupported("tsvector")` + `@@index(type: Gin)` in schema, so `prisma migrate diff` no
    longer tries to drop the FTS column/index. Verified index survived.

### API endpoints
- `GET /pacs/monitor` (Orthanc health + storage stats + reception summary)
- `GET /pacs/reception-logs` (+`?status`)
- `GET /pacs/modalities/status`
- `GET /pacs/reconciliation/unmatched`, `GET /pacs/reconciliation/duplicates`
- `POST /pacs/reconciliation/:studyId/reconcile`
- `POST /ingest/orthanc-study` (internal, shared-secret; called by Orthanc Lua)

### Test results
- Backend unit: **34/34 pass** (incl. 3 ingest tests: match, orphan, failure).
- **Real DICOM acceptance test (pynetdicom C-STORE → :4242):**
  - Matched study: association established, **6/6 instances C-STORE OK**, stored in Orthanc,
    registered in Postgres as **2 series / 6 instances**, matched to existing patient
    GG00001001 (not orphan), order auto-marked COMPLETED + linked, **appears in RIS worklist
    automatically with modality CT**. ✅ ACCEPTANCE MET.
  - Orphan study (no order): correctly flagged ORPHAN, queued for reconciliation, then
    **manually reconciled** to a patient (unmatched count 1→0). ✅
  - Reception logs, PACS monitor (Orthanc ONLINE v1.13.0, storage 3/6/18), status filters. ✅
- Audit: STUDY_INGESTED (2), STUDY_ORPHAN (1), STUDY_RECONCILE (1).

### Frontend screenshots (docs/screenshots/)
10-pacs-monitor (Orthanc health + storage + reception) · 11-reception-logs (3 events,
status badges, modality) · 12-reconciliation (queue, empty after successful reconcile)

### Issues encountered & fixed
1. **Study modality blank** — Orthanc study-level tags lack ModalitiesInStudy; derived from
   first series' Modality during ingest. Fixed; new studies show CT.
2. **Reception-logs ?status 400** — global ValidationPipe forbidNonWhitelisted rejected the
   extra query param; added a ReceptionLogQuery DTO. Fixed (now 200).

### Remaining issues
- lastSuccessAt/lastFailureAt fields + status API exist, but ingest doesn't yet resolve the
  calling AE title → modality device to stamp them (deferred to Phase 5 when AE identity is wired).
- Orthanc "stable study" delay is ~60-90s before ingest fires (Orthanc default); configurable.
- Synthetic test studies + PERF* dataset remain in DB for ongoing testing; removable on request.

## Next: Phase 5 — DICOM Modality Worklist (MWL SCP).

## Phase 5 — DICOM Modality Worklist (MWL SCP) ✅ COMPLETE (2026-11-13)

### Architecture
Dedicated **MWL SCP service** (Python/pynetdicom, new `mwl-scp` Docker container) that
answers real DICOM C-FIND by querying the RIS Postgres live on each request — no static
.wl files, no simulated responses. **AE Title GGHMWL, port 4243.**

### DICOM configuration
- MWL SCP: AE Title **GGHMWL**, port **4243** (published on host)
- Supports ModalityWorklistInformationFind; rejects associations with a wrong called-AE
- Queries scheduled_orders⋈patients; excludes CANCELLED/COMPLETED orders
- Returns correct MWL datasets: Patient (ID/Name/DOB/Sex), AccessionNumber,
  RequestedProcedureID/Description, ReferringPhysician, InstitutionName, and a
  ScheduledProcedureStepSequence (modality, date, time, step id/description)

### Database changes
- Migration `0005_mwl_query_log` (additive): new `mwl_query_logs` table (callingAet, status,
  matchCount, filters JSON, timestamp). **search_tsv GIN index preserved** — the Unsupported()
  declaration from Phase 4 means the diff no longer tries to drop it (verified zero DROPs).

### API endpoints
- `GET /pacs/mwl/monitor` (query counts, last query, per-calling-AE stats)
- `GET /pacs/mwl/logs` (+`?status`)

### Test results
- Backend unit: **34/34 pass**. MWL matching logic unit tests: **5/5 pass**
  (wildcard conversion, status exclusion, date range, patient/accession WHERE building).
- **Real C-FIND tests via pynetdicom (all pass):**
  - Query by Patient ID → 1 match with full correct dataset
  - Query by Accession → match · by Modality (CT) → match · by Scheduled Date → match
  - **Wildcard name (MWL\*)** → match (DICOM * → SQL ILIKE)
  - Unmatched query → 0 · **Cancelled order → excluded (0)** · restored after
  - **Invalid called-AE (BADAE) → association REJECTED** (was a bug: SCP accepted any AE;
    fixed by adding an EVT_REQUESTED handler that validates called-AE and sends reject)
- MWL query logs written: 7 SUCCESS, 3 NO_MATCH, 1 REJECTED; monitor endpoint aggregates them.

### End-to-end acceptance (brief steps 9-16) — PASSED
patient GG00001003 → CT order (SCHEDULED, acc 20261113005002) → **MWL C-FIND returned it** →
queried by accession → **C-STORE matching study (6 instances)** → study matched the order
(isOrphan=false, modality CT) → **order auto SCHEDULED→COMPLETED** → study shows in RIS
worklist as READY → **MWL now excludes the completed order (0 matches)**. Full loop verified.

### Frontend screenshot (docs/screenshots/)
13-mwl-monitor (AE/port header, query stats 11/7/3/1/0, by-calling-AE, query logs with filters)

### Issues encountered & fixed
1. **SCP accepted any called-AE** → added EVT_REQUESTED validation + association reject + REJECTED log.
2. **Transient nginx 502 after backend recreate** — nginx cached the backend's old upstream IP;
   a `docker compose restart nginx` cleared it. See remaining issues for the permanent fix.

### Remaining issues
- ~~**nginx upstream DNS**~~ **FIXED 2026-11-14** — see the maintenance entry below.
- lastSuccessAt/lastFailureAt per modality device not auto-stamped on MWL query (needs
  calling-AE→device resolution; same deferral as Phase 4).
- Department/PerformingPhysician/StationAET returned empty (no order fields yet).
- Orthanc "stable study" delay ~60-90s before C-STORE studies ingest (Orthanc default).

---

## Maintenance (2026-11-14): nginx embedded-DNS upstream resolution — PERMANENT 502 FIX

**Problem:** nginx resolved upstream hostnames (`backend`, `orthanc`, `frontend`) once at
worker startup via static `upstream { server backend:3000; }` blocks and cached the container
IP indefinitely. After a backend container was rebuilt/recreated and received a new Docker IP,
nginx kept proxying to the stale IP → intermittent **502 Bad Gateway** until `restart nginx`.

**Fix (nginx/nginx.conf):**
- Added Docker's embedded DNS `resolver 127.0.0.11 valid=10s ipv6=off;` + `resolver_timeout 5s`.
- Replaced static `upstream` blocks with **per-location variable upstreams**
  (`set $upstream_backend backend; proxy_pass http://$upstream_backend:3000$request_uri;`).
  A variable in `proxy_pass` forces nginx to re-resolve the name on demand (per resolver TTL)
  instead of caching at startup.
- Because a variable in `proxy_pass` disables nginx's automatic URI assembly, paths are
  restored explicitly: `/api/` and `/` append `$request_uri` (verbatim passthrough, nothing
  stripped — same as before); `/dicom-web/` uses `rewrite ... break` to keep the
  `/dicom-web/` prefix to Orthanc.
- Preserved: WebSocket upgrade (added a `map $http_upgrade $connection_upgrade` so non-WS
  requests send `Connection: close` correctly), `Authorization` passthrough to Orthanc,
  `client_max_body_size 2g`, `/healthz`. Added `X-Forwarded-Proto`. No hardcoded IPs.
- Added a commented `/viewer/` block ready for the Phase 6 OHIF service.
- **Backup:** original saved as `nginx/nginx.conf.bak-phase5-20261114-090016`.

**Validation & tests (all passed):**
- `docker compose config` → OK. `nginx -t` (throwaway container + live container) → syntax OK.
- Routes after deploy: `/healthz` 200, `/api/health` 200 (`{"status":"ok","db":"up"}`),
  `/` 200, `/dicom-web/studies` 401 (noauth) / 200 (auth) — Authorization passthrough works.
- **Backend RESTART** (nginx untouched): 10/10 → 200, no 502.
- **Backend RECREATION with forced NEW IP** (pinned old IP `172.22.0.8` with a placeholder
  container so backend moved to `172.22.0.9`; nginx NOT restarted): 30/30 → 200, **zero 502** —
  nginx auto-re-resolved the new IP. This is the exact scenario that previously 502'd.
- **nginx restart**: all routes 200/401 as expected.
- **Full `docker compose restart`**: all 7 services back healthy; backend IP changed again to
  `172.22.0.3`; all routes still 200/401 with no nginx intervention.
- **No regressions:** MWL matching 5/5 pass; MWL SCP listening on 4243; Orthanc DICOM 4242
  reachable. PostgreSQL, Docker volumes and DB records untouched (additive config change only).

**Remaining:** none for this fix. (Backend jest unit suite is not in the production runtime
image — it runs against the build context, unchanged by this work.)

---

## Phase 6 — Advanced PACS Viewer (OHIF + Cornerstone3D) ✅ COMPLETE (2026-11-14)

### Architecture changes
- **New `ohif` Docker service** — OHIF Viewer built from official source **pinned to v3.13.14**
  (latest stable; the prebuilt `ohif/app` image bakes PUBLIC_URL=`/` at build time and cannot be
  reparented, so we build with `--build-arg PUBLIC_URL=/viewer/`). Served at **http://localhost/viewer/**.
- **Backend DICOMweb proxy** (`backend/src/dicomweb/`): `/api/dicom-web/*` validates the RIS JWT
  (Bearer header OR an HttpOnly viewer cookie), enforces **organization isolation** per study, and
  **streams** Orthanc's responses verbatim (multipart pixel data intact). Orthanc basic-auth stays
  server-side. `POST /api/viewer/session` sets the short-lived HttpOnly cookie OHIF rides on (its
  image loader cannot reliably attach a Bearer header to WADO-RS frame requests — issues #1736/#1870).
- **nginx**: activated `/viewer/` (dynamic-DNS `set $upstream_ohif`) and a dedicated streamed
  `/api/dicom-web/` location (buffering off, 300s read timeout, unbounded body). Phase-5 DNS fix preserved.
- **Frontend**: worklist "Open Study" button (enabled when `hasImages`) → sets viewer session →
  opens `/viewer/viewer?StudyInstanceUIDs=<uid>` in a new tab. New `lib/viewer.ts`; `hasImages` added
  to the worklist row (true when `orthancStudyId` present).
- **No schema change / no migration** — proxy uses existing tables; audit uses existing audit_logs.
- Added deps: `cookie-parser` 1.4.7 (+types). helmet CORP relaxed to `same-site` for same-origin streaming.

### OHIF configuration (ohif/app-config.js, mounted no-store)
- routerBasename `/viewer`; `defaultDataSourceName: dicomweb`; all three roots → `/api/dicom-web`
  (same-origin, `requestOptions.withCredentials: true` so the session cookie is sent on every request).
- `imageRendering/thumbnailRendering: wadors`, `enableStudyLazyLoad: true`, `omitQuotationForMultipartRequest:
  true` (Orthanc 1.13 compat), `maxNumberOfWebWorkers: 3`, prefetch limits. **No `oidc` key** (an empty
  `oidc:[]` crashes the OIDC route in v3.13 — omitting it disables OIDC cleanly).

### Test data (synthetic volumes, real geometry — generated via scratchpad/gen_volume.py)
- Patient VIEWERVOL01 (GGH) + 3 CT orders → C-STORE → ingest matched to GGH org:
  **CT CHEST VOLUME (300 slices)**, **CT CHEST PRIOR (150, same patient → comparison)**,
  **CT WHOLE BODY LARGE (2000 slices)**. 256×256 int16 HU pixels, correct ImagePositionPatient /
  PixelSpacing / SliceThickness / RescaleIntercept so MPR and W/L presets are genuinely meaningful.

### Verified (all real DICOM, in-browser via Playwright)
- OHIF renders our synthetic CT (axial); series thumbnail + 3-study list; patient context.
- **MPR real**: 3 orthogonal viewports; coronal/sagittal show the volume's sinusoidal bone-ring
  cross-section — only possible by true 3D resampling. (screenshot 16)
- Layouts 1×1/1×2/2×2/3×3 + Custom; W/L **CT presets** apply to HU pixels (Bone 2500/480 verified). (15,17)
- Large 2000-slice study renders; **first image 1635 ms**, progressive load (~191/2000 frames in 12s,
  30.3 MB of ~256 MB), JS heap 235 MB — no full-study download. (18)
- **Security**: 401 without token; rad_tcl (other org) sees 0 studies + 403 on a GGH study by UID;
  Orthanc creds never in browser; audit logs VIEWER_SESSION_OPEN / VIEWER_STUDY_OPEN /
  VIEWER_STUDY_ACCESS_DENIED.
- **Playwright 4/4 pass** (tests/viewer.spec.ts): auth, org isolation, WADO pixel stream, worklist→OHIF→MPR.
- **Infra**: OHIF container restart OK; backend recreation to a NEW IP (172.22.0.3→.10) with no nginx
  restart → 10/10 200 (Phase-5 DNS fix intact). All 8 services healthy.
- **Phases 1-5 intact**: health/worklist/MWL/PACS endpoints 200; MWL SCP :4243 up; search_tsv GIN
  index present; backend unit 34/34 pass; Orthanc + volumes + DB records untouched.

### Keyboard shortcuts (OHIF v3.13 defaults)
- Scroll images: mouse wheel / arrow keys. Zoom: right-drag (or Zoom tool). Pan: middle-drag (or Pan tool).
- Window/Level: left-drag with W/L tool. Reset: toolbar Reset View. Invert: `i`. Rotate: toolbar.
- Cine: play control in the viewport. Measurements: select Length/annotation tool then drag.

### Screenshots (docs/screenshots/)
14-ohif-viewer-axial · 15-ohif-layouts · 16-ohif-mpr · 17-ohif-ct-presets · 18-ohif-large-study

### Remaining limitations
- 6600-image load not performed (benchmarked honestly at 2000 slices; extrapolation only).
- Some image-manipulation / measurement tools available but not each individually click-verified.
- No custom hanging protocol authored (OHIF defaults). Orthanc stable-study ingest delay ~60-90s.
- 4 pre-Phase-6 orphan studies have NULL org (Phase 4 reconciliation) → invisible to org-scoped
  radiologists by design; newly ingested studies receive the correct org.

---

## Phase 7 — Radiology Reporting Engine ✅ COMPLETE (2026-11-14)

### Database changes (additive migration 0006_phase7_reporting — zero destructive statements)
- Reused existing `Report / ReportTemplate / ReportVersion / ReportSignature` (Phase 1 scaffold).
- Report: +`parentReportId` (addendum self-relation), `comparison`, `organizationId` (isolation),
  `reportType` (MAIN|ADDENDUM), `version`, `preliminaryAt/finalizedAt/signedAt`.
- ReportTemplate: +`code`, `organizationId`, `technique`, `bodyRecommendations`.
- ReportVersion: +`reason`. ReportSignature: +`reportVersion`, `method`, `verification`.
- New `report_macros` table (Module 9). **search_tsv GIN preserved** (Unsupported() fix still holds).

### API endpoints
- Reports: `POST /reports`, `GET /reports/:id`, `GET /reports/study/:studyId`, `PATCH /reports/:id`,
  `POST /reports/:id/{preliminary,finalize,sign,addendum}`, `GET /reports/:id/versions`,
  `GET /reports/:id/pdf`.
- Templates: `GET/POST /report-templates`, `GET/PATCH /report-templates/:id`, `PATCH /:id/active`.
- Macros: `GET/POST /report-macros`, `PATCH/DELETE /report-macros/:id`.
- Reporting worklist: `GET /reporting-worklist`, `GET /reporting-worklist/counts`.
- Permissions added: `report.view`, `report.download` (+ existing create/edit/preliminary/finalize/
  sign/amend, template.manage). AuthService gained `verifyUserPassword` for sign step-up.

### Architecture / decisions (user-approved)
- **Addendum = separate linked Report row** (reportType ADDENDUM, parentReportId) → original FINAL
  report stays byte-for-byte immutable.
- **Signature = password step-up re-auth + SHA-256 hash** over content+signer+server-time+version;
  locks the report; labeled "authenticated electronic approval", NOT a legal e-signature.
- **PDF = server-side** (pdfkit 0.20.2, pinned) behind the authenticated, org-isolated, audited API.
- **Voice dictation = local browser Web Speech API**, opt-in, OFF by default, pluggable engine
  (honest: browser speech may use an OS/cloud engine, so no PHI leaves without the user starting it).
- Lifecycle transitions are server-enforced and transactional; each writes a monotonic ReportVersion
  snapshot (fixed a unique-constraint bug by allocating `max(version)+1` for every snapshot).

### Frontend
- Report Editor (`/reports/study/:studyId`, `/reports/:id`): 10 sections, auto-populate, auto-save
  with status, lifecycle buttons, sign dialog (password step-up), macros, dictation, versions,
  signature block, addenda, "Open in Viewer", PDF. Reporting Worklist (`/reporting`) with buckets +
  filters. Report Templates admin (`/admin/report-templates`). RIS worklist "Report" button wired.

### Tests (synthetic data)
- **18/18** API lifecycle + negative tests (create/template-seed/edit/preliminary/finalize/
  wrong-pw-401/sign/locked-immutable-409/re-sign-409/versions/addendum/original-unchanged/
  parent-link/PDF/cross-org-403).
- **Playwright 7/7** (4 viewer + 3 reporting: lifecycle+immutability+addendum+pdf, org isolation,
  worklist buckets). Browser walkthrough of the full acceptance flow captured (screenshots 19-23).
- Backend unit 34/34. Phases 1-6 intact (endpoints 200, MWL :4243, viewer, DICOMweb, search_tsv GIN).

### Final acceptance (15 steps) — PASSED
worklist → (viewer) → report editor → template → findings/impression → Draft (auto-save) →
Preliminary → Finalize → authenticate+sign → lock → PDF → version history → addendum →
original signed report unchanged. Verified via API (18/18), Playwright (7/7), and live browser.

### Screenshots (docs/screenshots/) + sample
19-reporting-worklist · 20-report-editor-draft · 21-report-sign-dialog · 22-report-signed-locked ·
23-report-history-signature. Sample PDF: docs/sample_report.pdf.

### Remaining limitations
- Macros: insert-from-list in the editor; a dedicated macro-admin screen is deferred (thin add).
- Department-level isolation: org isolation is hard-enforced; department is a scoping attribute on
  templates/macros, not a per-report wall.
- Dictation accuracy depends on the browser's speech engine (OS/cloud); self-hosted engine pluggable.
- Structured measurements from the viewer are an integration point only (no auto-annotation claims).

---

## Phase 8 — Notifications, Audit & Operational Management ✅ COMPLETE (2026-11-14)

### Database (additive migration 0007_phase8_ops — zero DROP TABLE/COLUMN; DB backed up first)
- New tables: `system_alerts`, `service_health_checks`, `background_job_records`,
  `notification_delivery_attempts`.
- `notifications` enriched (+org, roleKey, category, priority, link, patient/order/study/report refs,
  readAt, archived, dedupKey unique, expiresAt; legacy `type` kept + made nullable — no data loss).
- `audit_logs` +organizationId/username/status, **backfilled** from the user join (171/180 rows).
- **search_tsv GIN index intact.**

### Modules
- **A/B Notifications**: central `NotificationsService` (dedup, user + role fan-out, never throws into
  a clinical tx), REST API (list/unread-count/read/read-all/archive/delete), bell+badge+dropdown in
  header + Notification Centre page. **Socket.IO gateway** `/ws/notifications` (JWT handshake,
  per-user/org rooms, no global broadcast, reconnect) + 20s polling fallback; nginx `/socket.io/` proxied.
- **C Event integration**: ingest (new/orphan/fail), reports (preliminary/final/signed/addendum),
  orders (assign/cancel) — all after the successful DB tx.
- **D Audit**: viewer + filters + CSV export (formula-injection safe, 10k cap, audited). Append-only
  preserved; audit.view/export perms; org isolation.
- **E Monitoring**: real app-level health for all 8 services (query/PING/HTTP/TCP, not "container
  running"); org-scoped metrics dashboard.
- **F Alerts**: raise(dedup)/acknowledge/resolve + auto-recovery after N consecutive healthy checks
  (default 3, recorded as SYSTEM); audit trail; CRITICAL prominent.
- **G Jobs**: `@nestjs/schedule` in-process (NO 9th service) + Redis locks + `background_job_records`;
  HEALTHCHECK(60s)/ALERT_EVAL/NOTIF_CLEANUP(hourly).

### RBAC
Added notification.view/manage, audit.export, system.dashboard.view, system.health.view,
system.alert.view/acknowledge/resolve, system.jobs.view/manage; assigned to roles; enforced server-side.

### Services / deps
No new Docker service (stays at 8). Added `@nestjs/schedule@4.1.2`, `socket.io-client@4.8.1` (pinned).
New shared `RedisModule`. nginx gained a `/socket.io/` location (dynamic-DNS pattern).

### Tests
- Backend unit **44/44** (+10 Phase 8: notification dedup/isolation/fan-out/non-throwing, alert lifecycle).
- Playwright **12/12** (viewer 4 + reporting 3 + ops 5).
- API-verified: notification from assign event, org isolation, dedup, read flow, audit export perms,
  alert ack→resolve, real 8-service health, dashboard metrics.
- Regression Phases 1-7 all 200; data preserved (5007 studies/5 reports/243 audit); GIN intact.
- nginx dynamic-DNS re-verified (backend new IP, 0× 502); no credential leak in /auth/me.
- Screenshots 24-28. Docs: PHASE8_CHECKLIST / _ARCHITECTURE / _API / _TEST_RESULTS.

### Known limitations
- No external (email) notification sender (in-app + socket only). Audit PDF export not implemented
  (CSV only). Event-driven infra alerts beyond DICOM-ingest failure are modeled but not all wired.

---

## Phase 9 — Performance, Security & Reliability Engineering ✅ COMPLETE (2026-11-14)

Assess-and-strengthen phase. No build of new features. All 10 stages executed safe-by-default;
unsafe tests recorded as NOT TESTED (never PASS). All existing data/volumes/services preserved.

### Stages & docs
- Stage 1 Baseline → `docs/PHASE9_BASELINE.md` (reads <60ms, login ~180ms argon2id).
- Stage 2 Performance → `docs/PHASE9_PERFORMANCE.md`. EXPLAIN plans healthy, no index needed.
- Stage 3 Load (k6 throwaway container, 20 VUs) → `docs/PHASE9_TEST_RESULTS.md` (3168 reqs, 0 errors,
  read p95 160ms, scripts in `tests/load/`).
- Stage 4 Security → `docs/PHASE9_SECURITY_ASSESSMENT.md` (no CRITICAL/HIGH).
- Stage 5 DICOM security → same doc §G.
- Stage 6 Backup/restore → `docs/PHASE9_BACKUP_RESTORE.md` (isolated PG restore 3s, 0 errors, all match).
- Stage 7 Failure/recovery → `docs/PHASE9_FAILURE_RECOVERY.md` (all 5 services + dynamic DNS recover).
- Stage 8 Clinical → `docs/PHASE9_CLINICAL_VALIDATION.md` (Playwright 12/12, unit 44/44).
- Stage 9 Logging → log rotation added; no secrets in logs.
- Stage 10 → `docs/PHASE9_CHECKLIST.md`, `docs/PHASE9_TEST_RESULTS.md`.

### Findings fixed + retested
PERF-1 (QIDO double-scan 205→146ms) · REL-1 (telemetry 7-day prune) · SEC-2 (CORS allow-list) ·
SEC-3 (HSTS behind HTTPS only) · SEC-4 (SPA security headers) · REL-3 (notification cross-org
fan-out — role fan-out now requires concrete org) · LOG-1 (Docker log rotation 10m×5).

### Documented (not changed — would affect modality connectivity / behavior)
SEC-1 (traversal not exploitable) · SEC-6 (DICOM ports 0.0.0.0) · DICOM-SEC-1 (C-STORE any calling AE) ·
REL-2 (Redis maxmemory) · rate-limiting. TLS-ready config: `nginx/nginx-tls.conf.example`.

### Code/config changes (all additive, non-destructive)
`backend/src/dicomweb/dicomweb.service.ts` (QIDO single-scan), `ops.scheduler.ts` (telemetry prune),
`main.ts` (CORS allow-list + HSTS gate), `nginx/nginx.conf` (SPA headers + socket.io already),
`notifications.service.ts` (org-scoped fan-out + recipientScope), `docker-compose.yml` (log rotation
anchor). No DB migration needed. search_tsv GIN preserved.

### Verification
All 8 services healthy; 15/15 endpoint groups 200; MWL :4243 + C-STORE :4242 up; studies 5010,
reports 7, signatures 2 intact, audit 1396 append-only, GIN present; dynamic DNS 0× 502;
no credential leak. DB backups in `backups/`. **Not production-ready on tests alone** (documented).

### NOT TESTED (honest)
6600-instance DICOM stress; write-path load; high-concurrency C-STORE/MWL; full live Orthanc restore
spin-up; multi-service/disk-full/OOM failure; concurrent-edit conflict UI. See PHASE9_CHECKLIST.

---

## PACS Operations — Module 1: DICOM Reverse Push ✅ COMPLETE (2026-11-14)

First PACS Operations module (Part B). Real PACS-to-PACS C-STORE transfer. No new Docker service.

### Engine (user-approved): Orthanc native C-STORE SCU
Backend orchestrates Orthanc's built-in SCU — `PUT /modalities/{id}` (register), `POST /echo` (real
C-ECHO test), `POST /store` (async C-STORE), poll `/jobs/{id}` to terminal. A job is COMPLETED only
when Orthanc reports the store succeeded (destination acknowledged). Real DICOM, no simulation.

### Database (additive migration 0008_pacs_reverse_push; search_tsv GIN preserved; DB backed up first)
PacsDestination, DicomTransferJob (7 states, counts, timing, speed, retry, idempotency), DicomTransferInstance
(per-instance status, unique jobId+SOP). Permissions pacs.reverse-push.view/manage, pacs.destination.manage.

### Backend (backend/src/pacs/)
reverse-push.service (destinations CRUD + C-ECHO test + SSRF guard; job lifecycle create/pause/resume/
cancel/retry; Orthanc-native executor with restart-recovery reconciliation; monitor aggregate),
reverse-push.controller (/api/pacs/destinations/*, /api/pacs/reverse-push/*), reverse-push.scheduler
(@Interval 5s + Redis lock). OrthancService extended (findStudyByUid, putModality, echoModality,
storeToModality, getJob, getStudyInstanceDetails). Notifications + audit on job events.

### Frontend
ReversePush page (MONITOR/DESTINATIONS/JOBS tabs, create-destination + push-study modals, job detail
with per-instance status, controls). Nav under PACS. Screenshots 29-30.

### Tests (synthetic; THROWAWAY destination Orthanc, verified on RECEIVER)
Full E2E: C-ECHO ack → push 150-instance study → COMPLETED 150/150 → **destination has 150 instances,
StudyInstanceUID matches**. Large: 2000-instance → destination 2000. Negative: SSRF blocked (400),
active-dup (409), cancel, org isolation (403), permissions (403), invalid dest (graceful), restart
recovery (stuck→COMPLETED). Playwright 4/4 module + 12/12 full; unit 44/44. Source Orthanc untouched
(2489 instances), GIN present, volumes preserved, 8 services healthy.

### Docs
REVERSE_PUSH_{ARCHITECTURE,GUIDE,API,TEST_RESULTS,CHECKLIST}.md.

### Known limitations
Forced partial-failure/rejected-C-STORE NOT TESTED (needs a rejecting destination; retry path built).
Multi-study batch selection UI = enhancement (one study/job). Transfer speed is an estimate.

---

## PACS Operations — Module 2: Archive Compression ✅ COMPLETE (2026-11-14)

Verified, lossless, copy-only study archives. No new Docker service (one additive volume).

### Format (user-approved): Orthanc study ZIP + backend gzip
Pull study via Orthanc `GET /studies/{id}/archive` (native lossless ZIP, PK magic, originals
untouched) → gzip-wrap at configurable level (0–9) → `.zip.gz` on the archive volume. Container
compression, NOT DICOM transfer-syntax recompression.

### Storage + workers
New named volume **`pacs_archive`** at `/var/lib/pacs/archive` (additive compose change). gzip runs in
a Node **worker_thread** (archive.worker.ts → .js) off the event loop; configurable pool
(ARCHIVE_WORKERS). Scheduler (@Interval 6s) + Redis lock dispatches jobs.

### Database (additive migration 0009_pacs_archive; GIN preserved; DB backed up first)
ArchiveJob (status PENDING/QUEUED/RUNNING/COMPLETED/VERIFIED/FAILED/CANCELLED, level, workerCount,
originalBytes/compressedBytes/ratio/savings, sha256, archivePath, verified, idempotency, org, createdBy).
Config in system_settings['archive.config']. Perms pacs.archive.view/manage (pacs_admin, org_admin, super_admin).

### Backend (backend/src/pacs/)
archive.service (config, job lifecycle, worker-thread gzip + SHA-256, auto-verify = re-hash + gunzip +
ZIP entry count, restore/extract, interrupted-job recovery, no-overwrite-verified guard, monitor),
archive.controller (/api/pacs/archive/*), archive.scheduler (recovery OUTSIDE lock + exec under lock),
archive.worker (worker_thread gzip+hash).

### Frontend
ArchiveManagement page (MONITOR/JOBS/CONFIG tabs, archive-study + job-detail modals, verify/restore
controls). Nav under PACS. Screenshots 31-32.

### Tests (synthetic; independently verified on disk)
Real compression (25.45%/25.57% savings), **sha256sum on disk == DB record**, independent extraction
(300 DICOM files recovered), **originals untouched** (Orthanc 2489 instances), manual verify, restore
(copy-only), **no-overwrite-verified → FAILED**, cancellation, **interrupted-job recovery** (restart
mid-job → re-queued → VERIFIED), org isolation 403, permissions 403. Playwright 4/4 module + 20/20
full; unit 44/44. GIN present, signatures intact, volumes preserved, 8 services.

### Docs
PACS_ARCHIVE_{ARCHITECTURE,GUIDE,API,TEST_RESULTS,CHECKLIST}.md.

### Known limitations
Modest ratio on already-compressed DICOM (depends on source transfer syntax). Restore extracts
server-side for inspection (no Orthanc re-import — separate future workflow). One job at a time
(scheduler-serialized). Copy-only; automatic source deletion OUT OF SCOPE. 6600-instance stress NOT TESTED.

---

## PACS Operations — Module 3: Storage Management ✅ COMPLETE (2026-11-15)

Real-data storage-management dashboard. **Read-only over the data plane** — never deletes, migrates,
or modifies DICOM/archives; never resets PostgreSQL; never touches a volume's contents. No new Docker
service (one additive table).

### Measurement (all real, no mock)
Orthanc `/statistics` (TotalDiskSize + patient/study/series/instance counts) + per-study
`/studies/{id}/statistics` `DiskSize` for modality-wise bytes (RIS modality × Orthanc bytes);
archive bytes via recursive walk of the `pacs_archive` volume; disk total/used/avail via
`fs.statfsSync(ARCHIVE_ROOT)`. Verified: dashboard orthanc.bytes == live Orthanc 324202939;
disk 118.2 GB / 1006.9 GB = 11.7%.

### Snapshots, growth, forecast
`storage_snapshots` persisted daily at 01:00 (StorageScheduler, Redis lock per day) + on demand
(admin). Dashboard serves a fresh snapshot (<10 min) else computes live. Growth = linear fit over the
disk-used series (daily/monthly); forecast = days-until each threshold (70/80/90/95%) with a basis
string; <2 snapshots → note, never a fabricated number.

### Alerts (Phase 8 integration)
`evaluateAlerts` picks the highest crossed threshold → `AlertsService.raise('storage:disk:utilization')`
+ `NotificationsService.create` (pacs_admin, deduped per level/day, link /pacs/storage); auto-recovers
below threshold. Reuses existing alert-key dedup + auto-recover; no new alert system.

### Database (additive migration 0010_pacs_storage; GIN preserved)
StorageSnapshot (capturedAt, orthancBytes, archiveBytes, diskTotal/Used/Avail, patients/studies/
series/instances, modalityBreakdown Json). Thresholds in system_settings['storage.config'].
Perms pacs.storage.view/manage (super_admin, pacs_admin, org_admin).

### Backend (backend/src/pacs/)
storage.service (config, real measurement, captureSnapshot + evaluateAlerts, dashboard, growth/
forecast, history, CSV export with formula-injection guard + audit, triggerSnapshot),
storage.controller (/api/pacs/storage/*), storage.scheduler (@Cron 01:00 daily, Redis-locked).
orthanc.service gained getStudyStatistics().

### Frontend
StorageManagement page (OVERVIEW/MODALITY/GROWTH/HISTORY/CONFIG tabs, capacity gauges, modality
table, growth+forecast, history+CSV export, thresholds editor; polls 15s). Nav under PACS.
Screenshots 33 (dashboard) / 34 (modality) / 35 (growth).

### Tests (synthetic; verified against live Orthanc/filesystem)
Measurement checks S1–S10 PASS; threshold crossing raises Phase 8 alert+notification and auto-recovers;
CSV audited; permissions + org isolation 403. Playwright 8/8 module + **28/28 full**; backend unit
**44/44** (throwaway devDeps container). Protections re-verified: Orthanc 2489/10 unchanged, signatures
intact, GIN present, no volume/DICOM/archive touched.

### Docs
PACS_STORAGE_{ARCHITECTURE,GUIDE,API,TEST_RESULTS,CHECKLIST}.md.

### Known limitations
Monitoring only — freeing space is always a manual, out-of-band operation (no auto-migration/deletion
by design). Forecast is linear (no seasonality). Modality bytes depend on RIS study.modality being set
(unset → "OTHER"). Dev-environment functional verification, not a production-readiness certification.

---

## PACS Operations — Module 4: Transfer & Archive History ✅ COMPLETE (2026-11-15)

Unified **read-only** reporting over Module 1 (reverse-push) + Module 2 (archive) records. No new
engine, **no migration**, no new permission, no new Docker service.

### Approach
Service-layer union (Approach A): query the two existing job tables per request, normalize to a common
OperationRow, merge/sort/paginate per-source; dashboard via count/groupBy/_sum. Rejected a DB UNION
view and a materialized table (both add migration + duplication, against reuse/avoid-migration rules).

### RBAC (no new permission)
Routes carry no @RequirePermissions (global guard is AND-only); service requires EITHER
pacs.reverse-push.view OR pacs.archive.view and returns only the caller's visible source(s). Patient
MRN gated by patient.view; archive path gated by pacs.archive.manage. Org isolation throughout.

### Data (all real)
Reverse-push from DicomTransferJob(+instances,+destination); archive from ArchiveJob. Patient MRN +
modality joined from RIS Study→Patient (job tables don't store them). No duplicate counting (sources
disjoint). Verified EXACT vs raw SQL: rp=6, ar=4, originalBytes=5337596, compressedBytes=3973504.

### Non-mutating re-verify (per approval clarification)
POST .../archive/:id/verify re-hashes + re-extracts via new ArchiveService.inspectIntegrity (reuses
Module 2 verifyFile) and compares to stored sha256, but modifies NO job/verification record and NO
archive file — only writes an OPS_HISTORY_ARCHIVE_REVERIFY audit event. Proven: archive_jobs=4 /
verified=2 unchanged after re-verify tests.

### Backend (backend/src/pacs/)
operations-history.service.ts (visibleSources/requireAnySource/canSeePatient/orgWhere, studyLookup
batched join, normalize{Transfer,Archive}Job, list/listReversePush/listArchive, dashboard,
{reversePush,archive}Detail, reverifyArchive, exportCsv ×4 kinds formula-injection-safe+audited),
operations-history.controller.ts (/api/pacs/operations/history/*). archive.service.ts +inspectIntegrity.

### Frontend
OperationsHistory page (DASHBOARD/UNIFIED/REVERSE PUSH/ARCHIVE tabs, date ranges, filter panel, status
badges, sortable paginated table, detail drawer with instance-level results / archive sha256+re-verify,
CSV export). Nav regrouped into new "PACS Operations" section (Reverse Push Monitor, Archive
Compression, Storage Management, Transfer & Archive History). Screenshots 36-38.

### Tests
tests/operations-history.spec.ts 14/14 (per-source filter, MRN redaction, no-dup-count, date edges,
pagination/sort, CSV+injection, org-iso, non-mutating re-verify, Modules 1/2/3 still 200, UI). Full
Playwright 42/42; backend unit 44/44. Accuracy EXACT vs raw SQL. Protections re-verified: Orthanc
2489/10 unchanged, sigs 3, GIN present, no volume/DICOM/archive touched.

### Test fixtures
Two code-map test roles (test_rp_only, test_ar_only) + users ophist_rp/ophist_ar so per-source
visibility + patient redaction are provable with real JWTs. Assigned to no production user.
tools/testdata/seed_ops_history_testusers.sql (additive, idempotent).

### Docs
PACS_OPERATIONS_HISTORY_{ARCHITECTURE,GUIDE,API,TEST_RESULTS,CHECKLIST}.md.

### Known limitations
Reporting only (no deletion/migration by design). Linear/exact reads; multi-million-row stress NOT
TESTED (covered by pagination + 10k export cap). Modality/MRN depend on Study.modality / linked Patient.

## PACS Operations — Module 5: Operational Integration ✅ COMPLETE (2026-11-16, subject to final verification)

Read-only **composition** layer making Modules 1–4 behave as one platform. **No migration, no new
table, no new Docker service, no new permission, no new production user.** One additive notification
emit (integrity-failure) via the existing `NotificationsService`.

### Delivered
- **Command Centre** (`/pacs/operations/command-centre`, `GET /api/pacs/operations/overview`): permission-
  gated tiles for reverse-push, archive, storage, service health (8 services), open/critical alerts,
  recent activity. 15s refresh. Totals reconciled to Module 4's dashboard (single source of truth).
- **Per-study aggregate** (`GET /api/pacs/operations/history/study/:uid`, added to Module 4's service):
  identity, transfer + archive history, latest integrity, study storage (live Orthanc), summary counts.
  UID validated (bad→400), cross-org→404 (no existence leak), source-RBAC + patient gating.
- **Study Operations bridge**: "Operations" button in the RIS worklist opens a drawer backed by the
  aggregate; where authorized, launches the **existing** reverse-push create-job workflow (reused API).
- **Exceptions Console** (`/pacs/operations/exceptions`, `GET /api/pacs/operations/exceptions`):
  CONFIRMED / HEURISTIC / INFRASTRUCTURE classification; recovery via **existing** endpoints only
  (retry/cancel/verify/ack), shown only when `canRecover`; interrupted = non-mutating 1h-staleness
  heuristic.
- **Notification gap-closure**: `ArchiveService.verifyJob()` emits one deduped HIGH `pacs_admin`
  org-scoped notification on on-demand integrity-verification failure (`integrity-fail:<jobId>:<day>`);
  success emits none; existing archive-done/reverse-push-done notifications unchanged.

### Backend / frontend
- Backend: `operational-integration.{service,controller}.ts` (new, in `pacs.module.ts`);
  `operations-history.{service,controller}.ts` +`studyOperations` + `study/:uid` route;
  `archive.service.ts` +one integrity-failure notification.
- Frontend: `OperationalCommandCentre.tsx`, `OperationsExceptions.tsx`, `StudyOperationsDrawer.tsx`
  (new); `Worklist.tsx` (+Operations button); `App.tsx` (2 routes); `Layout.tsx` (2 nav entries).

### Tests (actual, executed 2026-11-16)
- Backend Jest **44/44** (11 suites). Full Playwright **70/70** (28 Module 5 + 42 existing). Backend
  `tsc` clean; frontend production build passes. DICOM C-STORE :4242 + MWL :4243 reachable.
- Accuracy EXACT vs raw SQL (overview + study aggregate). Non-mutation + no-leak + dedup proven.
- Screenshots 39 (command centre) · 40 (exceptions) · 41 (exceptions view-only) · 42 (study ops) ·
  43 (study ops empty).

### Preservation re-verified
Orthanc 2489 instances / 10 studies / 6 patients unchanged; archive 4 real (2 verified) + 1 synthetic-
test; transfer 6 real + 3 synthetic-test; 5010 studies; 3 signatures; 2545 audit rows; GIN present;
**10 migrations (no Module 5 migration)**; 8 services healthy; NGINX resolver `127.0.0.11` intact.

### Docs
PACS_OPERATIONAL_INTEGRATION_{ARCHITECTURE,API,GUIDE,TEST_RESULTS,CHECKLIST}.md.

### Known limitations / NOT TESTED
Reporting + composition only (no new engine). Interrupted-job heuristic uses a fixed 1h threshold.
NOT TESTED: 6,600-instance stress; two **populated** organizations; full Orthanc restore spin-up;
recovery-action load; multi-million-row scale. This is dev-environment functional verification, **not**
a production-readiness certification.

---

## Overall status (2026-11-16)
- **PACS/RIS Phases 1–9:** COMPLETE.
- **PACS Operations Modules 1–4:** COMPLETE.
- **PACS Operations Module 5:** COMPLETE, subject to final verification/acceptance.

### Outstanding production-readiness work & risks (carried from Phase 9 + Module 5)
- TLS not enabled (config-ready). Orthanc accepts any calling AE. DICOM ports bound 0.0.0.0. Redis
  maxmemory unbounded. No global rate limiting. Off-host backups not configured. Full Orthanc restore
  spin-up NOT TESTED. 6,600-instance stress NOT TESTED. Two populated orgs NOT TESTED. Interrupted-job
  heuristic uses a fixed 1h threshold. See PACS_OPERATIONAL_INTEGRATION_TEST_RESULTS.md and the Phase 9
  docs. None of these are silently resolved — each is a production-deployment decision or an outstanding/
  not-tested item.

## Next: awaiting review. Do NOT begin a new module or Phase 10 without explicit approval.

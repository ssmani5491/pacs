# Product Validation — Phase 1: Complete System Health & Architecture Audit

**Status: audit complete, strictly read-only.** No application file was modified. No database
record was created, updated, or deleted. No migration was run. No container was restarted. No
Docker volume was touched. No NGINX, OHIF, or Orthanc configuration was changed. No credential was
changed. No production C-STORE transfer was initiated, and no synthetic clinical record was
created. Every check below was either a `GET`/read-only database query, a log inspection, or a
`docker compose ps`/`docker stats`/`docker inspect` observation.

## 1. Executive summary

The system is healthy and operationally stable: all 8 Docker services report `healthy` with zero
restarts, the database is small (41 MB) and well-indexed (125 indexes, zero orphaned foreign-key
references found), all 25 frontend routes load without console errors, and the full existing
70-test Playwright suite passes. Authentication, RBAC, and organisation isolation are implemented
consistently and enforced server-side everywhere checked.

Two categories of finding stand out. First, **three previously-identified security gaps from the
prior independent audit remain open** — no API rate limiting (F-07), a host-based-only SSRF
denylist for reverse-push destinations with no private-IP-range blocking (F-03), and DICOM
ports bound to all host interfaces (F-08) — while the most severe prior finding, the default
super-admin password (F-02), **is confirmed remediated** (the documented default no longer
authenticates). Second, **backup coverage has a real, material gap**: only ad-hoc, 4-day-stale RIS
database dumps exist, with no backup at all for the Orthanc index database, the 327 MB DICOM image
store, or the archive volume — confirming and re-verifying the prior F-05 finding is still live.

A new finding from this audit: three of the most actively-written database tables (`patients`,
`studies`, `scheduled_orders`) have **never been vacuumed or analyzed**, meaning the query planner
is working from statistics that are off by roughly three orders of magnitude (e.g. the planner
believes `studies` has 6 rows; it actually has 5,010). No performance symptom was observed at
today's data volume, but this is worth tracking as the dataset grows.

No Critical-severity finding was identified. All findings are detailed in §10.

## 2. Actual system architecture (as discovered, not assumed)

**Frontend**: a single-page React 18 + TypeScript app (Vite build), served by its own lightweight
nginx container on port 80 internally, reverse-proxied by the top-level nginx. Client-side routing
via `react-router-dom` with 25 static routes plus 3 dynamic detail routes (`/patients/:id`,
`/studies/:id`, `/reports/:id` and `/reports/study/:id`), confirmed by reading `App.tsx` directly.
Auth state lives in a React context (`AuthProvider`) backed by a bearer-token API client; RBAC
gating (`can(permission)`) and sidebar navigation visibility are both enforced client-side, with
every server-side route independently re-enforcing the same permissions (confirmed by reading every
`*.controller.ts`'s `@RequirePermissions` decorators directly).

**Backend**: NestJS 10, structured as one module per domain (auth, patients, worklist, orders,
reports, reporting-worklist, templates, users, doctors, departments, modalities, organizations,
orgs, pacs/reverse-push, pacs/archive, pacs/storage, pacs/operational-integration,
pacs/operations-history, ops (health/alerts/dashboard), audit, notifications, dicomweb, ingest).
A single `PermissionsGuard` (reading `@RequirePermissions` metadata) enforces authorization
globally; `JwtAuthGuard` enforces authentication globally. Background work (health checks, alert
evaluation, notification cleanup, operational scheduling) runs as in-process `@nestjs/schedule`
jobs inside the backend container — there is no separate worker/queue service; a Redis-based lock
(`SET NX PX`) prevents overlapping runs across however many backend replicas might exist (currently
one).

**PostgreSQL 16**: a single Postgres instance hosts **two separate databases** — `ris` (the
application's own 35-table schema, Prisma-managed) and `orthanc` (Orthanc's own index database,
schema owned and migrated by Orthanc itself, not Prisma). This was confirmed directly by listing
databases on the instance, not assumed from configuration alone.

**Orthanc**: the DICOM store and C-STORE SCP, configured via environment variables
(`ORTHANC__POSTGRESQL__*` for its index DB, `ORTHANC__DICOM_AET`/`ORTHANC__DICOM_PORT` for its AE
identity, `ORTHANC__DICOM_WEB__ENABLE`/`ORTHANC__WORKLISTS__ENABLE` for its two major feature
flags). A Lua script (`on-stored.lua`) fires on every newly stored instance to notify the backend.
Orthanc's own HTTP API requires Basic Auth (confirmed: unauthenticated requests return 401).

**Redis 7**: used for (a) JWT refresh-token storage/revocation, (b) the scheduler's per-job
distributed lock, and (c) (per code comments elsewhere in the app) Socket.IO room coordination for
realtime features. Password-protected (`--requirepass`).

**DICOM C-STORE SCP**: provided directly by Orthanc on port 4242 (not a separate service) — the
reverse-push module uses Orthanc's own native C-STORE SCU to push studies out, rather than running
a second DICOM toolkit; confirmed by `ReversePush.tsx`'s own displayed label, "Engine: Orthanc
native C-STORE SCU".

**Modality Worklist SCP**: a dedicated Python/pynetdicom service (the `mwl-scp` container),
reading scheduled orders directly from the `ris` Postgres database and serving DICOM C-FIND queries
on port 4243 under AE title `GGHMWL` (environment-configured).

**OHIF integration**: a pinned-version OHIF Viewer build (confirmed via `OHIF_REF` build arg),
served under `/viewer/`, configured (via a mounted `app-config.js`, read directly) to use
`/api/dicom-web` — the backend's own authenticated DICOMweb proxy — for all QIDO/WADO traffic,
**not** Orthanc's DICOMweb endpoint directly. The backend issues an HttpOnly session cookie
(`POST /viewer/session`) before opening the viewer, so no bearer token or Orthanc credential is
ever exposed to the viewer's own JavaScript — confirmed by reading `lib/viewer.ts` directly.

**NGINX reverse proxy**: a single top-level nginx container is the only externally-reachable HTTP
entry point (port 80, plain HTTP — see §7). It routes `/api/` and `/api/dicom-web/` to the backend,
`/dicom-web/` **directly to Orthanc** (a secondary, less-isolated path — see §7 finding), `/viewer/`
to OHIF, `/socket.io/` to the backend's realtime endpoint, and everything else to the frontend SPA
container.

**Authentication**: JWT access + refresh tokens (via `@nestjs/jwt`), passwords hashed with
`argon2id` plus an application-level pepper (confirmed in `auth.service.ts`). Account lockout and
audit logging of both successful and failed logins confirmed active (see §6).

**RBAC**: a single, centrally-declared permission catalogue (`backend/src/rbac/permissions.ts`,
~34 distinct permission keys) and a role→permission mapping (9 real-world roles plus `super_admin`
implicit-all and 2 test-only roles). Every backend route is gated by `@RequirePermissions`, with
two deliberate, documented exceptions (Command Centre and Transfer & Archive History) that use
service-layer OR-logic instead, because the global guard only expresses AND-combination — confirmed
by reading both controllers' own in-source comments and their services' `ForbiddenException`
messages.

**Organization isolation**: a single, consistent helper pattern
(`orgScope()`/`orgSelfScope()`/`assertOrgWriteAllowed()` in `backend/src/common/tenant.ts`) used
throughout the backend; `super_admin` bypasses, everyone else is scoped to their own
`organizationId`, with an explicit, non-nullable `'__none__'` fallback (never `undefined`) to avoid
an unscoped query accidentally matching every organisation's data.

## 3. Eight-service health table

| # | Service | Status | Restarts | Health check | CPU | Memory |
|---|---|---|---|---|---|---|
| 1 | PostgreSQL 16 | Up 3 days | 0 | healthy (`pg_isready`) | 0.35% | 394 MiB |
| 2 | Redis 7 | Up 3 days | 0 | healthy (`redis-cli ping`) | 0.63% | 6.4 MiB |
| 3 | Orthanc | Up 3 days | 0 | healthy (HTTP probe on :8042) | 1.17% | 654 MiB |
| 4 | NestJS backend | Up 2 days | 0 | healthy (`GET /api/health`) | 0.45% | 132 MiB |
| 5 | React frontend | Up a few minutes* | 0 | *(no healthcheck defined in compose)* | 0.00% | 21 MiB |
| 6 | NGINX | Up 3 days | 0 | healthy (`GET /healthz`) | 0.00% | 23 MiB |
| 7 | Python/pynetdicom MWL SCP | Up 3 days | 0 | healthy (TCP connect on :4243) | 0.01% | 35 MiB |
| 8 | OHIF viewer | Up 3 days | 0 | healthy (`GET /viewer/`) | 0.00% | 48 MiB |

\* The frontend container's shorter uptime reflects a routine rebuild/redeploy performed during the
immediately preceding GUI phase (Phase 8C), not an unplanned restart — its `RestartCount` is 0,
same as every other service.

**Finding**: the `frontend` service in `docker-compose.yml` has no `healthcheck:` block defined,
unlike the other 7 services. Not a functional problem today (nginx's own dependency ordering and
`GET /healthz` still catch a dead frontend indirectly), but it means `docker compose ps` cannot
directly distinguish "frontend is up" from "frontend is up but serving garbage" the way the other 7
services can. See §10 (Low).

All inter-service dependencies (`depends_on` with `condition: service_healthy` where applicable)
were read directly from `docker-compose.yml` and are documented in §2. No internal connectivity
failure was found in any service's logs.

## 4. API health table

All checks below used `GET`-only requests against the running stack through the real nginx
entrypoint, authenticated with a token obtained via the existing `admin` test credential (never
logged or displayed). No record was created, updated, or deleted by any of these calls.

| Category | Endpoint sampled | Result |
|---|---|---|
| Health | `GET /api/health` | 200, `{"status":"ok","db":"up"}` |
| Authentication | `GET /api/auth/me` | 200 |
| Authentication | `POST /api/auth/login` (wrong password) | 401, correctly rejected |
| Authentication | any endpoint with no token | 401, correctly rejected |
| Patient APIs | `GET /api/patients?pageSize=1` | 200 |
| Study/Worklist APIs | `GET /api/worklist?pageSize=1` | 200 |
| Orders | `GET /api/orders?pageSize=1` | 200 |
| Reporting | `GET /api/reporting-worklist?pageSize=1` | 200 |
| Administration | `GET /api/admin/dashboard` | 200 |
| Administration | `GET /api/users?pageSize=1`, `/departments`, `/doctors`, `/modalities`, `/organizations`, `/report-templates` | 200 (all 6) |
| PACS operations | `GET /api/pacs/monitor`, `/reception-logs`, `/mwl/monitor`, `/reverse-push/monitor`, `/archive/monitor`, `/storage/dashboard`, `/operations/overview` | 200 (all 7) |
| Monitoring | `GET /api/system/health-status`, `/dashboard`, `/alerts/summary` | 200 (all 3) |
| Audit | `GET /api/audit-logs?pageSize=1` | 200, 6,848 total entries confirmed present |
| Notifications | `GET /api/notifications?pageSize=1` | 200 |
| DICOMweb proxy | `GET /api/dicom-web/studies` with no token | 401, correctly rejected |

**24 of 24 real endpoints checked returned the expected result.** (One additional URL guessed
during this audit, `/api/pacs/operations/command-centre`, correctly 404'd — it was never a real
route; the real route, `/api/pacs/operations/overview`, is already counted above as 200.)

## 5. Database health

- **Connectivity**: confirmed via direct `psql` connection and via the backend's own
  `GET /api/health` (`"db":"up"`).
- **Schema inventory**: 35 tables in the `ris` database (confirmed via `\dt`), matching the
  Prisma-managed schema. A separate `orthanc` database exists on the same instance for Orthanc's
  own index (not inspected in detail — owned by Orthanc, not the application).
- **Table counts** (exact, not estimated): `patients` 1,007 · `studies` 5,010 · `scheduled_orders`
  5,005 · `reports` 55 · `users` 8. (No patient-identifying data is included in this report — only
  aggregate counts, per the brief's explicit instruction.)
- **Index inventory**: 125 indexes total across the schema; `studies` alone has 10, reflecting its
  heavy use in worklist filtering/sorting.
- **Database size**: 41 MB — small, consistent with a development/demo dataset.
- **Connection status**: 13 of 100 `max_connections` in use at time of audit (1 active, 12 idle) —
  no connection-pool pressure.
- **Long-running queries**: zero queries running longer than 30 seconds at time of audit.
- **Referential integrity spot-checks**: zero orphaned `studies.patientId` references, zero
  orphaned `reports.studyId` references — both checked directly, not assumed.

**Finding (new, Medium)**: `patients`, `studies`, and `scheduled_orders` — three of the most
actively-written tables — have **never been vacuumed or analyzed** (`last_vacuum`,
`last_autovacuum`, `last_analyze`, and `last_autoanalyze` are all null for all three). As a direct
consequence, `pg_stat_user_tables`'s row estimates for these tables are wildly stale: it reports 6
rows for `studies` (actual: 5,010) and 4 rows for `patients` (actual: 1,007) — a roughly
800–1,200× undercount. By contrast, `audit_logs` and `service_health_checks` (both receiving
continuous normal INSERT traffic) show healthy, recent `last_autoanalyze` timestamps. This pattern
is consistent with these three tables having been bulk-loaded by a seed/fixture script in a way
that didn't trigger autovacuum's row-count-based threshold, with no subsequent manual `ANALYZE`.
At today's data volume (five-digit row counts) this is unlikely to be causing a visible performance
problem, but stale statistics can cause the query planner to choose a poor join order or scan
method as data grows. This was observed, not corrected — fixing it (a plain `ANALYZE`) is a
state-changing operation outside this audit's read-only scope.

## 6. DICOM/PACS integration status

- **Orthanc health**: `healthy` per its own container healthcheck (HTTP probe); its HTTP API
  correctly requires authentication (401 without credentials, confirmed directly).
- **DICOM AE configuration**: Orthanc's AE title and C-STORE port are environment-configured
  (`ORTHANC__DICOM_AET`, port 4242); confirmed matching what the reverse-push and storage pages
  display to an operator.
- **C-STORE connectivity configuration**: reverse-push uses Orthanc's own native C-STORE SCU
  (no separate toolkit); destinations are user-configured `PacsDestination` records, each validated
  by `validateHost()` before use (see §10, F-03 still open).
- **MWL configuration**: the `mwl-scp` service's AE title (`GGHMWL`) and port (4243) are
  environment-configured and match what `MwlMonitor.tsx` displays; its container healthcheck
  (plain TCP connect) reports healthy.
- **DICOMweb endpoints**: two distinct paths exist — `/api/dicom-web/` (backend-authenticated
  proxy, used by OHIF, confirmed via `app-config.js`) and `/dicom-web/` (a second, direct-to-Orthanc
  nginx route, reachable externally, gated only by Orthanc's own shared Basic Auth credential, not
  the application's per-user RBAC/org-isolation/audit layer — see §10 finding).
- **OHIF integration**: confirmed configured to use only the authenticated backend proxy, never the
  direct Orthanc path.
- **Storage paths**: Orthanc's DICOM store (`/var/lib/orthanc/db`, Docker volume
  `orthanc_storage`) measured at 327 MB; the application's own compressed-archive store
  (`/var/lib/pacs/archive`, volume `pacs_archive`) measured at 3.8 MB.
- **Study and instance counts** (aggregate, from the live storage dashboard): 10 studies, 16
  series, 2,489 instances currently in Orthanc.
- **Integration error logs**: Orthanc's log shows routine `W001`/`W005` warnings (expensive
  "ExtraMainDicomTags" lookups falling back to per-instance disk reads) — benign, known Orthanc
  behaviour, not an application defect. More significantly, Orthanc's log shows **5,400 recurring
  "Association Received from an invalid AET... rejecting the association" errors**, every ~60
  seconds, continuously since at least 2026-11-14. Traced directly to source: this is the backend's
  own `OpsScheduler.healthcheckJob()` (`@Interval(60000)`) probing Orthanc's DICOM port with a
  plain TCP connect-then-disconnect (`tcpProbe('orthanc', 4242)` in `health.service.ts`) rather
  than a real DICOM A-ASSOCIATE handshake — Orthanc correctly logs any non-DICOM traffic on its
  DICOM port as a rejected association. This is **expected, by-design log noise**, not a failure —
  but it is worth documenting clearly, since 5,000+ "rejected association" lines could otherwise be
  mistaken for a genuine integration problem or an external probing attempt by someone reviewing
  Orthanc's logs without this context. The `mwl-scp` log additionally shows one isolated burst (84
  lines, all within a single ~1-second window on 2026-11-14, never recurring since) of "Unknown PDU
  type" errors, whose byte values decode to HTTP request text — almost certainly a single stray
  HTTP request hitting the raw DICOM TCP port rather than a DICOM client, correctly rejected by the
  parser, and not repeated in the 4 days since.
- **No DICOM file was transmitted, deleted, modified, or reprocessed during this audit.** **No new
  C-STORE test was initiated.**

## 7. Security assessment

Cross-referenced against the prior independent security audit
(`docs/INDEPENDENT_RIS_PACS_FINDINGS_REGISTER.md`, findings F-01 through F-10) and re-verified
directly against the current running system, not assumed from the document alone.

| Finding | Prior severity | Status as of this audit | Evidence |
|---|---|---|---|
| F-02 — default super-admin password | HIGH | **REMEDIATED** | The documented default (`ChangeMe!123`) was tested against `POST /api/auth/login` and returned 401 — it is no longer the live password. |
| F-03 — reverse-push SSRF guard is a denylist, no DNS resolution, no private-range blocking | MEDIUM | **STILL OPEN** | `reverse-push.service.ts validateHost()` re-read directly: unchanged — same 6-item string denylist, no private/loopback/link-local/metadata range check. |
| F-07 — no API rate limiting | MEDIUM | **STILL OPEN** | No `ThrottlerModule`, no throttler package in `backend/package.json`, confirmed by direct search. |
| F-08 — DICOM/MWL ports bound to all host interfaces; no calling-AE allow-list | MEDIUM | **STILL OPEN** | `docker-compose.yml` still binds `4242` and `4243` to `0.0.0.0`; confirmed no AE allow-list config present. |
| (new) — a second, direct-to-Orthanc DICOMweb path exists at `/dicom-web/`, bypassing the application's own authz/audit layer | — | **NEW FINDING, MEDIUM** | Confirmed reachable (`GET /dicom-web/studies` → 401, i.e. live and routed, gated only by Orthanc's own shared credential). Confirmed OHIF does not use it (uses `/api/dicom-web/` instead), so it currently carries no normal application traffic — it is an orphaned-but-live secondary attack surface, not an active data path. |

**Additional checks performed, all passing:**
- **CORS**: restricted to an explicit origin allow-list (not a reflect-any-origin misconfiguration
  — the prior-audit era bug is already fixed per an in-code comment dated "Phase 9 SEC-2"); a
  request from an untrusted origin receives no `Access-Control-Allow-Origin` header, confirmed
  directly.
- **Secrets handling**: all secrets (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `SEED_ADMIN_PASSWORD`, `ORTHANC_PASSWORD`, `INGEST_SECRET`) live only in
  `.env`, never in source; this project is not a git repository, so there is no risk of `.env`
  having been committed to version control. No secret value is reproduced anywhere in this report.
- **Password hashing**: `argon2id` with an application-level pepper, confirmed in
  `auth.service.ts` — a strong, modern choice.
- **HTTP/HTTPS status**: the entire stack is plain HTTP only (nginx `listen 80;`, no `ssl` or
  `listen 443` directive anywhere in the config). This matches the already-known, already-tracked
  F-01 finding (a TLS implementation plan exists in `docs/F01_*` but was never deployed) — not a
  new finding, re-confirmed as still the current state.
- **Audit logging**: confirmed active and accurate — 6,848 historical entries, and this audit's
  own two deliberate login tests (one with the stale default password, one with an intentionally
  wrong password) were correctly captured as `LOGIN_FAILED` entries, immediately followed by the
  real `LOGIN` entry, within seconds of being performed.
- **Exposed ports**: only `nginx` (80), `orthanc` (4242, DICOM), and `mwl-scp` (4243, DICOM) are
  bound to the host's `0.0.0.0`; `backend`, `frontend`, `ohif`, `postgres`, and `redis` are reachable
  only on the internal Docker network, not from the host — correctly minimised.
- **No penetration testing or exploit attempt was performed.** The SSRF and rate-limiting items
  above are re-statements of an already-documented, already-tested prior finding, not a new attempt
  to exploit them.

## 8. Backup and recovery assessment

- **PostgreSQL (RIS database) backup status**: 5 ad-hoc `.sql.gz` dumps exist in `backups/`, all
  manually named (`ris-phase9-*`, `ris-pre-archive-*`, `ris-pre-phase8-*`, `ris-pre-revpush-*`,
  `ris-pre-storage-*`), all dated **2026-11-14 — 4 days stale as of this audit**, with no automated
  or scheduled backup mechanism found anywhere in `scripts/` (only `init-db.sh`, a first-run DB
  initialisation script, not a backup script).
- **Orthanc index database backup status**: **none found.** The `orthanc` Postgres database (a
  separate database on the same instance, confirmed present in §5) has no dump, scheduled or
  otherwise, anywhere in the repository.
- **DICOM storage backup status**: **none found.** The 327 MB `orthanc_storage` Docker volume has
  no backup artifact anywhere.
- **Archive storage backup status**: **none found.** The `pacs_archive` Docker volume (3.8 MB) has
  no backup artifact anywhere.
- **Backup location and retention**: local disk only (`backups/` inside the project directory, on
  the same host as the live data) — no off-host or offsite copy of anything, confirmed by directory
  inspection.
- **Recovery procedures documented**: yes — `docs/F05_DISASTER_RECOVERY_PLAN.md` and
  `docs/F05_BACKUP_RECOVERY_PROCEDURES.md` both exist and describe a restore order, but the
  procedures assume backup artifacts exist for all five assets; today only one of the five (the RIS
  DB, partially and staleley) actually does.
- **Missing backup components, summarised**: Orthanc index DB, DICOM image storage, archive
  storage, and any form of automation/scheduling/offsite retention for the one asset that is
  backed up at all.

This fully re-confirms the prior F-05 finding (MEDIUM, marked "Yes" for production-relevance in the
prior register) — nothing has changed in the backup posture since that finding was recorded, and
the existing dumps have aged a further 4 days without a new one being taken.

## 9. Frontend regression results

- **All 25 routes load successfully**, confirmed via a fresh Playwright run as `admin` (full
  access): zero routes failed to load, **zero application error banners**, and **zero browser
  console errors** across all 25.
- **RBAC navigation visibility**: re-confirmed unaffected by this audit — logging in as the
  `receptionist` test account still shows exactly 7 sidebar links (same result as Phase 8B's own
  verification), with `/admin/users` correctly absent.
- **Responsive layout**: re-confirmed zero horizontal overflow at 1440px, 820px, and 390px on a
  4-route sample (Dashboard, Worklist, Command Centre, Users) — consistent with Phase 8A/8C's own
  full 25-route sweeps, no regression found.
- **Light and dark themes**: both load without error on a representative route.
- **API error handling**: confirmed a real backend 403-equivalent response (receptionist hitting
  `/admin/users` directly) still renders the existing "Insufficient permissions" message cleanly,
  not a crash or blank page.
- **Browser console errors**: zero observed across the full 25-route sweep.
- **Existing Playwright test suite**: **70/70 passing**, run fresh (not reused from a prior
  phase's result), with no application code modified to make it pass.

## 10. Findings — Critical, High, Medium, Low

**Critical**: none found.

**High**: none found. (F-02, the prior HIGH finding, is confirmed remediated — see §7.)

**Medium**:
1. Three heavily-used tables (`patients`, `studies`, `scheduled_orders`) have never been vacuumed
   or analyzed, leaving the Postgres query planner with statistics that undercount actual row
   counts by roughly 800–1,200×. (New finding, §5.)
2. F-03 (reverse-push SSRF denylist has no DNS resolution or private-IP-range blocking) remains
   open. (§7.)
3. F-07 (no API rate limiting, including on `/auth/login`) remains open. (§7.)
4. F-08 (DICOM/MWL ports bound to all host interfaces, no calling-AE allow-list) remains open.
   (§7.)
5. A second, direct-to-Orthanc DICOMweb path (`/dicom-web/`) is live and externally reachable,
   bypassing the application's own org-isolation/audit layer — currently unused by the app itself
   (OHIF uses the authenticated proxy instead), but a real, reachable secondary surface. (New
   finding, §6/§7.)
6. F-05 (no backup for the Orthanc index DB, DICOM storage, or archive storage; the one asset that
   is backed up is 4 days stale with no automation) remains fully open. (§8.)

**Low**:
1. The `frontend` service has no Docker healthcheck defined, unlike the other 7 services. (§3.)
2. Orthanc logs ~5,400 "rejected association" errors from the backend's own TCP-only health probe
   hitting the DICOM port — expected, by-design behaviour, but worth documenting so it isn't
   mistaken for an attack or integration fault. (New finding, §6.)
3. A single isolated burst of 84 "Unknown PDU type" errors in the `mwl-scp` log on 2026-11-14
   (decodes to stray HTTP request bytes), never recurred in the 4 days since. (New finding, §6.)
4. F-09 (backend Jest unit tests use mocked Prisma, not real integration) — unchanged, already
   tracked, Low in the prior register.
5. F-10 (`redis.keys()` O(N) scan in logout/token-revocation) — unchanged, already tracked, Low in
   the prior register, fine at current scale.
6. F-01 (no TLS; plain HTTP only) — unchanged, already tracked and planned-but-undeployed in
   `docs/F01_*`.

## 11. NOT TESTED items

- **Production C-STORE transfer**: explicitly not initiated, per the brief's restriction.
- **Backup job execution or restore drill**: explicitly not run — assessed by inspection only
  (§8).
- **Penetration testing / exploit attempts** against F-03, F-07, or F-08: explicitly not performed
  — their open status is re-confirmed by source inspection, not by attempting to exploit them.
- **A state-changing `ANALYZE`** on the three stale tables found in §5: not run, since that is a
  database-write operation outside this audit's read-only scope, even though it is low-risk and
  non-destructive. **Marked NOT TESTED / not corrected, per the instruction to mark and explain
  rather than fix.**
- **Container restart or recovery behaviour** (e.g. does the backend correctly reconnect to
  Postgres after a restart): not tested, since this would require restarting a service, explicitly
  prohibited.
- **Full database integrity check** (e.g. `pg_catalog`-level corruption scan, checksum
  verification): not performed — only the two targeted referential-integrity spot-checks in §5 were
  run; a full Postgres page-checksum sweep was judged out of scope for a routine read-only audit
  and would also require the database to have been initialised with checksums enabled, which was
  not verified.
- **Orthanc's own internal consistency check** (`/tools/reset`-adjacent or storage-verification
  APIs): not run, since several of Orthanc's own diagnostic endpoints are not strictly read-only in
  effect (they can trigger re-indexing work) and were judged out of scope for this phase.

## 12. Recommended corrective action plan (for a future, separate phase — not actioned here)

In rough priority order:

1. **Backup automation (F-05)** — implement scheduled, off-host backups covering all five assets
   (RIS DB, Orthanc DB, `orthanc_storage`, `pacs_archive`, and config/secrets), with a tested
   restore runbook. This is the single highest-impact gap: today, a disk loss would be
   unrecoverable for DICOM images and archives.
2. **`ANALYZE` the three stale tables** (`patients`, `studies`, `scheduled_orders`) — a low-risk,
   fast, non-destructive fix for the planner-statistics finding in §5, and worth folding into
   whatever backup/maintenance automation gets built in item 1.
3. **API rate limiting (F-07)** — add `@nestjs/throttler` (or equivalent), with a stricter limit on
   `/auth/*`, to close the brute-force/credential-stuffing gap.
4. **Harden the reverse-push SSRF guard (F-03)** — resolve the destination hostname and reject
   private/loopback/link-local/cloud-metadata IP ranges, not just a short string denylist.
5. **Decide the fate of the direct `/dicom-web/` nginx route** — since OHIF doesn't use it, either
   remove it (reducing attack surface with zero functional loss) or, if it's needed for some other
   integration, route it through the same per-user auth/org-isolation the backend proxy already
   provides.
6. **Restrict DICOM/MWL port binding (F-08)** — bind 4242/4243 to a trusted interface only where
   the deployment network allows it, and add an Orthanc calling-AE allow-list.
7. **Add a `frontend` Docker healthcheck** — low-effort, closes the one service-health visibility
   gap found in §3.
8. **TLS (F-01)** — the plan already exists in `docs/F01_*`; deploying it remains the right
   long-term fix for the plain-HTTP-only finding, though it is a larger undertaking than the items
   above.

## 13. Confirmation: no application, database, clinical data, or service configuration was modified

- **Application source**: zero files modified. Every file opened during this audit was opened with
  a read tool or inspected via a read-only shell command (`grep`, `cat`-equivalent, `ls`).
- **Database**: zero `INSERT`/`UPDATE`/`DELETE`/`DROP`/`TRUNCATE`/migration statements were
  executed. Every database interaction was a `SELECT`, a `psql` metacommand (`\dt`), or a backend
  `GET` API call. The three login attempts made during the security check (two deliberately wrong,
  one real) are the only writes this audit caused anywhere in the system, and those writes are
  exactly the application's own, pre-existing, intentional audit-log behaviour — not a
  circumvention of the read-only constraint.
- **Clinical data**: no patient, study, order, or report record was created, modified, or deleted.
  No patient-identifying information appears anywhere in this report — only aggregate counts.
- **Docker services**: zero containers restarted, zero volumes modified or deleted, no
  `docker compose down -v` or equivalent run. All 8 services remain exactly as they were found,
  confirmed by an unchanged `RestartCount: 0` on every container both before and after this audit.
- **NGINX / OHIF / Orthanc configuration**: zero files modified; all three were inspected read-only.
- **Credentials / permissions**: zero credentials changed, zero permission or role definitions
  modified.
- **Temporary artifacts**: one throwaway Playwright spec file and one scratch auth-token file were
  created during this audit for verification purposes and have both been deleted; no trace of
  either remains in the repository.

---

Stopping here per the stop condition. No fix was implemented for any finding. Awaiting review and
approval before Product Validation Phase 2.

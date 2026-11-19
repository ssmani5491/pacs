# Implementation Roadmap & Task Checklist

Phases follow the brief. Each phase ends runnable + tested before the next starts.
Status keys: [ ] todo · [~] in progress · [x] done · [!] blocked/needs input.

## PHASE 1 — Foundation  (scaffold, DB, auth, RBAC, Docker)
- [ ] Monorepo scaffold (backend NestJS, frontend Vite, docker-compose, nginx, .env.example)
- [ ] docker compose: postgres, redis, orthanc, backend, frontend, nginx — all healthchecks green
- [ ] Prisma schema v1 (orgs, departments, users, roles, permissions, join tables, audit_logs, system_settings) + first migration
- [ ] Auth: login/logout, JWT access+refresh (rotating), password hash (argon2id), failed-login tracking, session expiry
- [ ] RBAC guard + org/department row scoping
- [ ] Seed: super admin + GG Hospital org + synthetic users
- [ ] Tests: auth + RBAC unit/integration green

## PHASE 2 — Org structure  (org, dept, doctor, user, modality admin)
- [ ] CRUD: organizations, departments (+ job types), doctors, users (role assignment)
- [ ] Modality registration (AE title, host, port, type, dept/org, active) + "test connection"
- [ ] Admin UI screens matching confirmed Pixray nav (Org Type, Create Org, Create Dept, Doctor Profile, New Modality)
- [ ] Tests

## PHASE 3 — Patients, orders, RIS worklist
- [ ] Patient model + registration + search + history + duplicate detect/merge (audited)
- [ ] Scheduled orders (accession gen, procedure, modality, dept, ref physician, schedule)
- [ ] **Worklist** API: all confirmed filters + columns + server-side pagination/sort (target 50k+ rows)
- [ ] Worklist UI: search panel, modality checkboxes, status tabs, date quick-ranges, My Assignment, row actions
- [ ] Postgres indexes + tsvector for report-content search
- [ ] Tests: worklist perf with 50k synthetic studies

## PHASE 4 — Orthanc + DICOM C-STORE
- [ ] Orthanc configured (PostgreSQL + DICOMweb plugins, FS storage, AE title, port)
- [ ] Ingest worker: OnStoredInstance → upsert study/series/instance into ris DB, match patient/order, reconcile orphans, dedupe SOP UID
- [ ] Failed-transfer + reception audit logging
- [ ] Tests: send synthetic study via dcmtk `storescu` → appears in worklist

## PHASE 5 — Modality Worklist (MWL SCP)
- [ ] scheduled_orders → MWL (.wl generation or worklist plugin)
- [ ] Tests: dcmtk `findscu`/pynetdicom MWL query returns the order

## PHASE 6 — OHIF viewer  (highest-risk, prototype early)
- [ ] OHIF configured against our DICOMweb; launch from worklist row
- [ ] Verify tools: zoom/pan/W-L/presets/measure/layouts/MPR/cine/metadata
- [ ] **Large-study test: 5k–6.6k images** — lazy/progressive load, no browser crash
- [ ] Prior-study comparison + synced scroll
- [ ] Tests: viewer loads a large synthetic CT

## PHASE 7 — Reporting
- [ ] Report model + versions + signatures; lifecycle Ready→Draft→Preliminary→Final; lock; addendum
- [ ] Rich-text editor, sections (history/technique/findings/impression/recommendation), auto-save
- [ ] Templates (modality/department/normal/custom) — Report Template admin
- [ ] PDF generation + print; Report Cancel + Locked Reports admin
- [ ] Strict lifecycle permissions; finalised reports immutable (addendum only)
- [ ] Tests: full report lifecycle + "cannot overwrite final"

## PHASE 8 — Audit, notifications, system admin
- [ ] Audit log coverage (login, access, view, report actions, config, deletions) + search, append-only
- [ ] WebSocket notifications (new study, pending, assignment, prelim/final, failed transfer)
- [ ] System admin: DICOM/DB/storage/modality status, sessions, health, error logs

## PHASE 9 — Performance + security
- [ ] Load test 50k studies + large series; index tuning; background jobs
- [ ] Security pass: authz tests, injection/XSS/CSRF, rate limits, secrets hygiene
- [ ] Backup/restore scripts + docs

## PHASE 10 — E2E, docs, deploy
- [ ] Full E2E: patient→order→MWL→C-STORE→worklist→OHIF→report Draft→Prelim→Final→locked→audit verified
- [ ] All docs (README, ARCHITECTURE, DATABASE_SCHEMA, API, DICOM_CONFIG, OHIF_CONFIG, DEPLOYMENT, USER, ADMIN, TESTING, SECURITY)
- [ ] `docker compose up -d --build` clean on a fresh machine

## Gating input needed before/within phases
- [!] Phase 2/3: real Pixray field lists + role names (User, Modality, Org, Dept, Doctor screens)
- [!] Phase 6: confirm viewer toolset Pixray exposes (else build OHIF standard + document)
- [!] Phase 7: confirm report sections/templates + whether dictation is used
- [!] Any migration of real patient data: explicit written authorisation (not in scope now)

# Architecture — RIS + PACS Replica (clean-room)

## 1. High-level shape

```
                         ┌───────────────────────────────────────────┐
  Modalities (CT/MR/CR)  │                 NGINX                      │
   DICOM C-STORE  ─────┐  │  (TLS term, reverse proxy, static assets) │
   DICOM MWL Q   ───┐  │  └───────────────┬───────────────┬───────────┘
                    │  │                  │               │
                    │  │          ┌───────▼──────┐  ┌──────▼───────┐
                    │  │          │  Frontend     │  │   Backend    │
                    │  │          │  React+Vite   │  │  NestJS API  │
                    │  │          │  + OHIF app   │  │  REST + WS   │
                    │  │          └───────┬───────┘  └──┬───────┬───┘
                    │  │                  │ DICOMweb     │ SQL   │ jobs
                    │  │                  │ (QIDO/WADO)  │       │
            ┌───────▼──▼──────┐    ┌──────▼──────┐  ┌────▼────┐ ┌▼──────┐
            │  Orthanc        │    │   (browser) │  │Postgres │ │ Redis │
            │  C-STORE SCP    │    └─────────────┘  └─────────┘ └───────┘
            │  DICOMweb       │          ▲
            │  + Postgres idx │          │ WADO-RS pixels
            │  + FS storage   │──────────┘
            └───────┬─────────┘
                    │ DICOM files
            ┌───────▼─────────┐
            │  Storage        │  local FS → NAS → (future) object store
            └─────────────────┘
```

Separate **MWL SCP** service (Orthanc worklist plugin or a small DCMTK/pydicom-based SCP)
serves scheduled orders the NestJS backend writes.

## 2. Division of responsibility (important design decision)

- **Orthanc owns pixels + DICOM protocol.** C-STORE receive, DICOMweb (QIDO/WADO/STOW),
  C-FIND/C-MOVE, transfer-syntax handling, file storage. We do NOT re-implement a DICOM
  stack. Orthanc writes its own index to its Postgres; we never parse its storage files.
- **NestJS owns the RIS.** Users, roles, orgs, departments, doctors, orders/MWL data,
  worklist query, report lifecycle, templates, audit, notifications, settings.
- **The link between them:** when Orthanc receives a study, it fires an *OnStoredInstance*
  change → a lightweight ingest worker (NestJS job) reads study metadata via Orthanc's REST
  API and upserts `studies/series/instances` rows in OUR Postgres, matching to patient/order.
  This keeps the worklist fast (query our indexed tables, not Orthanc) while Orthanc stays the
  image source of truth. **Decision: worklist reads our DB; viewer reads Orthanc DICOMweb.**
- **Two Postgres databases** (same server, separate DBs): `orthanc` (managed by Orthanc) and
  `ris` (managed by Prisma). Never cross-write.

## 3. Stack (accepting the brief, with notes)

| Layer | Choice | Note |
| --- | --- | --- |
| Frontend | React + TS + Vite + Tailwind | enterprise shell; OHIF embedded/linked for viewing |
| Viewer | OHIF Viewer + Cornerstone3D | configured against our Orthanc DICOMweb; not rebuilt |
| Backend | NestJS (Node 24 LTS) | modular, REST + WS (Socket.IO), JWT + refresh, RBAC guards |
| ORM/DB | Prisma + PostgreSQL 16 | `ris` DB; UUID PKs; migrations checked in |
| DICOM archive | Orthanc (+ PostgreSQL plugin, DICOMweb plugin) | C-STORE, DICOMweb |
| MWL | Orthanc worklist plugin **or** sidecar MWL SCP | we generate `.wl` / serve from `scheduled_orders` |
| Cache/queue | Redis + BullMQ | ingest jobs, notifications, heavy exports |
| Proxy | NGINX | routes `/`, `/api`, `/dicom-web`, `/ohif` |
| Runtime | Docker Compose | one `docker compose up -d --build` |

**One deviation flagged:** the brief's SessionStart Vercel notes are irrelevant here — this is a
**self-hosted, offline hospital deployment**. No Vercel/cloud. Everything in Docker on-prem. Keeping it.

## 4. Repository layout

```
pacs-replica/
├─ docker-compose.yml
├─ .env.example
├─ nginx/            nginx.conf
├─ orthanc/          orthanc.json, worklist/ (generated .wl), plugins config
├─ backend/          NestJS
│  ├─ prisma/        schema.prisma, migrations/
│  └─ src/
│     ├─ auth/ rbac/ users/ orgs/ departments/ doctors/
│     ├─ modalities/ orders/ worklist/ studies/ ingest/
│     ├─ reports/ templates/ audit/ notifications/ settings/
│     └─ dicom/      orthanc client, mwl writer
├─ frontend/         React+Vite enterprise app (shell, worklist, admin, reporting)
├─ ohif/             OHIF config (data source → our DICOMweb)
├─ seed/             synthetic patients, orders, DICOM test sets
├─ tests/            e2e (Playwright) + DICOM client scripts (dcmtk/pynetdicom)
└─ docs/             all .md deliverables
```

## 5. Data isolation / multi-tenancy

- Every tenant-scoped table carries `organization_id` (and `department_id` where relevant).
- RBAC guard + a Prisma middleware that injects an org filter for non-super roles.
- Super Admin sees all; Org Admin sees their org; Department roles scoped further.

## 6. Security posture (on-prem)

- Argon2id password hashing; JWT access (short) + refresh (rotating, revocable in Redis).
- RBAC on every route; org/department row filtering.
- Audit log is append-only (no UPDATE/DELETE grant for the app role; separate admin path).
- Input validation (class-validator/Zod), parameterised queries via Prisma, Helmet, CORS lockdown,
  rate limiting. TLS at NGINX. Encryption-at-rest = OS/disk-level (documented), not a compliance claim.
- **We do not claim HIPAA/GDPR/regulatory compliance** — we provide the controls; certification is separate.

## 7. Technical risks (ranked)

1. **Viewer performance on 5k–6.6k-image studies** — must use DICOMweb progressive/lazy loading,
   Cornerstone3D volume loading, and web workers. Highest risk; prototype early (Phase 6).
2. **MWL correctness** — modalities are fussy; real-device testing needed. Mitigate with pynetdicom/dcmtk MWL tests.
3. **Ingest matching** — orphan studies (we saw a raw-UID row) need a reconciliation workflow.
4. **Orphan/duplicate SOP handling** — dedupe on SOP Instance UID at ingest.
5. **Report full-text search** at 48k+ studies — Postgres `tsvector` + GIN index.
6. **Data migration from live Pixray** — out of scope until explicitly authorised; synthetic data only for now.
7. **Scale**: 50k+ studies, large series — indexing + server-side pagination from day one.

## 8. Hardware (for the full self-hosted stack, synthetic-data dev → small-site prod)

| Use | CPU | RAM | Disk | Notes |
| --- | --- | --- | --- | --- |
| Dev (your machine) | 4–8 cores | 16 GB (32 better) | 100 GB SSD | Docker Desktop; viewer eats RAM |
| Small prod site | 8+ cores | 32–64 GB | fast SSD for DB/Orthanc index + bulk store (NAS) for images; size images at ~20–150 MB/study × study volume | RAID/backup; Orthanc store grows fast |

## 9. Complexity estimate

**L–XL (a quarter+ of focused work for a production-grade system).** The RIS/admin/worklist/report
layer is standard full-stack (weeks). The DICOM receiver + MWL + a performant large-study viewer are
the XL parts. We de-risk by standing on Orthanc + OHIF rather than building DICOM/rendering from scratch,
and by building in the 10 phases the brief specifies, runnable at every step.

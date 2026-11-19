# Phase 9 — Baseline Report (2026-11-14)

Recorded before any Phase 9 optimization, on the live local stack. Synthetic data only.
This is the reference point for all later "measured impact" claims.

## Environment
- Host: Windows 11, Docker Desktop; ~15.5 GiB RAM available to Docker.
- 8 services, all `running`, **restart count = 0** for every container.
- `docker compose config` valid. All routes 200 (/api, /viewer, /dicom-web, /socket.io, /healthz).

## Infrastructure (idle, one-shot `docker stats`)
| Service | CPU | Memory |
|---|---|---|
| backend | 0.00% | 75 MiB |
| frontend | 0.00% | 21 MiB |
| mwl-scp | 0.02% | 35 MiB |
| nginx | 0.00% | 22 MiB |
| ohif | 0.00% | 22 MiB |
| orthanc | 1.6% | 546 MiB |
| postgres | 1.4% | 299 MiB |
| redis | 0.6% | 4 MiB |

## Storage
- Docker volumes: `pg_data` = **100.1 MB**, `redis_data` = 12 KB (+ orthanc_storage, app_logs).
- Postgres top tables (RIS): studies 4.2 MB, scheduled_orders 2.6 MB, series 2.0 MB, instances 1.2 MB,
  patients 608 kB, service_health_checks 440 kB, audit_logs 296 kB, notifications 144 kB.
- Orthanc: **2474 instances / 7 studies / 11 series / 4 patients, 309 MB** on disk.
- Redis: used_memory **1.13 MB** (peak 1.17 MB), **129 keys**, `maxmemory = 0` (unbounded),
  AOF disabled (RDB only), 11 changes since last save.

## Row counts (synthetic dataset)
studies 5007 · scheduled_orders 5005 · patients 1004 · series 5011 · instances 2474 ·
audit_logs 254 · notifications 4 · service_health_checks **1368 (growing +8/min)**.

## API response times (via nginx, admin, avg of 3)
| Endpoint | Avg |
|---|---|
| POST /auth/login | **179.6 ms** (argon2id hashing — intentionally slow, security) |
| GET /worklist (page 1) | 33.5 ms |
| GET /worklist (patient-name search) | 44.5 ms |
| GET /patients (search=PERF) | 29.0 ms |
| GET /orders | 26.9 ms |
| GET /reporting-worklist | 27.0 ms |
| GET /reporting-worklist/counts (6 count queries) | 27.5 ms |
| GET /notifications | 19.3 ms |
| GET /audit-logs | 20.4 ms |
| GET /system/dashboard | 40.0 ms |
| GET /system/health-status (cached) | 56.0 ms |

All read endpoints are well under 60 ms at this data volume. Login is the only slow call and that is
by design (password hashing). No endpoint is a performance concern at baseline scale.

## DICOM / DICOMweb / viewer
| Operation | Baseline |
|---|---|
| QIDO /studies — direct Orthanc (basic auth) | 35.6 ms |
| QIDO /studies — via backend proxy (JWT, org-filtered) | **205.5 ms** |
| WADO metadata, 300-slice study — via proxy | 188.1 ms |
| OHIF first-image (300-slice, Phase 6 benchmark) | ~1635 ms (recorded Phase 6) |
| OHIF large study first-image (2000-slice, Phase 6) | ~1635 ms; progressive ~191/2000 frames in 12 s |
| MPR (300-slice) | real, works (Phase 6) |
| C-STORE (6 instances, Phase 4) | OK; Orthanc stable-study ingest delay ~60–90 s |
| MWL C-FIND | re-measured in Stage DICOM (all seed orders are COMPLETED → excluded) |

## Observations carried into later stages (candidate findings)
- **PERF-1 (MEDIUM)**: DICOMweb QIDO via the backend proxy is ~6× slower than direct Orthanc
  (205 ms vs 35 ms). The proxy fetches every org study from Postgres to build the org allow-set on
  each QIDO call; cost grows with the org's study count. See PHASE9_PERFORMANCE.md.
- **REL-1 (LOW)**: `service_health_checks` grows unbounded (+8/min); no pruning job. See
  PHASE9_PERFORMANCE / FAILURE_RECOVERY.
- **SEC-candidate**: Redis `maxmemory = 0` (no bound / eviction policy). Reviewed in security stage.

## Method notes
- Timings via `curl -w %{time_total}`, averaged over 3 runs, through nginx (realistic path).
- `docker stats --no-stream` for CPU/MEM; `docker system df -v` for volumes; `pg_*` catalog for table
  sizes; Orthanc `/statistics`; `redis-cli INFO`.
- No data modified; all reads. Baseline recorded before any change.

# Phase 9 — Failure & Recovery Testing (2026-11-14)

Controlled single-service restarts on the live stack (these recover cleanly and were safe to run).
Database-failure simulation was done via the isolated restore (Stage 6), **not** by stopping/
corrupting the live DB. No data lost; all 8 services healthy at the end.

| ID | Scenario | Recovery | Evidence |
|---|---|---|---|
| FR-1 | **Backend** restart | healthy in **21 s** | API 5/5 → 200 via nginx (no nginx restart); `/socket.io/` 200; scheduler resumed (fresh health-check row) |
| FR-2 | **Redis** restart | healthy | new login 200; **pre-restart refresh token still valid (200)** — RDB persisted; locks self-heal (PX TTL) |
| FR-3 | **Orthanc** restart | healthy | **studies before=10, after=10 (zero loss)**; DICOMweb recovers; C-STORE :4242 back up |
| FR-4 | **MWL SCP** restart | healthy | C-FIND association re-establishes (`GGHMWL` OK); **orders 5005 before=after (intact)** |
| FR-5 | **NGINX** restart | healthy | all routes recover: /healthz, /api/health, /viewer/, /socket.io/, /dicom-web(auth) all 200 |
| FR-6 | **Dynamic DNS** (backend → NEW IP, no nginx restart) | — | IP 172.22.0.3 → .10; **10/10 → 200, zero 502** |
| FR-7 | **Background jobs** after restarts | — | HEALTHCHECK job running ~60 s cadence, status SUCCESS; Redis-lock prevents overlap |

## Detection / recovery characteristics
- **Detection**: Docker healthchecks (10–15 s intervals) flag an unhealthy service; the in-app health
  scheduler (60 s) records service status and raises a SystemAlert after a service is DOWN, auto-
  recovering the alert after 3 consecutive healthy checks (Phase 8).
- **Recovery time** (this hardware): backend ~21 s, Redis/MWL/nginx a few seconds, Orthanc ~10–15 s.
- **Data loss**: none observed. Postgres/Orthanc are volume-backed; Redis state is either persisted
  (RDB) or safely rebuildable (re-login / idempotent job re-run).
- **Notification/alert behaviour**: a DOWN service raises a CRITICAL/HIGH SystemAlert (Phase 8);
  recovery auto-resolves it after sustained health. Verified functionally in Phase 8.

## Database failure — handled via isolated environment (not live)
Per the brief, the live database was **not** stopped or corrupted to simulate failure. Instead the
backup+restore into an isolated container (Stage 6) demonstrates full recoverability: 3 s restore,
0 errors, all counts + relationships + signatures + GIN index intact.

## NOT TESTED (recorded honestly)
- Simultaneous multi-service failure / full-node crash — **NOT TESTED** (single local node; would risk
  the working environment). Documented as a production DR-drill item.
- Disk-full / OOM conditions — **NOT TESTED** (would risk the live stack).
- Network partition between containers — **NOT TESTED** (dynamic-DNS recovery after an IP change is
  tested, which is the realistic Docker-restart case).

All services confirmed healthy after the full stage; live data preserved.

# Phase 9 — Checklist (2026-11-14)

Legend: [x] done/verified · [~] partial/documented · [NT] NOT TESTED (recorded honestly)

## Acceptance criteria (brief §13)
- [x] 1. Baseline metrics recorded (PHASE9_BASELINE.md)
- [x] 2. Database performance reviewed (EXPLAIN ANALYZE; plans healthy; no index needed)
- [x] 3. Backend performance measured (response times; PERF-1 fixed 205→146 ms)
- [x] 4. Frontend performance reviewed (server-side pagination, small bundle, OHIF isolated)
- [x] 5. Redis performance reviewed (1.1 MB, bounded keys; maxmemory documented)
- [x] 6. DICOM performance measured (baseline + Phase 6 benchmarks; 6600 stress = NT, see below)
- [x] 7. Concurrency testing at a documented safe load (k6, 20 VUs, 0 errors, read p95 160 ms)
- [x] 8. Authentication security tested (rotation, reuse-after-rotation, logout, lockout, JWT)
- [x] 9. RBAC + organization isolation tested (BOLA cross-org all 403/404; mass-assignment blocked)
- [x] 10. API security assessed (SQLi safe, validation, CORS/HSTS/headers fixed, error leakage safe)
- [x] 11. Secrets exposure checked (none in bundle/API/logs; env redacted in backups)
- [x] 12. DICOM security tested (unauthorized AE rejected, JWT matrix, duplicate dedup, orphan flow)
- [x] 13. PostgreSQL backup + isolated restoration validated (3 s, 0 errors, counts+FKs+GIN+sigs match)
- [~] 14. Orthanc backup + isolated restoration (PG index restore validated; full Orthanc spin-up
      documented, not run live on single node — see BACKUP_RESTORE)
- [x] 15. Controlled failure recovery tests pass (backend/redis/orthanc/mwl/nginx + dynamic DNS)
- [x] 16. Clinical workflow integrity tests pass (Playwright 12/12, unit 44/44, invariants)
- [x] 17. Phases 1–8 remain functional (all endpoints 200; MWL/C-STORE up)
- [x] 18. All existing data and Docker volumes preserved (5010 studies, 2 sigs, GIN present; volumes intact)
- [x] 19. NGINX dynamic DNS remains functional (backend new-IP, 0× 502)
- [x] 20. All reports/documentation completed (8 docs + PROGRESS)

## Findings fixed + retested
| ID | Sev | Area | Status |
|---|---|---|---|
| PERF-1 | MEDIUM | DICOMweb QIDO double-scan | FIXED (205→146 ms), isolation intact |
| REL-1 | LOW | Unbounded telemetry growth | FIXED (7-day prune) |
| SEC-2 | MEDIUM | CORS reflect-any-origin | FIXED (allow-list) |
| SEC-3 | LOW | HSTS on HTTP | FIXED (gated behind HTTPS) |
| SEC-4 | LOW | SPA missing security headers | FIXED (nginx CSP etc.) |
| REL-3 | MEDIUM | Notification cross-org fan-out | FIXED (org-scoped fan-out) |
| LOG-1 | LOW | Docker logs unbounded | FIXED (rotation 10m×5) |

## Findings documented (not changed — would affect required connectivity / behavior)
| ID | Sev | Note |
|---|---|---|
| SEC-1 | — | Path traversal confirmed NOT exploitable (hits SPA, not Orthanc) |
| SEC-6 | LOW | DICOM ports on 0.0.0.0 — needed for modalities; production = bind to modality VLAN |
| DICOM-SEC-1 | LOW | C-STORE SCP accepts any calling AE — production = Orthanc AE allow-list |
| REL-2 | INFO | Redis maxmemory=0 — intentional (protect auth state); production = bound + noeviction |
| Rate-limit | LOW | No global per-IP rate limit (login lockout only); production = nginx limit_req |

## NOT TESTED (recorded, not claimed as pass)
- [NT] 6600-instance DICOM stress test — not run on the single local node (resource/time; existing
      2000-slice benchmark stands). Documented in PERFORMANCE/BASELINE.
- [NT] Write-path load testing (order/report creation under concurrency) — would create duplicate
      synthetic clinical records; functionally validated instead.
- [NT] High-concurrency C-STORE/MWL load — avoided to not disrupt Orthanc on one node.
- [NT] Full live Orthanc isolated restore spin-up — documented procedure; PG index portion validated.
- [NT] Multi-service simultaneous failure / disk-full / OOM — single-node risk; DR-drill item.
- [NT] Concurrent-edit conflict-detection UI — server prevents history loss + blocks signed edits;
      optimistic-locking UI is a documented enhancement.

## Preservation confirmation
- No PG reset; no table/record deleted; search_tsv GIN present; signatures (2) intact; audit history
  append-only (1396 rows, grown not pruned). Orthanc studies preserved (10 incl. synthetic test
  studies added via C-STORE; no existing study modified/deleted). All Docker volumes present.
- **Not production-ready on tests alone** — formal pentest, TLS enablement, infra hardening, and the
  documented NOT-TESTED items remain before real-patient use.

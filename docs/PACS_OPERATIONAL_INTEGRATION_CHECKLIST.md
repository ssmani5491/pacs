# PACS Operational Integration — Checklist (PACS Operations Module 5)

## Requirements (from the brief)
- [x] Command Centre dashboard (`/pacs/operations/command-centre`) via `GET /api/pacs/operations/overview`
      — reverse-push, archive, storage, service health, open/critical alerts, recent activity
- [x] Status indicators (healthy/warning/critical/failed); loading/empty/error states; refresh
- [x] Permission-gated tiles (hidden without the section's permission); no fabricated values
- [x] Exceptions Console (`/pacs/operations/exceptions`) via `GET /api/pacs/operations/exceptions`
- [x] CONFIRMED / HEURISTIC / INFRASTRUCTURE classification, visually distinct
- [x] Recovery shown only when `canRecover`; calls existing endpoints only; no new recovery logic
- [x] Per-study aggregate (`GET /api/pacs/operations/history/study/:uid`) — identity, transfer history,
      archive history + integrity, study storage, timestamps, summary counts
- [x] Study Operations action in the RIS worklist; launches existing reverse-push workflow (reused API)
- [x] Handles studies with no operational history cleanly
- [x] Navigation entries for Command Centre + Exceptions Console (existing nav; no new permission)
- [x] Notification gap-closure: one deduped HIGH `pacs_admin` org-scoped notification on on-demand
      integrity-verification failure; success emits none; existing notifications unchanged

## Security / isolation
- [x] Server-side RBAC (OR-gate in service); no new permission
- [x] Organization isolation on every query; cross-org study → 404 (no existence leak)
- [x] Patient MRN gated by `patient.view` on all surfaces, incl. nested (no-leak scan)
- [x] UID validated/normalized (malformed → 400, never 500)
- [x] No file paths / Orthanc credentials / secrets exposed
- [x] Recovery authorization = existing `*.manage` / `system.alert.acknowledge`; server authoritative
- [x] Interrupted-job detection is non-mutating (job unchanged after calling the endpoint)
- [x] Audit events written for sensitive reads + existing recovery/verify actions

## Preservation
- [x] No migration (10 migrations, last `0010_pacs_storage`); no new table
- [x] No new Docker service (8 services)
- [x] `studies_search_tsv_idx` GIN index present
- [x] No new permission; no new production user (reused Module 4 test users for tests)
- [x] NGINX dynamic DNS `resolver 127.0.0.11` + variable upstreams intact
- [x] Orthanc 2489 instances / 10 studies unchanged; archives, signatures, audit intact
- [x] Synthetic test records clearly identified (archive `a5000000…`, transfer `e5000000…`)

## Verification
- [x] Backend Jest 44/44 (11 suites)
- [x] Full Playwright 70/70 (28 Module 5 + 42 existing)
- [x] Backend `tsc --noEmit` clean; frontend production build passes
- [x] DICOM C-STORE :4242 + MWL :4243 reachable
- [x] Accuracy EXACT vs raw SQL (overview + study aggregate)
- [x] Screenshots 39–43

## Scope
- [x] Module 5 only — no new module or phase started
- [ ] NOT TESTED: 6,600-instance stress; two populated orgs; Orthanc restore spin-up;
      recovery-action load; multi-million-row scale (see TEST_RESULTS → NOT TESTED)

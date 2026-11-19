# PACS Operational Integration — Test Results (PACS Operations Module 5)

All results below were **actually executed** on the live dev stack on 2026-11-16. Items not executed are
marked **NOT TESTED**. No historical test is claimed re-run unless listed here.

## Automated suites (executed)
| Suite | Result |
|---|---|
| Backend Jest unit tests (throwaway `node:24-alpine` container) | **44 passed / 44**, 11 suites |
| Full Playwright regression (API/E2E + UI) | **70 passed / 70** |
| &nbsp;&nbsp;↳ Module 5 tests within it | 28 (4 overview + 7 study aggregate + 8 exceptions + 5 integrity notification + 4 UI) |
| &nbsp;&nbsp;↳ Existing regression within it | 42 (viewer, reporting, ops, reverse-push, archive, storage, operations-history) |
| Backend TypeScript (`tsc --noEmit`, throwaway container) | clean (0 errors) |
| Frontend production build (`docker compose build frontend`, authoritative) | success each stage |

> Note: a **bare-mount** `tsc` of the frontend reports one pre-existing `socket.io-client` module-
> resolution error (a Phase 8 dependency not installed in the throwaway mount). It is **not** in any
> Module 5 file and does not occur in the real `docker compose build frontend`, which passed.

## Behavior verified (executed)
**Command Centre (A)** — all tiles for an admin; numbers EXACT-match Module 4 dashboard +
`/system/alerts/summary`; reverse-push-only user sees the transfer tile but **not** storage/health/
alerts; receptionist → 403; recent strip redacts MRN without `patient.view`. Verified against raw SQL:
reverse-push `COMPLETED 4 / CANCELLED 2` and (with seeded fixtures) `FAILED/PARTIAL/RUNNING`; archive
`VERIFIED 2 / FAILED 1 / CANCELLED 1`; open alerts 0; Orthanc 2489 instances, disk 11.7%.

**Per-study aggregate (E/C)** — admin sees identity + transfers + archives + integrity + summary;
empty-history study → empty arrays, zero counts, 200; unknown UID → 404; malformed UID → 400 (never
500); cross-org/NULL-org study → 404 (no existence leak); reverse-push-only sees transfers only;
archive-only sees archives only **and** MRN null with a full-payload no-leak scan; no-permission → 403.
EXACT vs DB: study `…190811` = 2 COMPLETED + 2 CANCELLED transfers (4 total) + 1 VERIFIED archive.

**Exceptions Console (C)** — CONFIRMED (failed/partial), HEURISTIC (interrupted), and INFRASTRUCTURE
categories classify correctly; heuristic separated from confirmed (status stays `RUNNING`, never
reported FAILED); recovery references existing endpoints + `canRecover` per permission (admin true,
view-only false); source RBAC (reverse-push-only sees only transfer rows); MRN redacted (incl. nested
scan); no path/credential leak (`/var/lib/pacs`, `archivePath`, `orthanc:orthanc`, `password`,
`.zip.gz` all absent); **read-only** (interrupted job unchanged after two calls); no-permission → 403.

**Notification gap-closure (D)** — successful verify → no failure notification; failed verify →
**exactly one** HIGH `pacs_admin` org-scoped notification; same-day repeat deduped; subsequent-day
failure produces a new notification; org isolation (non-manager → 403, no notify path); existing
archive-done/reverse-push-done notifications unchanged; verification result unaffected by the
notification layer; `ARCHIVE_JOB_VERIFY` audit still fires.

**Frontend UI (Playwright, executed)** — Command Centre renders all tiles for admin; hides
storage/health/alerts for a reverse-push-only user; Exceptions shows recovery for a manager and
"(no permission)" for a viewer; worklist Operations drawer opens with reverse-push + archive history
sections. Manual browser verification captured the screenshots below.

## DICOM / connectivity (executed)
- **C-STORE :4242 OPEN**, **MWL :4243 OPEN** (TCP reachable).
- Reverse Push and Archive endpoints respond 200; Storage Management and Operations History 200
  (within the 70/70 Playwright run).

## Preservation (executed — see PRESERVATION section of the final report)
Orthanc 2489 instances / 10 studies / 6 patients unchanged; archive jobs 4 real (2 verified) + 1
synthetic-test; transfer jobs 6 real + 3 synthetic-test; 5010 studies; 3 signatures; 2545 audit rows;
GIN present; 10 migrations (no Module 5 migration); 8 services healthy; NGINX resolver `127.0.0.11`
present.

## Screenshots
`docs/screenshots/39-command-centre.png`, `40-exceptions-console.png`, `41-exceptions-viewonly.png`,
`42-study-ops.png`, `43-study-ops-empty.png`.

## NOT TESTED
- High-volume **6,600-instance** DICOM stress (carried from Phase 9).
- **Multi-organization** validation with two **populated** organizations (only one populated org +
  NULL-org orphans exist; org-isolation logic is identical for any two concrete orgs but was not
  exercised across two populated orgs).
- Full **Orthanc restore spin-up** (carried from Phase 9).
- Concurrent/high-rate recovery actions from the Exceptions Console (functional single-action path
  tested; load not tested).
- Multi-million-row scale on the new aggregates (covered by pagination + the 10k export cap, not
  stress-tested).

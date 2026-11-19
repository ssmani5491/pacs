# Phase 8 Test Results (2026-11-14)

All tests executed against the live local stack. Synthetic data only.

## Backend unit tests — 44/44 PASS
Run: build-stage image `npm test`. (18 suites report as "failed" to load — the `.ts` source specs
can't run without ts-jest in the production container; their compiled `.js` equivalents all pass.)
New Phase 8 coverage:
- NotificationsService: user-targeted create, **dedup by dedupKey**, **non-throwing on DB failure**,
  **role fan-out** to active users, recipient-scope restriction (5 tests).
- AlertsService: raise-new, **dedup bumps occurrences**, acknowledge, resolve, **SYSTEM recover** (5 tests).
Prior phases: 34/34 unchanged.

## Playwright integration — 12/12 PASS
```
viewer.spec.ts      4/4   (DICOMweb auth, org isolation, WADO pixel stream, worklist→OHIF→MPR)
reporting.spec.ts   3/3   (lifecycle+immutability+addendum+pdf, org isolation, worklist buckets)
ops.spec.ts         5/5   (notification-from-event + org isolation, read flow updates unread,
                           audit view/export permission enforcement, health/dashboard, alert ack→resolve)
```

## API-level verification (recorded)
- Notification generated from a real **ORDER_ASSIGN** event → delivered to rad_ggh (EXAM_ASSIGNED).
- **Org isolation**: rad_tcl (other org) sees 0 notifications; cannot mark rad_ggh's read (404).
- **Mark read** → unread count 1 → 0.
- **Dedup**: re-assigning the same order+user creates no duplicate (total stays 1).
- **Audit export**: admin 200 (CSV banner "by admin | … | 201 rows"); rad_ggh 403 (view) + 403 (export).
  Export is itself audited (AUDIT_EXPORT by admin).
- **Alert lifecycle**: OPEN → acknowledge (ACKNOWLEDGED + ackBy) → resolve (RESOLVED + resolvedBy +
  resolvedAt); ALERT_ACKNOWLEDGE + ALERT_RESOLVE audited.
- **Health**: scheduler persisted real checks for all 8 services, all HEALTHY with real response
  times (e.g. orthanc 7ms, postgres 4ms). HEALTHCHECK job recorded SUCCESS.
- **Dashboard**: real metrics (studiesToday 3, studiesMonth 5007, finalized 2, signed 2, …).

## Browser (screenshots docs/screenshots/)
- 24-notification-bell: bell + badge "1" + dropdown with real EXAM_ASSIGNED notifications.
- 25-system-monitoring: 8-service health table (all HEALTHY, real response + timestamps).
- 26-ops-metrics: operational metric tiles.
- 27-alert-management: alert table (HIGH open + CRITICAL resolved).
- 28-audit-logs: audit viewer with filters + Export CSV + real records.

## Regression — Phases 1-7 PASS
- Endpoints 200: health, worklist, patients, orders, MWL monitor, PACS monitor, viewer, dicom-web,
  reporting-worklist, report-templates.
- MWL :4243 up, C-STORE :4242 up. OHIF /viewer/ 200. DICOMweb auth 200.
- Data preserved: 5007 studies, 5 reports, 243 audit logs. **search_tsv GIN index present.**
- Orthanc studies accessible (7).

## Live deployment verification
- `docker compose config` valid; migration `0007_phase8_ops` applied; new tables created.
- DB backed up first: `backups/ris-pre-phase8-*.sql.gz`.
- **nginx dynamic DNS**: backend recreated to a NEW IP (172.22.0.3 → .10), no nginx restart,
  12/12 requests → 200, **zero 502**.
- `/socket.io/` reachable through nginx (HTTP 200).
- No credential leak: `/auth/me` returns no password/secret/hash fields.
- All 8 services healthy; all Docker volumes present.

## Known gaps (also in checklist)
- No external (email) notification sender wired; in-app + socket only.
- Audit PDF export not implemented (CSV only).
- Alert auto-raise is driven by the health scheduler; event-driven infra alerts beyond DICOM-ingest
  failure are modeled but not all wired to live triggers.

# Phase 8 Checklist — Notifications, Audit & Operational Management ✅ (2026-11-14)

Legend: [x] done/verified · [~] partial / documented limitation

## Module A — In-app notification system
- [x] 14 categories (NEW_STUDY, STUDY_MATCHED, ORPHAN_STUDY, RECONCILIATION, REPORT_*, EXAM_*, DICOM/MODALITY/MWL failure, SYSTEM_ALERT)
- [x] Stored in PostgreSQL; org + user/role association; individual + role fan-out
- [x] read/unread, priority LOW/NORMAL/HIGH/CRITICAL, category, createdAt
- [x] optional patient/order/study/report refs; title/body; link; expiry; dedupKey (no duplicates)
- [x] APIs: GET /notifications, /unread-count, /:id; PATCH /:id/read, /read-all, /:id/archive; DELETE /:id (archived-only)
- [x] pagination + filters (read, category, priority, date, archived); org isolation + recipient perms

## Module B — Notification centre UI
- [x] Bell + unread badge + dropdown in header; full Notification Centre page
- [x] read/unread + priority + category icons + timestamp; search/filters; mark read / all / archive
- [x] click opens the relevant module; server-side pagination; matches existing UI (no new design system)
- [x] Real-time: authenticated Socket.IO gateway (/ws/notifications, per-user/org rooms, no global
      broadcast, safe reconnect) + 20s /unread-count polling fallback; nginx /socket.io/ proxied

## Module C — Event-driven integration (central service, after successful DB tx)
- [x] DICOM: new/matched study, orphan → reconciliation, reception failure (ingest.service)
- [x] RIS: exam assigned (to user), cancelled (orders.service)
- [x] Reporting: preliminary, final, signed, addendum (reports.service)
- [x] Infra: alerts raised by the scheduler on service DOWN
- [x] Non-blocking: notification failures never fail the clinical tx (create() swallows errors);
      delivery attempts recorded (notification_delivery_attempts)

## Module D — Audit log management
- [x] Viewer: time, username, userId, org, action, status, entity type/id, IP, detail
- [x] Filters: date range, username, action, status, IP (+org for super-admin); server-side pagination
- [x] APIs: GET /audit-logs, /audit-logs/:id, /audit-logs/export
- [x] Append-only preserved; audit.view / audit.export permissions; org isolation
- [x] CSV export: same filters+perms, formula-injection safe, timestamp+exporter banner, 10k row cap,
      the export itself is audited (AUDIT_EXPORT)
- [~] PDF export: not implemented (optional; CSV covers the requirement)

## Module E — Operational dashboard
- [x] 8 services monitored with real app-level checks (query/PING/HTTP/TCP — not "container running")
- [x] status HEALTHY/DEGRADED/DOWN/UNKNOWN; response time; last success/failure; detail
- [x] metrics: studies today/month, pending reconciliation, failed receptions, active modalities,
      MWL queries, preliminary/final/signed reports, unread (via bell), open/critical alerts
- [x] org-scoped; indexed count queries in one transaction (no N+1); 30s cached-status polling

## Module F — Alert management
- [x] levels INFO/WARNING/HIGH/CRITICAL; OPEN/ACKNOWLEDGED/RESOLVED lifecycle
- [x] created/ack/resolve times + users; dedup by alertKey (bumps occurrences); configurable thresholds
- [x] audit trail (ALERT_RAISED/ACKNOWLEDGE/RESOLVE/RECOVERED); CRITICAL visually prominent
- [x] recovery rule: auto-RESOLVED only after N consecutive healthy checks (default 3), recorded as SYSTEM

## Module G — Background jobs
- [x] @nestjs/schedule in-process (no 9th service); Redis locks for idempotency/no-overlap
- [x] HEALTHCHECK (60s), ALERT_EVAL (after each check), NOTIF_CLEANUP (hourly)
- [x] BackgroundJobRecord: status, attempts, created/completed, error; retry/backoff via re-run
- [~] A full queue (BullMQ) was NOT added — justified: light periodic workload; schedule+locks suffices

## RBAC
- [x] New perms: notification.view/manage, audit.export, system.dashboard.view, system.health.view,
      system.alert.view/acknowledge/resolve, system.jobs.view/manage (audit.view pre-existed)
- [x] Assigned to roles; enforced server-side on every endpoint; org isolation verified

## Database
- [x] Additive migration 0007 (no DROP TABLE/COLUMN; notifications.type kept + nullable only)
- [x] New tables: system_alerts, service_health_checks, background_job_records, notification_delivery_attempts
- [x] AuditLog +organizationId/username/status (backfilled from user join); Notification enriched
- [x] UUID PKs, org relations, indexes, timestamps, dedup uniqueness; search_tsv GIN intact
- [x] DB backed up before migration (backups/ris-pre-phase8-*.sql.gz)

## Testing
- [x] Backend unit 44/44 (incl. notification dedup/isolation/fan-out/non-throwing, alert lifecycle)
- [x] Playwright 12/12 (viewer 4 + reporting 3 + ops 5): notification-from-event + isolation,
      read flow, audit view/export perms, health/dashboard, alert ack→resolve
- [x] Browser: bell+badge+dropdown, monitoring (8 services real health), alerts, audit — screenshots 24-28
- [x] Regression: Phases 1-7 endpoints 200; data preserved (5007 studies/5 reports/243 audit); GIN intact

## Live deployment
- [x] compose config valid; migration applied; only necessary services restarted
- [x] volumes + records preserved; Orthanc studies accessible; MWL :4243 + C-STORE :4242 up
- [x] OHIF /viewer/, DICOMweb /dicom-web/, backend via nginx all OK
- [x] **nginx dynamic DNS intact**: backend recreated to NEW IP (.3→.10), no restart, 0× 502
- [x] no credential leak in /auth/me

## Known limitations
- Notification email/external channels: schema + delivery-attempt model present, no external sender wired
  (in-app + socket only). No PHI would be sent externally by default.
- Audit PDF export not implemented (CSV only).
- Alerts auto-raise from the health scheduler; per-event infra alerts (e.g. modality comm) are modeled
  and demoed but only DICOM-ingest failure raises an event-driven notification so far.

# Phase 8 Architecture — Notifications, Audit & Operational Management

## Overview
Phase 8 adds an operational layer over the existing RIS/PACS without changing clinical workflows:
in-app notifications (with real-time delivery), an audit viewer/export, a service-health + metrics
dashboard, system alerts with an ack/resolve lifecycle, and an in-process background scheduler. No
new Docker service was added — the stack stays at 8 services.

## New database tables (migration 0007_phase8_ops, additive)
| Table | Purpose |
|---|---|
| `notifications` (enriched) | +organizationId, roleKey, category, priority, link, patient/order/study/report refs, readAt, archived, dedupKey (unique), expiresAt. Legacy `type` column retained (nullable). |
| `notification_delivery_attempts` | per-notification delivery record (channel/status/error) for investigation |
| `system_alerts` | infra/operational alerts; alertKey dedup; OPEN/ACKNOWLEDGED/RESOLVED; ack/resolve times+users; occurrences |
| `service_health_checks` | point-in-time health per service (status, responseMs, detail, checkedAt) |
| `background_job_records` | scheduler run records (jobType, status, attempts, timing, error) |
| `audit_logs` (enriched) | +organizationId, username (denormalized), status (SUCCESS/FAILURE); backfilled from user join |

`search_tsv` GIN index on `studies` is untouched (verified post-migration).

## Notification flow (Module A/C)
```
business event (ingest / report lifecycle / order assign-cancel)
        │  (AFTER the successful DB transaction)
        ▼
NotificationsService.create()   ── dedupKey? ──► skip if exists (idempotent)
        │  resolve recipients (userId, or fan-out to roleKey+org)
        ▼
  notifications row(s) created ──► Socket.IO emit to user:<id> / role:<org>:<key> room
        │                              │ (delivery attempt recorded)
        ▼                              ▼
  bell polls /unread-count (20s)    browser receives 'notification' → refreshes bell
```
`create()` never throws — a notification failure cannot fail a clinical transaction.

## Real-time (Socket.IO)
- Gateway namespace `/ws/notifications`; JWT verified in the handshake (auth.token).
- Rooms: `user:<id>` and `role:<org>:<key>`. The server only ever emits a notification to the room(s)
  that own it, so there is no cross-user / cross-org leakage and no global broadcast.
- nginx proxies `/socket.io/` with WebSocket upgrade using the dynamic-DNS upstream pattern.
- Fallback: the bell polls `/api/notifications/unread-count` every 20s, so a drop during reconnect is
  reconciled; on reconnect the client also refreshes.

## Health-check architecture (Module E)
`HealthService.checkAll()` runs real application-level probes (NOT "container is running"):
- backend = self; postgres = `SELECT 1`; redis = `PING`; orthanc = HTTP `/system` (basic auth);
  dicom-cstore = TCP connect `orthanc:4242`; mwl-scp = TCP connect `mwl-scp:4243`; ohif = HTTP
  `/viewer/`; nginx = HTTP `/healthz`.
Results persist to `service_health_checks`; last success/failure are derived from history.

## Alert lifecycle (Module F) + recovery rule
- Raised (dedup by `alertKey`; re-raise bumps `occurrences`). Operators `acknowledge` then `resolve`.
- Auto-recovery: the scheduler resolves an open alert **only after N consecutive HEALTHY checks**
  (default 3, `ALERT_RECOVER_HEALTHY_CHECKS`), recorded as `resolvedBy = SYSTEM`. A single healthy
  check never auto-resolves.

## Background scheduler (Module G)
`OpsScheduler` runs inside the backend process via `@nestjs/schedule`:
- `@Interval 60s` HEALTHCHECK → probes + ALERT_EVAL (raise/recover).
- `@Cron hourly` NOTIF_CLEANUP → archive expired notifications.
- Each job takes a Redis lock (`lock:job:<name>`, SET NX PX) so only one instance runs at a time
  (idempotency / no overlap even across process restarts), and records a `background_job_records` row.
No BullMQ / 9th service — justified by the light, periodic workload.

## Security
- Every new endpoint is guarded by a specific permission (see PHASE8_API.md) and enforces org isolation.
- Audit remains append-only; the viewer is read-only; export is permission-gated, formula-injection
  safe, row-capped, and itself audited. No passwords/tokens/secrets are logged or returned.

## Configuration variables
| Env | Default | Meaning |
|---|---|---|
| `ALERT_RECOVER_HEALTHY_CHECKS` | 3 | consecutive healthy checks before auto-recovery |
| (existing) `REDIS_HOST/PORT/PASSWORD` | — | shared Redis client (job locks) |
| (existing) `JWT_ACCESS_SECRET` | — | socket handshake verification |

## Deployment
`docker compose build backend frontend` → `docker compose up -d backend frontend` →
`docker compose restart nginx` (for the /socket.io/ route). Migration applies on backend start via
`prisma migrate deploy`. No destructive deployment; volumes/records preserved.

## Recovery / troubleshooting
- Socket not connecting → bell still works via polling; check nginx `/socket.io/` route + JWT.
- Health shows DOWN → the target service's app check failed (not just the container); see `detail`.
- Stuck alert → resolve manually in Alert Management; auto-recovery needs N healthy checks.
- Scheduler not running → check backend logs for `OpsScheduler`; Redis lock auto-expires (PX).

# Phase 8 API Reference

All endpoints require a valid JWT (Bearer) and enforce the listed permission + organization isolation.

## Notifications (Module A/B)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/notifications` | notification.view | filters: `read`, `category`, `priority`, `dateFrom/dateTo`, `archived`; paginated |
| GET | `/api/notifications/unread-count` | notification.view | `{ count }` (polling fallback) |
| GET | `/api/notifications/:id` | notification.view | 404 if not the recipient's |
| PATCH | `/api/notifications/:id/read` | notification.view | sets read + readAt |
| PATCH | `/api/notifications/read-all` | notification.view | `{ updated }` |
| PATCH | `/api/notifications/:id/archive` | notification.view | |
| DELETE | `/api/notifications/:id` | notification.view | only if already archived |

Socket.IO: namespace `/ws/notifications`, event `notification`, JWT in `auth.token`.

## Audit (Module D)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/audit-logs` | audit.view | filters: `username`, `action`, `status`, `entityType`, `ip`, `dateFrom/dateTo`, (`organizationId` super-admin); paginated (max 200/page) |
| GET | `/api/audit-logs/:id` | audit.view | org-scoped |
| GET | `/api/audit-logs/export` | audit.export | CSV; same filters; 10k cap; injection-safe; audited |

## System / Operations (Module E/F/G)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/system/health-status` | system.health.view | latest cached; `?fresh=true` runs probes now |
| GET | `/api/system/dashboard` | system.dashboard.view | org-scoped operational metrics |
| GET | `/api/system/alerts` | system.alert.view | filters `status`, `level`; paginated |
| GET | `/api/system/alerts/summary` | system.alert.view | `{ open, critical }` |
| POST | `/api/system/alerts/:id/acknowledge` | system.alert.acknowledge | |
| POST | `/api/system/alerts/:id/resolve` | system.alert.resolve | |
| GET | `/api/system/jobs` | system.jobs.view | background job records; filters `jobType`, `status` |

## Permissions added
`notification.view`, `notification.manage`, `audit.export`, `system.dashboard.view`,
`system.health.view`, `system.alert.view`, `system.alert.acknowledge`, `system.alert.resolve`,
`system.jobs.view`, `system.jobs.manage`. (`audit.view` pre-existed.)

### Role assignments (summary)
- **notification.view**: all authenticated roles (everyone has their own notifications).
- **audit.view / audit.export**: org_admin, pacs_admin, auditor (view), super_admin.
- **system.***: org_admin + pacs_admin (dashboard/health/alerts/ack/resolve/jobs), super_admin (all).
- dept_admin: notification.view + dashboard + alert view/ack. auditor: + dashboard view.

## Audit actions introduced
`AUDIT_EXPORT`, `ALERT_RAISED`, `ALERT_ACKNOWLEDGE`, `ALERT_RESOLVE`, `ALERT_RECOVERED`,
plus reporting/DICOM/order events now carry `status` (SUCCESS/FAILURE) and org/username.

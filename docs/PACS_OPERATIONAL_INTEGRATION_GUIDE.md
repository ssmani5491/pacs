# PACS Operational Integration — Guide (PACS Operations Module 5)

## Frontend routes & navigation
Added to the existing **"PACS Operations"** navigation group (no new permission; links appear for all,
the server authorizes each request):

| Route | Page | Purpose |
|---|---|---|
| `/pacs/operations/command-centre` | Operations Command Centre | one-glance operational dashboard |
| `/pacs/operations/exceptions` | Exceptions Console | consolidated failures + recovery |
| `/worklist` (drawer) | Study Operations drawer | per-study operations, opened by the row "Operations" button |

The group also keeps the existing Reverse Push Monitor, Archive Compression, Storage Management, and
Transfer & Archive History entries.

## Command Centre
Shows Reverse Push and Archive summaries, Storage utilization + capacity, Service Health (8 services),
Active Alerts (open/critical), and Recent Operational Activity. Auto-refreshes every 15 s; a Refresh
button forces a reload. **Tiles appear only for the sections the user may view** — e.g. a user with only
`pacs.reverse-push.view` sees the Reverse Push tile but not Storage, Service Health, or Alerts. All
numbers come from the live services/DB; no fabricated or fallback values.

## Study Operations (from the RIS worklist)
Each worklist row has an **Operations** button (shown when the user has `pacs.reverse-push.view` or
`pacs.archive.view`). It opens a drawer showing: study identity (UID, patient — only with
`patient.view`, modality, instance count, accession, study storage), summary counts, reverse-push
history, archive history + integrity, and the latest integrity result. A study with no operational
history shows empty tables ("No reverse-push/archive history"). Where the user has
`pacs.reverse-push.manage`, a **"Push study to destination…"** control launches the **existing**
reverse-push create-job workflow for that study (it reuses `POST /api/pacs/reverse-push/jobs`).

## Exceptions Console
Lists operational exceptions across sources, each tagged with a **classification**:

| Classification | Meaning | Examples |
|---|---|---|
| **CONFIRMED** | an explicitly recorded failed/partial status | transfer `FAILED`, transfer `PARTIALLY_COMPLETED`, archive `FAILED` |
| **HEURISTIC** | inferred, not confirmed | transfer `RUNNING` with no progress past the staleness window (interrupted) |
| **INFRASTRUCTURE** | environment-level | open storage/threshold alert, unhealthy service |

A **recovery** button appears only when `canRecover` is true (the user holds the required `*.manage` /
`system.alert.acknowledge` permission). It calls the **existing** module endpoint (retry/cancel/verify/
acknowledge). A user who can view but not manage sees "(no permission)" with the required-permission
tooltip. Recovery for an unhealthy service is intentionally absent (no safe automated recovery).

## Operational status definitions
- **Reverse-push statuses:** `PENDING`, `QUEUED`, `RUNNING`, `COMPLETED`, `PARTIALLY_COMPLETED`,
  `FAILED`, `CANCELLED`.
- **Archive statuses:** `PENDING`, `QUEUED`, `RUNNING`, `COMPLETED`, `VERIFIED`, `FAILED`, `CANCELLED`.
- **Service health:** `HEALTHY`, `DEGRADED`, `DOWN`, `UNKNOWN` (app-level checks, not "container running").
- **Alert states:** `OPEN`, `ACKNOWLEDGED`, `RESOLVED`.

## Interrupted-job heuristic & its limitation
A reverse-push job is flagged `TRANSFER_INTERRUPTED_HEURISTIC` when it is `RUNNING`, has a `startedAt`
older than a **fixed 1-hour** staleness window, and has no `completedAt`. This is a **non-mutating
inference** — the Exceptions Console never changes the job; its status stays `RUNNING` and the row
clearly states "inferred interrupted, not confirmed failed". **Limitation:** a legitimately
long-running transfer (> 1 hour) can appear once as a heuristic row; the actual recovery remains the
existing scheduler reconciliation. The threshold is fixed (not configurable in this module).

## Notification deduplication behavior
On-demand archive integrity-verification failure emits **one** HIGH, `pacs_admin`, org-scoped
notification with `dedupKey = integrity-fail:<jobId>:<YYYY-MM-DD>`. Repeated failures for the **same job
on the same day** are deduplicated (no duplicate). A failure on a **subsequent day** produces a new
notification (new dateted key). Successful verification emits nothing. Existing archive-done and
reverse-push-done notifications are unchanged. If notification delivery fails, it never breaks or rolls
back the verification result (`NotificationsService.create` is non-throwing).

## End-to-end operational workflow
1. Operator opens the **Command Centre** → sees transfer/archive/storage/health/alerts at a glance.
2. Clicks **View exceptions →** or the Exceptions Console nav → triages failures; with the right
   permission, clicks Retry/Verify/Acknowledge (existing endpoints; audited; no auto-retry).
3. From the **worklist**, opens a study's **Operations** drawer → reviews transfer/archive/integrity/
   storage; if authorized, launches a reverse push and tracks it in the Reverse Push Monitor.
4. On an integrity failure, `pacs_admin` receives one deduped notification linking to Archive.

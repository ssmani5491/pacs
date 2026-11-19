# PACS Operational Integration — API (PACS Operations Module 5)

All routes require authentication (global `JwtAuthGuard`). The three new read endpoints carry no
`@RequirePermissions`; they enforce an **OR-gate** and per-section filtering in the service. All are
**read-only** and **org-isolated**. Patient MRN appears only with `patient.view`.

---

## GET /api/pacs/operations/overview  (Command Centre)
Requires **any one** of: `pacs.reverse-push.view`, `pacs.archive.view`, `pacs.storage.view`,
`system.health.view`, `system.alert.view` (else **403**). Each section is included only if the caller
holds its permission.

```jsonc
{
  "transfer": { "total", "completed", "verified", "failed", "partial", "running", "queued", "pending", "cancelled" } | null,
  "archive":  { "total", "completed", "verified", "failed", "partial", "running", "queued", "pending", "cancelled" } | null,
  "storage":  { "disk": { "totalBytes","usedBytes","availableBytes","usedPercent","orthancPercent","archivePercent" },
                "orthanc": { "bytes","patients","studies","series","instances" },
                "archiveBytes", "alertLevel", "thresholds" } | null,
  "health":   [ { "service","status","responseMs","detail?" } ] | null,   // 8 services
  "alerts":   { "open", "critical" } | null,
  "recent":   [ OperationRow ],       // latest ops; patientMrn null without patient.view
  "generatedAt"
}
```
`transfer.total` / `archive.total` are reconciled to Module 4's dashboard (single source of truth); the
status split comes from an org-scoped `groupBy` over the same rows.

---

## GET /api/pacs/operations/exceptions  (Exceptions Console)
Same OR-gate as overview. Read-only; performs no recovery.

```jsonc
{
  "data": [ {
    "source": "REVERSE_PUSH" | "ARCHIVE" | "INFRA_ALERT" | "INFRA_SERVICE",
    "id", "kind", "classification": "CONFIRMED" | "HEURISTIC" | "INFRASTRUCTURE",
    "status", "studyInstanceUid?", "patientMrn": string|null, "modality?",
    "errorDetail",                      // message only — never a file path
    "timestamp",
    "recovery": { "action", "endpoint", "requiredPermission" } | null,   // EXISTING endpoint
    "canRecover": boolean               // caller holds requiredPermission
  } ],
  "counts": { "confirmed", "heuristic", "infrastructure", "total" },
  "generatedAt"
}
```
`kind` ∈ `TRANSFER_FAILED` | `TRANSFER_PARTIAL` | `TRANSFER_INTERRUPTED_HEURISTIC` | `ARCHIVE_FAILED` |
`STORAGE_ALERT` | `SYSTEM_ALERT` | `SERVICE_UNHEALTHY`.

**Recovery endpoints (existing, not implemented by Module 5):**
| kind | recovery.action | recovery.endpoint | requiredPermission |
|---|---|---|---|
| TRANSFER_FAILED / TRANSFER_PARTIAL | retry | `/api/pacs/reverse-push/jobs/:id/retry` | `pacs.reverse-push.manage` |
| TRANSFER_INTERRUPTED_HEURISTIC | cancel | `/api/pacs/reverse-push/jobs/:id/cancel` | `pacs.reverse-push.manage` |
| ARCHIVE_FAILED | verify | `/api/pacs/archive/jobs/:id/verify` | `pacs.archive.manage` |
| STORAGE_ALERT / SYSTEM_ALERT | acknowledge | `/api/system/alerts/:id/acknowledge` | `system.alert.acknowledge` |
| SERVICE_UNHEALTHY | — (recovery null) | — | — |

---

## GET /api/pacs/operations/history/study/:uid  (Per-study aggregate)
Added to Module 4's controller. Same OR-gate. `:uid` is validated (numeric dot-separated, ≤64 chars) —
malformed → **400**; well-formed but unknown → **404**; another org's study → **404** (no existence
leak).

```jsonc
{
  "study": { "studyInstanceUid", "patientMrn": string|null, "modality", "studyDate",
             "accessionNumber", "description", "instanceCount", "isReconciled", "hasImages" },
  "transfers": [ OperationRow ],   // only with pacs.reverse-push.view
  "archives":  [ OperationRow ],   // only with pacs.archive.view
  "latestIntegrity": { "archiveJobId","verified","verifiedAt","status","detail","sha256" } | null,
  "storage": { "studyBytes": number|null, "instances": number|null } | null,   // live Orthanc; null if unlinked
  "summary": { "transferCount","archiveCount","transferCompleted","transferFailed","archiveVerified","archiveFailed" },
  "generatedAt"
}
```
Audit: writes `OPS_INTEGRATION_STUDY_VIEW`.

---

## Notification gap-closure (no new route)
On **on-demand** archive integrity-verification **failure** (existing `POST /api/pacs/archive/jobs/:id/verify`,
permission `pacs.archive.manage`), `ArchiveService.verifyJob()` now emits **one** notification via the
existing `NotificationsService.create`:
```jsonc
{ "category": "SYSTEM_ALERT", "priority": "HIGH", "roleKey": "pacs_admin",
  "organizationId": <job org>, "dedupKey": "integrity-fail:<jobId>:<YYYY-MM-DD>",
  "title": "Archive integrity verification failed", "link": "/pacs/archive" }
```
Successful verification emits nothing. The existing archive completion/failure (`archive-done:<jobId>`)
and reverse-push (`revpush-done:<jobId>`) notifications are unchanged.

**Audit events (existing + new):** `OPS_INTEGRATION_STUDY_VIEW`, `OPS_INTEGRATION_EXCEPTIONS_VIEW`
(reads); `ARCHIVE_JOB_VERIFY` (unchanged, still fires SUCCESS/FAILURE).

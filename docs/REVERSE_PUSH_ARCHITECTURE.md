# DICOM Reverse Push — Architecture (PACS Operations Module 1)

## Overview
PACS-to-PACS DICOM transfer: push a study from our Orthanc to a remote destination PACS via real
C-STORE. Built on the existing 8-service stack — **no new Docker service added**.

## Transfer engine: Orthanc native C-STORE SCU (user-approved)
We do NOT run a separate pynetdicom sender. The NestJS backend orchestrates Orthanc's built-in SCU:
- **Register destination**: `PUT /modalities/{id}` (AET/Host/Port) at job time, deleted after.
- **Test connection**: `POST /modalities/{id}/echo` → real DICOM **C-ECHO**.
- **Transfer**: `POST /modalities/{id}/store` (Resources = Orthanc instance ids, Asynchronous) → an
  Orthanc **Job**; we poll `GET /jobs/{id}` until terminal.
- **Success definition**: a job is COMPLETED only when Orthanc's store job reports `State: Success`
  with `FailedInstancesCount: 0` — i.e. the **destination acknowledged** each C-STORE. No simulation.

Why this engine: it is real DICOM, requires no 9th service, never copies raw DICOM out of Orthanc into
the backend, and gives authoritative per-job acknowledgment from Orthanc.

## Components
```
React ReversePush page ──HTTP──> NestJS /api/pacs/{destinations,reverse-push/*}
                                      │ ReversePushService (RBAC, org-iso, SSRF guard, job lifecycle)
                                      │ ReversePushScheduler (@Interval 5s, Redis lock)
                                      ▼
                                 OrthancService ──REST──> Orthanc (native C-STORE SCU)
                                      │                        │ C-STORE
                                      ▼                        ▼
                                 PostgreSQL              Destination PACS (verified receipt)
                                 (jobs + instances)
```

## Data model (additive migration 0008_pacs_reverse_push; search_tsv GIN preserved)
- **PacsDestination**: name, aeTitle, host, port, callingAet, connection/association timeouts,
  maxConcurrent, active, description, lastTest{At,Status,Detail}, org. Admin-configured allow-list.
- **DicomTransferJob**: destinationId, studyId, studyInstanceUid, orthancStudyId, status (PENDING/
  QUEUED/RUNNING/COMPLETED/PARTIALLY_COMPLETED/FAILED/CANCELLED), total/success/failed/pending
  instances, retryCount, lastError, orthancJobId, transferSpeedKbps, timing, cancelRequested,
  dedupKey (unique), createdBy, org.
- **DicomTransferInstance**: jobId, sopInstanceUid, orthancInstanceId, status (PENDING/SUCCESS/FAILED),
  error, sentAt. Unique (jobId, sopInstanceUid) — per-instance idempotency.

## Job lifecycle
`createJob` enumerates instances up front (one DicomTransferInstance row each) → QUEUED. The scheduler
(every 5 s, under a Redis lock so only one executor runs) picks the oldest QUEUED job → RUNNING →
registers the modality → stores pending instances via Orthanc async job → polls to terminal → marks
instances SUCCESS/FAILED → `finalize` recomputes counts + final status from instance rows (source of
truth) → notification + audit. **Pause** → PENDING; **Resume** → QUEUED; **Cancel** sets a flag the
executor honors (releases the Orthanc job safely) → CANCELLED; **Retry** resets FAILED instances to
PENDING and re-queues (only the failed subset is re-sent).

## Reliability
- **Restart recovery**: on each tick, RUNNING jobs with an `orthancJobId` are reconciled against the
  real Orthanc job state (Success/Failure) and finalized — so a backend restart mid-transfer never
  leaves a job stuck (verified: a 2000-instance job interrupted by a redeploy was recovered to
  COMPLETED on the next tick).
- **Idempotency**: one active job per (destination, study); per-instance unique rows; Redis lock
  prevents concurrent executors / duplicate execution.
- **Source safety**: reverse push READS from Orthanc; it never modifies/deletes source studies.

## Security
- RBAC: `pacs.reverse-push.view` (read monitor/jobs), `pacs.reverse-push.manage` (create/control
  jobs), `pacs.destination.manage` (configure destinations). Enforced server-side on every endpoint.
- Org isolation: destinations/jobs scoped to the user's org; studies must belong to the user's org.
- **SSRF protection**: destination host validated (charset + port range) and an internal-infra
  denylist (postgres/redis/backend/nginx/localhost/127.0.0.1) is refused (400). Destinations are an
  admin-configured allow-list; no arbitrary runtime targets.
- Audit: destination create/update/test, job create/pause/resume/cancel/retry/done all audited.
- No Orthanc credentials exposed to the browser (all Orthanc calls server-side).

## Configuration
No new env vars required. Orthanc modality registrations are transient (created per job, deleted
after). Scheduler interval 5 s (constant). Transfer-speed is an estimate (~256 KB/instance / duration).

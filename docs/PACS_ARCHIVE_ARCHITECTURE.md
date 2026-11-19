# PACS Archive Compression — Architecture (PACS Operations Module 2)

## Overview
Compress a study into a verified, lossless archive file on a dedicated volume. **Copy-only**: the
original Orthanc instances/files are never deleted or modified; DICOM transfer syntax is never changed.
Built on the existing 8 services — **no new Docker service** (one additive volume).

## Container format (user-approved): Orthanc study ZIP + backend gzip
1. Pull the study via Orthanc `GET /studies/{orthancId}/archive` → a **native ZIP** of the study's
   DICOM files (lossless container; files unchanged; magic `PK`).
2. The backend gzip-wraps that ZIP at a configurable level (0–9) → final `.zip.gz` archive file.
3. Record original size (the ZIP), compressed size (the .zip.gz), ratio, savings %, SHA-256, path.

This is **container compression** (ZIP + gzip), explicitly NOT DICOM transfer-syntax / pixel
recompression — the DICOM bytes inside are untouched and extract identically.

## Components
```
React ArchiveManagement ──HTTP──> NestJS /api/pacs/archive/*
                                      │ ArchiveService (RBAC, org-iso, job lifecycle, verify, restore)
                                      │ ArchiveScheduler (@Interval 6s: recover() OUTSIDE lock, then exec under Redis lock)
                                      ▼
                                  OrthancService ──GET /studies/{id}/archive──> Orthanc (reads only)
                                      │ writes .zip.gz
                                      ▼ worker_threads (gzip + SHA-256, off event loop)
                                  pacs_archive volume (/var/lib/pacs/archive)
                                      │
                                  PostgreSQL archive_jobs (history, sizes, checksum, status)
```

## Storage
New named Docker volume **`pacs_archive`** mounted at `/var/lib/pacs/archive` on the backend.
Layout: `studies/<safe-studyuid>.zip.gz` (archives), `tmp/` (transient Orthanc ZIPs, auto-deleted),
`restore/<jobId>/` (extraction output). Source = Orthanc; destination = this volume. Never touches
Orthanc's own storage.

## Worker threads (user-approved)
gzip is CPU-bound, so it runs in a Node **worker_thread** (`archive.worker.ts` → compiled
`archive.worker.js`), streaming gzip while computing SHA-256, keeping the API event loop free. Pool
size is configurable (`ARCHIVE_WORKERS`, default 2; also per-config `workerThreads`). Jobs are queued
in PostgreSQL and dispatched by the scheduler under a Redis lock (same pattern as Module 1).

## Data model (additive migration 0009_pacs_archive; search_tsv GIN preserved; DB backed up first)
**ArchiveJob**: studyInstanceUid, orthancStudyId, status (PENDING/QUEUED/RUNNING/COMPLETED/VERIFIED/
FAILED/CANCELLED), compressionLevel, workerCount, originalBytes, compressedBytes, compressionRatio,
savingsPercent, instanceCount, sha256, archivePath, verified, verifyDetail, cancelRequested, error,
timing, dedupKey (unique), org, createdBy. (Storage config lives in `system_settings['archive.config']`.)

## Job lifecycle
`createJob` (one active job per study; refuses if a verified archive already exists) → QUEUED. The
scheduler picks the oldest QUEUED → RUNNING → downloads the Orthanc ZIP → gzip in a worker → records
sizes + SHA-256 → **auto-verifies** (re-hash + gunzip + ZIP entry count) → VERIFIED (or COMPLETED if
verify fails). **Cancel** sets a flag → CANCELLED. **Verify** re-checks integrity on demand.
**Restore** gunzips the archive to `restore/<jobId>/` and reports the entry count — copy-only, no
re-import into Orthanc.

## Integrity & protections
- **SHA-256** of the final archive stored and re-checked; verification also decompresses and counts
  ZIP entries to prove the archive extracts.
- **Never overwrite a verified archive**: a new job for a study that already has a verified archive
  FAILS with an explicit message.
- **Copy-only**: originals never deleted/modified; automatic source deletion is out of scope.
- **Interrupted-job recovery**: on every scheduler tick (OUTSIDE the execution lock, so a stale lock
  from a crashed process can't block it), RUNNING jobs are reconciled — if the output archive exists
  and hashes/extracts, finalize as VERIFIED; otherwise re-queue to retry automatically.

## Security
RBAC `pacs.archive.view` / `pacs.archive.manage` (super_admin, pacs_admin, org_admin). Org isolation
on jobs. No arbitrary filesystem access (paths are derived from the study UID, sanitized; writes only
under the archive root). No Orthanc credentials exposed. Audit on config/create/cancel/verify/restore/
done. Notifications to pacs_admin on completion/failure.

## Configuration
| Env | Default | Meaning |
|---|---|---|
| `ARCHIVE_ROOT` | /var/lib/pacs/archive | archive volume mount path |
| `ARCHIVE_WORKERS` | 2 | default worker-thread count |
Per-deployment config (compression level, workerThreads) is stored in `system_settings` and editable
via `PATCH /api/pacs/archive/config`.

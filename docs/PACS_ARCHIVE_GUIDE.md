# PACS Archive Compression — User Guide

## Who can use it
pacs_admin / org_admin / super_admin. Viewing requires `pacs.archive.view`; creating/controlling jobs
and editing config require `pacs.archive.manage`.

## What it does (and does not)
It makes a **verified, lossless compressed archive** of a study's DICOM files on the archive volume —
Orthanc's native study ZIP, gzip-wrapped. It is **copy-only**: original DICOM files in Orthanc are
never deleted or modified, and DICOM transfer syntax is never changed. This is container (ZIP+gzip)
compression, not pixel/transfer-syntax recompression. Automatic source deletion is out of scope.

## 1. Configure (optional)
PACS → Archive Compression → **CONFIG**. Set the default **compression level** (0–9; higher = smaller
but slower) and **worker threads**. Source is Orthanc; the destination archive root is shown.

## 2. Archive a study
**+ Archive Study** → paste the **Study Instance UID** (copy from the worklist) → optional level →
**Create Archive Job**. The engine downloads the study ZIP, compresses it in a worker thread, records
original/compressed sizes + ratio + savings, computes a **SHA-256**, and **auto-verifies** it.

## 3. Monitor
- **MONITOR**: job queue (queued/running/completed/verified/failed/cancelled) and storage savings
  (original vs compressed totals, bytes saved, overall %).
- **JOBS**: each job with status, level, original/compressed size, savings %, verified flag, actions.

## 4. Verify / Restore
Open a completed job → **Re-verify** (re-hash + extract to confirm integrity) or **Restore / Extract**
(gunzip the archive to a restore folder and report the DICOM file count). Restore is copy-only — it
does NOT re-import into Orthanc or change any source data.

## Protections you can rely on
- A **verified archive is never overwritten** — a new job for a study that already has one fails
  with a clear message.
- Original Orthanc instances/files are never touched.
- If the backend restarts mid-archive, the job is automatically recovered (finalized if the archive is
  complete, else re-queued to retry).

## Statuses
QUEUED → RUNNING → **VERIFIED** (SHA-256 + extraction confirmed) / COMPLETED (verify pending/failed) /
FAILED / CANCELLED.

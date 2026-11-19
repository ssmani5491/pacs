# DICOM Reverse Push — User Guide

## Who can use it
- **pacs_admin / org_admin / super_admin** can view the monitor, configure destinations, and run jobs.
- Destination configuration requires `pacs.destination.manage`; running transfers requires
  `pacs.reverse-push.manage`.

## 1. Configure a destination PACS
PACS → Reverse Push → **+ Destination**. Enter: Name, destination **AE Title**, **Host/IP**, **Port**,
and your **Calling AE Title** (default GGHPACS). Save. Internal infra hosts (postgres/redis/etc.) are
refused for safety.

## 2. Test the connection
On the **DESTINATIONS** tab, click **Test C-ECHO**. This performs a real DICOM C-ECHO association to
the destination and shows SUCCESS/FAILED. The result is stored as the destination's last test status.

## 3. Push a study
**+ Push Study** → pick an active destination → paste the **Study Instance UID** (copy it from the
RIS worklist) → **Create Transfer Job**. Only studies in your organization with stored images can be
pushed. A job is created in QUEUED state and the engine starts it within a few seconds.

## 4. Monitor transfers
- **MONITOR** tab: queue + transmission summary (total/successful/failed files, success %), and
  destination connectivity.
- **JOBS** tab: every job with status, progress (success/total), transfer speed, and controls.
- **View** a job to see per-instance status, timing, and errors.

## 5. Control jobs
- **Cancel** a QUEUED/RUNNING job (safe — the DICOM association is released cleanly).
- **Retry** a FAILED or PARTIALLY_COMPLETED job — only the failed instances are re-sent.
- Pause/Resume are available via the API.

## What "successful" means
A job is **COMPLETED** only when the **destination PACS acknowledged** every C-STORE (Orthanc's store
job reports success with zero failures). A PARTIALLY_COMPLETED job had some instances fail — retry to
re-send just those. Success is never inferred from the sender alone.

## Notes
- Transfers READ from our Orthanc; source studies are never modified or deleted.
- If the backend restarts during a transfer, the job is automatically reconciled against the real
  Orthanc transfer state on the next scheduler tick (no stuck jobs).

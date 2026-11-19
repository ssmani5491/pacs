# PACS Storage Management — Architecture (PACS Operations Module 3)

## Overview
A storage-management dashboard built on **real measurements only** — no mock statistics. It reads
the live Orthanc REST API (`/statistics` + per-study `DiskSize`), the archive volume, and the host
filesystem (`statfs`), persists periodic snapshots, and from them tracks growth, forecasts capacity,
and raises Phase 8 alerts when disk utilization crosses configured thresholds.

**Strictly read-only over the data plane.** It never deletes, migrates, or modifies any DICOM
instance or archive file, never resets PostgreSQL, and never touches a Docker volume's contents.
Built on the existing 8 services — **no new Docker service** (one additive table).

## Components
```
React StorageManagement ──HTTP──> NestJS /api/pacs/storage/*
  (OVERVIEW/MODALITY/GROWTH/            │ StorageController (RBAC: view / manage)
   HISTORY/CONFIG, polls 15s)           │ StorageService (measure, snapshot, dashboard, growth, CSV)
                                        │ StorageScheduler (@Cron 01:00 daily, Redis-locked per day)
                                        ▼
                     OrthancService ──GET /statistics, /studies/{id}/statistics──> Orthanc (reads only)
                     fs.statfsSync(ARCHIVE_ROOT)  ──────────> host filesystem capacity (read only)
                     recursive walk of archive volume ─────> archive bytes (read only)
                                        │
                                        ├── PostgreSQL storage_snapshots (history, growth, forecast)
                                        ├── AlertsService.raise/recover  (Phase 8 SystemAlert)
                                        └── NotificationsService.create  (Phase 8, role fan-out)
```

## How each number is measured (real, not mock)
| Metric | Source |
|---|---|
| Orthanc storage bytes | Orthanc `/statistics` → `TotalDiskSize` |
| Patients / studies / series / instances | Orthanc `/statistics` counts |
| Modality-wise studies + bytes | RIS `study.modality` grouped; bytes summed from each study's real Orthanc `/studies/{id}/statistics` `DiskSize` |
| Archive storage bytes | recursive file-size walk of the `pacs_archive` volume |
| Disk total / used / available / % | host `fs.statfsSync(ARCHIVE_ROOT)` (`blocks`, `bavail`, `bsize`) |
| Daily / monthly growth | linear fit over `storage_snapshots` disk-used series |
| Days-until-threshold forecast | linear extrapolation of current daily rate to each threshold |

Modality bytes are joined from two real sources: **RIS knows the modality**, **Orthanc knows the
bytes**. No sizes are estimated.

## Snapshots
A snapshot is one real measurement of everything above, persisted to `storage_snapshots`. Captured:
- **daily at 01:00** by `StorageScheduler` (Redis lock `lock:storage-snapshot:<YYYY-MM-DD>`, so a
  restart on the same day can't double-capture), and
- **on demand** by an admin via `POST /api/pacs/storage/snapshot` (`pacs.storage.manage`).

The **dashboard** serves the latest snapshot if it is fresh (<10 min); otherwise it computes live
without persisting (so viewing the page never floods the history table).

## Data model (additive migration 0010_pacs_storage; search_tsv GIN preserved)
**StorageSnapshot**: `capturedAt`, `orthancBytes`, `archiveBytes`, `diskTotalBytes`,
`diskUsedBytes`, `diskAvailBytes`, `patients`, `studies`, `series`, `instances`,
`modalityBreakdown` (Json: `{ "CT": { count, bytes }, … }`). Indexed on `capturedAt`.
Alert thresholds live in `system_settings['storage.config']`. BigInt columns are serialized to
Number for JSON safety.

Migration `0010_pacs_storage` is **additive only** (`CREATE TABLE storage_snapshots` + index); it
contains no `DROP`, does not touch `studies.search_tsv` or its GIN index, and was applied via the
project's `migrate diff --from-url` flow.

## Growth & forecast
From the ordered `diskUsedBytes` series (needs ≥2 snapshots): daily growth = Δused / Δdays;
monthly = daily × 30. Forecast: for each threshold p∈{70,80,90,95}, days-until = (p%·total − used) /
dailyRate, reported with a human basis string (e.g. "4 snapshots over 0.3 days (linear)"). With <2
snapshots the API returns a note and no forecast — never a fabricated number.

## Alerts (Phase 8 integration)
On every snapshot, `evaluateAlerts` compares disk-used % to the configured thresholds and picks the
highest crossed level (INFO<WARNING<HIGH<CRITICAL). If one is crossed it calls
`AlertsService.raise({ alertKey: 'storage:disk:utilization', … })` and `NotificationsService.create`
(role `pacs_admin`, deduped per level per day, link `/pacs/storage`). If none is crossed it calls
`AlertsService.recover('storage:disk:utilization')` — so the alert auto-clears when utilization drops.
This reuses the existing alert-key dedup + auto-recover machinery from Phase 8; no new alert system.

## Security
RBAC `pacs.storage.view` (read: dashboard/growth/history/config/CSV) and `pacs.storage.manage`
(mutate: config thresholds, trigger snapshot), granted to super_admin, pacs_admin, org_admin.
Org isolation via the shared guard. No Orthanc/PG/Redis credentials exposed to the client. No
arbitrary filesystem access — reads are confined to `/statistics`, per-study statistics, and the
archive root; nothing is written to disk except `storage_snapshots` rows. Config changes, CSV
exports, and manual snapshots are audited.

## Critical protections (verified)
- Never deletes DICOM or archived files; never migrates or modifies DICOM; data plane is read-only.
- Never resets PostgreSQL; never deletes/recreates a Docker volume.
- All prior modules/services preserved; `studies_search_tsv_idx` GIN index intact.
- Uses actual data; synthetic studies are used only to exercise the dashboard in testing.

## Configuration
| Env | Default | Meaning |
|---|---|---|
| `ARCHIVE_ROOT` | /var/lib/pacs/archive | mount measured for disk capacity + archive bytes |
| `ORTHANC_URL` / `ORTHANC_USERNAME` / `ORTHANC_PASSWORD` | orthanc:8042 / … | read-only Orthanc access |
Alert thresholds (info/warning/high/critical %) are stored in `system_settings['storage.config']`
and editable via `PATCH /api/pacs/storage/config` (`pacs.storage.manage`).

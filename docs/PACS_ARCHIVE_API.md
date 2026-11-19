# PACS Archive Compression — API Reference

All endpoints require JWT + the listed permission + organization isolation.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/pacs/archive/config` | pacs.archive.view | source, destination root, default level, workers, bytes used |
| PATCH | `/api/pacs/archive/config` | pacs.archive.manage | `{ compressionLevel?(0-9), workerThreads?(1-8) }` |
| GET | `/api/pacs/archive/monitor` | pacs.archive.view | queue + storage-savings aggregate |
| GET | `/api/pacs/archive/jobs` | pacs.archive.view | filter `status`; paginated |
| GET | `/api/pacs/archive/jobs/:id` | pacs.archive.view | full job (sizes, ratio, sha256, path, verified) |
| POST | `/api/pacs/archive/jobs` | pacs.archive.manage | `{ studyInstanceUid, compressionLevel? }` → QUEUED job (409 if an active job exists; later FAILS if a verified archive already exists) |
| POST | `/api/pacs/archive/jobs/:id/cancel` | pacs.archive.manage | → CANCELLED |
| POST | `/api/pacs/archive/jobs/:id/verify` | pacs.archive.manage | re-hash SHA-256 + extract; sets verified |
| POST | `/api/pacs/archive/jobs/:id/restore` | pacs.archive.manage | gunzip + extract to restore/<id>; copy-only, no re-import |

`monitor` returns `{ queue:{queued,running,completed,verified,failed,cancelled}, storage:{archiveRoot,
archiveBytesUsed,totalOriginalBytes,totalCompressedBytes,totalSavingsBytes,overallSavingsPercent},
config:{defaultCompressionLevel,workerThreads} }`.

Job fields: originalBytes, compressedBytes (numbers), compressionRatio, savingsPercent, sha256,
archivePath, verified, verifyDetail, compressionLevel, instanceCount, status, timing, error.

## Permissions added
`pacs.archive.view`, `pacs.archive.manage` (super_admin, pacs_admin, org_admin).

## Audit actions
ARCHIVE_CONFIG_UPDATE, ARCHIVE_JOB_{CREATE,CANCEL,VERIFY,RESTORE,DONE}.

## Config variables
`ARCHIVE_ROOT` (default /var/lib/pacs/archive), `ARCHIVE_WORKERS` (default 2).

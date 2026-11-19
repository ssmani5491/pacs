# DICOM Reverse Push — API Reference

All endpoints require JWT + the listed permission + organization isolation.

## Destinations
| Method | Path | Permission |
|---|---|---|
| GET | `/api/pacs/destinations` | pacs.reverse-push.view |
| GET | `/api/pacs/destinations/:id` | pacs.reverse-push.view |
| POST | `/api/pacs/destinations` | pacs.destination.manage |
| PATCH | `/api/pacs/destinations/:id` | pacs.destination.manage |
| POST | `/api/pacs/destinations/:id/test` | pacs.destination.manage |

Create/update body: `name, aeTitle, host, port, callingAet?, connectionTimeout?, associationTimeout?,
maxConcurrent?, active?, description?`. Host is validated (SSRF: internal infra names refused → 400).
`/test` performs a real DICOM C-ECHO via Orthanc's native SCU and records lastTest{At,Status,Detail}.

## Reverse push monitor + jobs
| Method | Path | Permission |
|---|---|---|
| GET | `/api/pacs/reverse-push/monitor` | pacs.reverse-push.view |
| GET | `/api/pacs/reverse-push/jobs` | pacs.reverse-push.view |
| GET | `/api/pacs/reverse-push/jobs/:id` | pacs.reverse-push.view |
| POST | `/api/pacs/reverse-push/jobs` | pacs.reverse-push.manage |
| POST | `/api/pacs/reverse-push/jobs/:id/pause` | pacs.reverse-push.manage |
| POST | `/api/pacs/reverse-push/jobs/:id/resume` | pacs.reverse-push.manage |
| POST | `/api/pacs/reverse-push/jobs/:id/cancel` | pacs.reverse-push.manage |
| POST | `/api/pacs/reverse-push/jobs/:id/retry` | pacs.reverse-push.manage |

Create job body: `{ destinationId, studyInstanceUid }`. Returns the QUEUED job (409 if an active job
for the same destination+study already exists). Jobs list supports `status`, `destinationId`, paging.

`monitor` returns `{ engine, queue:{pending,queued,active,completed,partiallyCompleted,failed,
cancelled}, transmission:{totalFiles,successFiles,failedFiles,successPercent}, destinations[] }`.

Job detail includes `instances[]` (SOP Instance UID + per-instance status).

## Permissions added
`pacs.reverse-push.view`, `pacs.reverse-push.manage`, `pacs.destination.manage`
(assigned to super_admin, pacs_admin, org_admin).

## Audit actions
PACS_DESTINATION_{CREATE,UPDATE,TEST}, PACS_REVERSE_PUSH_{CREATE,PAUSE,RESUME,CANCEL,RETRY,DONE}.

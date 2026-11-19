# PACS Operations History — API (PACS Operations Module 4)

Base path: `/api/pacs/operations/history`. All routes require JWT. No route-level permission
decorator: the service requires **at least one** of `pacs.reverse-push.view` / `pacs.archive.view`
(super admin = both). Patient MRN is included only for callers with `patient.view`; the archive path
only for callers with `pacs.archive.manage`. Org isolation on every query.

| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard` | Unified summary (reverse-push + archive totals, byte sums, savings, recent ops) |
| GET | `/list` | Unified history list (both sources), filtered/paginated/sorted |
| GET | `/reverse-push` | Reverse-push history list (requires reverse-push.view) |
| GET | `/archive` | Archive history list (requires archive.view) |
| GET | `/export?kind=` | CSV export: kind ∈ reverse-push \| archive \| unified \| summary |
| GET | `/reverse-push/:jobId` | Reverse-push detail incl. instance-level results, retries |
| GET | `/archive/:jobId` | Archive detail (archivePath only with manage) |
| POST | `/archive/:jobId/verify` | **Non-mutating** integrity re-check; audited; mutates nothing |

## Common query parameters (list / dashboard / export)
`range` (today \| 7d \| 30d \| all \| custom), `from`, `to` (ISO dates; for `custom`),
`type` (REVERSE_PUSH \| ARCHIVE; unified list only), `status`, `destinationId` (reverse-push),
`patientMrn`, `studyUid`, `modality`, `createdBy`, `verified` (true/false; archive),
`page` (default 1), `pageSize` (default 25, max 200), `sortBy` (createdAt \| completedAt \| status),
`sortDir` (asc \| desc, default desc). Bad/`from>to` custom windows resolve to an empty result, not a 500.

## GET /dashboard (shape)
```json
{
  "range": "all",
  "reversePush": { "total": 6, "success": 4, "failed": 0, "partial": 0, "pending": 0, "cancelled": 2 },
  "archive": { "total": 4, "verified": 2, "completed": 0, "failed": 1, "pending": 0,
               "originalBytes": 5337596, "compressedBytes": 3973504,
               "savingsBytes": 1364092, "savingsPercent": 25.6 },
  "recent": [ { "type": "ARCHIVE", "id": "…", "studyInstanceUid": "…", "patientMrn": "VIEWERVOL01",
                "modality": "CT", "status": "VERIFIED", "createdAt": "…", "summary": { … } } ],
  "generatedAt": "…"
}
```
Only the caller's visible sources are populated (`reversePush` / `archive` may be `null`).

## GET /list, /reverse-push, /archive (shape)
```json
{ "data": [ OperationRow, … ], "total": 10, "page": 1, "pageSize": 25, "totalPages": 1 }
```
`OperationRow = { type, id, studyInstanceUid, patientMrn|null, modality|null, status, createdBy,
createdAt, startedAt, completedAt, summary }`. `summary` is type-specific:
- REVERSE_PUSH: `{ destination{id,name,aeTitle}, totalInstances, successInstances, failedInstances, pendingInstances, retryCount, durationMs }`
- ARCHIVE: `{ originalBytes, compressedBytes, compressionRatio, savingsPercent, instanceCount, sha256, verified, durationMs }`

`/list` `total` = reverse-push count + archive count (disjoint; no duplicate counting).

## GET /reverse-push/:jobId
Full job + `destination {name,aeTitle,host,port}` + `instances[] {sopInstanceUid,status,error,sentAt}`
+ `retryCount`, `lastError`, `transferSpeedKbps`, timestamps. Cross-org → 403.

## GET /archive/:jobId
Full job: sizes, ratio, `savingsPercent`, `compressionLevel`, `workerCount`, `instanceCount`,
`sha256`, `verified`, `verifyDetail`, timestamps. `archivePath` present only with `pacs.archive.manage`.
Cross-org → 403.

## POST /archive/:jobId/verify  (non-mutating)
Re-hashes + re-extracts the stored archive and compares to the recorded `sha256`. Returns
`{ jobId, ok, detail }`. **Modifies no ArchiveJob/verification record and no archive file** — the
job's `verified`/`verifiedAt`/`status` are unchanged. Writes an `OPS_HISTORY_ARCHIVE_REVERIFY` audit
event. Requires `pacs.archive.view` (super admin ok).

## GET /export?kind=…
`Content-Type: text/csv`. Line 1 = provenance comment; line 2 = column header. Up to 10,000 rows.
Cells formula-injection-escaped. Patient MRN column present only with `patient.view`. Writes an
`OPS_HISTORY_EXPORT` audit event. Headers per kind:
- reverse-push: `jobId,destination,[patientMrn,]studyInstanceUid,modality,totalInstances,successInstances,failedInstances,status,createdBy,createdAt,completedAt`
- archive: `jobId,[patientMrn,]studyInstanceUid,modality,originalBytes,compressedBytes,savingsPercent,sha256,verified,status,createdBy,completedAt`
- unified: `type,id,[patientMrn,]studyInstanceUid,modality,status,createdBy,createdAt,completedAt`
- summary: `metric,value`

## Errors
`401` missing/expired JWT · `403` neither source permission, or cross-org · `404` job not found.

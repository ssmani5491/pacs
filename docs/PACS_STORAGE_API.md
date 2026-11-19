# PACS Storage Management — API (PACS Operations Module 3)

Base path: `/api/pacs/storage`. All routes require JWT. Permissions: **`pacs.storage.view`** (reads)
and **`pacs.storage.manage`** (mutations). Granted to super_admin, pacs_admin, org_admin.

| Method | Path | Perm | Purpose |
|---|---|---|---|
| GET | `/dashboard` | view | Full real-time snapshot: orthanc, archive, disk, modalityBreakdown, thresholds, alertLevel, growth |
| GET | `/config` | view | Current alert thresholds + archiveRoot |
| PATCH | `/config` | manage | Update thresholds `{ info, warning, high, critical }` (1–100, clamped); audited |
| GET | `/growth` | view | daily series + dailyGrowthBytes + monthlyGrowthBytes + forecast (or a note if <2 snapshots) |
| GET | `/history?page&pageSize` | view | Paginated snapshot history (pageSize ≤ 200) |
| GET | `/history/export` | view | CSV download of up to 5000 snapshots; audited (`STORAGE_HISTORY_EXPORT`) |
| POST | `/snapshot` | manage | Capture one real snapshot now + evaluate alerts; audited |

## GET /dashboard (shape)
```json
{
  "orthanc": { "bytes": 324202939, "patients": 6, "studies": 10, "series": 16, "instances": 2489 },
  "archive": { "bytes": 3973504 },
  "disk": { "totalBytes": 1081101176832, "usedBytes": 126872621056, "availableBytes": 954228555776,
            "usedPercent": 11.7, "orthancPercent": 0, "archivePercent": 0 },
  "modalityBreakdown": [ { "modality": "CT", "count": 9, "bytes": 324196112 },
                         { "modality": "OTHER", "count": 1, "bytes": 6827 } ],
  "thresholds": { "info": 70, "warning": 80, "high": 90, "critical": 95 },
  "alertLevel": null,
  "growth": { "daily": [ { "at": "…", "usedBytes": … } ],
              "dailyGrowthBytes": 345915599, "monthlyGrowthBytes": 10377467974,
              "forecast": { "daysUntil": { "p70": 1821, "p80": 2134, "p90": 2446, "p95": 2602 },
                            "basis": "4 snapshots over 0.3 days (linear)" } },
  "generatedAt": "…"
}
```

## GET /growth (shape)
Same `growth` object as above. With fewer than 2 snapshots:
```json
{ "daily": [], "dailyGrowthBytes": null, "monthlyGrowthBytes": null, "forecast": null,
  "note": "need >=2 snapshots for growth; forecast unavailable" }
```

## PATCH /config (body)
```json
{ "thresholds": { "info": 70, "warning": 80, "high": 90, "critical": 95 } }
```
Values are clamped to 1–100; omitted keys keep their default. Returns the stored config.

## GET /history/export (CSV)
`Content-Type: text/csv`. Line 1 is a provenance comment (`# Storage history export | by <user> | <iso> | <n> rows`);
line 2 is the header `capturedAt,orthancBytes,archiveBytes,diskTotalBytes,diskUsedBytes,diskAvailBytes,diskUsedPercent,patients,studies,series,instances`.
Cell values are passed through a formula-injection guard (leading `= + - @` prefixed with `'`).

## Errors
- `403` — missing `pacs.storage.view`/`manage`, or cross-org access.
- `401` — missing/expired JWT.

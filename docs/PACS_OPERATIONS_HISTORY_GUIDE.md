# PACS Operations History — Operator Guide (PACS Operations Module 4)

## Who can use it
Anyone with `pacs.reverse-push.view` **or** `pacs.archive.view` (super admin, pacs_admin, org_admin).
You see only the source(s) you're permitted: reverse-push data needs reverse-push.view, archive data
needs archive.view. Patient IDs (MRNs) appear only if you also hold `patient.view`. Others get 403.

## Opening the page
Sidebar → **PACS Operations → Transfer & Archive History** (`/pacs/operations/history`). Four tabs,
plus a date-range selector (Today / Last 7 days / Last 30 days / All / Custom) on every tab.

### DASHBOARD
Summary cards for the selected date range:
- **Reverse Push**: total jobs, successful, failed, pending.
- **Archive**: total jobs, verified, failed, original size, compressed size, savings (bytes + %).
- **Recent Operations**: the latest operations across both sources; click a row for detail.

### UNIFIED
Both sources in one table (type badge PUSH/ARCHIVE), with the filter panel, status badges, server-side
pagination, and sortable Created/Completed/Status columns. Each row shows a compact summary
(reverse-push: `ok/total`; archive: `original → compressed (saved %)`). Click a row for detail.

### REVERSE PUSH / ARCHIVE
Single-source tables with the same filters, sorting, and pagination. The archive tab adds a
verification filter (Any / Verified / Not verified).

### Filters (combinable)
Date range, status, modality, patient MRN (if permitted), study UID, created-by, and — on the archive
tab — verification status. Filtering is server-side; the browser never loads the whole history.

## Operation detail (drawer)
Click any row:
- **Reverse push**: destination (AE@host:port), counts + retries, last error, and the full
  instance-level table (each SOP Instance UID with SUCCESS/FAILED + error + sent time).
- **Archive**: sizes, ratio, savings, compression level, worker count, SHA-256, verification result,
  and timestamps. The **archive path** is shown only to users with archive *manage*.

## Re-verify integrity (archive)
In an archive detail drawer, **Re-verify integrity (read-only)** re-hashes and re-extracts the stored
archive and reports OK/FAILED. It is **non-mutating**: it changes no job record, no verification flag,
and no archive file — it only records an audit event. Use it to confirm an archive is still intact
without altering its history.

## CSV export
**Export CSV** exports the current tab with the active filters (dashboard → summary; the three list
tabs → their rows), up to 10,000 rows. Files carry a provenance line (who/when/row count) and are
formula-injection-safe. Patient MRNs are included only if you hold `patient.view`. Every export is
audited.

## What it never does
This is a reporting module. It never deletes DICOM or archives, never migrates studies, never modifies
original DICOM, and never changes any job or verification record. It only reads, reports, and exports.

# PACS Storage Management — Operator Guide (PACS Operations Module 3)

## Who can use it
Users with `pacs.storage.view` (super_admin, pacs_admin, org_admin) see the dashboard; those with
`pacs.storage.manage` can edit alert thresholds and trigger a snapshot. Other roles get 403.

## Opening the page
Sidebar → **PACS → Storage Management** (`/pacs/storage`). The page polls every 15 seconds. Tabs:

### OVERVIEW
- **Capacity**: disk-utilization gauge (`used / total`, colour-coded against thresholds), available
  space, Orthanc storage, archive storage.
- **PACS Statistics**: patient / study / series / instance counts (live from Orthanc).
If utilization has crossed a threshold, a banner appears at the top and an alert is raised in
**Operations → Alert Management**.

### MODALITY
Per-modality table: studies, storage consumed, and share of total. Bytes are the sum of each study's
real Orthanc disk size, grouped by the RIS modality.

### GROWTH
Daily and monthly growth, plus a **forecast** of days until each threshold (70/80/90/95%) at the
current rate, with the basis (how many snapshots over how many days). Needs ≥2 snapshots; until then
it shows a "need more snapshots" note rather than a guessed number.

### HISTORY
Every captured snapshot (newest first). **Export CSV** downloads the full history for spreadsheets or
long-term capacity records.

### CONFIG (manage only)
Edit the four alert thresholds (% disk used). Crossing one raises a system alert + notification to
PACS admins. Values are clamped to 1–100.

## Snapshots
- Automatic: once daily at 01:00 (one per day, cluster-safe via a Redis lock).
- Manual: **Capture Snapshot** button (manage permission) records one immediately and re-evaluates
  alerts — useful right after a large import or before a capacity review.

## What it will never do
It is a **monitoring** tool. It never deletes DICOM or archive files, never migrates or moves studies,
never modifies DICOM, and never changes Orthanc/PostgreSQL storage. Freeing space is always a manual,
out-of-band operation; this module only measures, reports, and warns.

## Reading an alert
When the disk crosses a threshold: the dashboard banner shows the level and %, a `SystemAlert`
(`storage:disk:utilization`) appears in Alert Management, and PACS admins get a notification linking
back here. When utilization drops below the lowest threshold again, the alert auto-recovers.

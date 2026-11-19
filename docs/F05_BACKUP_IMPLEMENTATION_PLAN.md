# F-05 Backup Implementation Plan (Proposal, Not Approved, Not Implemented)

**Status: PLAN ONLY.** No backup job was created, scheduled, or modified. No existing backup was
deleted. This document proposes a strategy addressing every gap in `F05_BACKUP_GAP_REGISTER.md`;
nothing here has been built.

## 1. Strategy evaluation (per the brief's checklist)

| Approach | Verdict for this system | Reasoning |
|---|---|---|
| PostgreSQL **logical** backups (`pg_dump`) | **Recommended, for both `ris` and `orthanc`** | Already proven to work and restore correctly (Phase 9, for `ris`); simple, human-inspectable, works at this data scale (34 MB + 22 MB today); the only change needed is running it against **both** databases, on a **schedule**, not as a one-off |
| PostgreSQL **physical** backups (`pg_basebackup`) or WAL archiving | **Not recommended yet, revisit at scale** | Gives point-in-time recovery, which this system doesn't have today (noted as a known limitation in the existing Phase 9 doc) — but adds real operational complexity (continuous WAL shipping, more storage, more to monitor) that isn't justified at 34–56 MB of total database size. Logical backups are proportionate to this system's actual current size; physical/WAL should be reconsidered if either database grows to a size where a daily full logical dump becomes impractically slow or large. |
| Orthanc **index** backup | **Recommended — close BG-01 directly**: add `orthanc` as a second `pg_dump` target alongside `ris`, same mechanism, same schedule | No new technology needed — this is literally running the same already-working command against a second, known database name |
| DICOM **storage** backup | **Recommended: volume-level archive (`tar`/`rsync`) of `orthanc_storage`, taken at a consistent moment with the Orthanc index dump** | The brief's own concern about consistency during active C-STORE is real; mitigate by either (a) a brief, scheduled low-activity window (e.g. overnight) for the volume snapshot, or (b) using a filesystem/volume-snapshot mechanism if the host platform offers one, rather than a live `tar` during arbitrary activity. This plan does not pick between (a)/(b) without owner input — see §5. |
| PACS **archive** backup | **Recommended: same volume-archive approach as DICOM storage, for `pacs_archive`**, taken alongside the `ris` dump (since `archive_jobs` metadata lives in `ris`) | Much smaller (currently 3.97 MB) and lower-churn than Orthanc's own storage, so the consistency risk is proportionally smaller, but the same "metadata and files together" principle applies |
| **Encrypted off-host copies** | **Recommended, with an owner decision on the destination** (see open items) | Addresses BG-06 and BG-07 together: encrypt each backup artifact at rest (e.g. with a key the hospital's own key-management process controls — this plan does not invent a key-management mechanism) and copy to a location that is **not** this same host/disk. Destination is explicitly an owner decision (network share, removable media, a separate on-prem server, etc.) — this plan does not assume internet connectivity or unlimited storage, per the brief, and does not propose a specific cloud target. |
| **Retention** (daily/weekly/monthly) | **Recommended: a simple tiered policy** — e.g. keep the last 7 daily backups, the last 4 weekly (Sunday) backups, and the last 3 monthly (1st-of-month) backups, pruning everything older. This is a proposed *starting* policy, not a requirement derived from any stated hospital retention rule (none was provided) — **flagged for owner confirmation**, since clinical-data retention rules vary by jurisdiction and hospital policy in ways this codebase cannot determine. |
| **Backup monitoring / failure alerts** | **Recommended: reuse the existing Phase 8 alerting system** (`AlertsService.raise` + `NotificationsService`) — the same mechanism already used for service-health and storage-threshold alerts. A new background job (same pattern as the existing `@nestjs/schedule` + Redis-lock jobs in Modules 1–3) would run the backup, and raise a CRITICAL alert on failure or if the last successful backup is older than the expected interval (mirrors the existing storage-threshold alert pattern exactly). |
| **Periodic restore testing** | **Recommended: a scheduled, isolated restore drill** (reusing the exact "spin up a throwaway container, restore into it, verify, tear down, never touch the live stack" method already proven in Phase 9 and reused multiple times this session for the F-02 seed testing) — e.g. monthly, covering all four critical artifacts (`ris`, `orthanc`, `orthanc_storage`, `pacs_archive`), not just `ris` as today. |

## 2. Proposed architecture

```
Scheduled job (new; same pattern as existing @nestjs/schedule + Redis-lock jobs)
  │
  ├─ pg_dump -d ris     → gzip → <local staging>/ris-<date>.sql.gz
  ├─ pg_dump -d orthanc → gzip → <local staging>/orthanc-<date>.sql.gz    (closes BG-01)
  ├─ tar of orthanc_storage volume → <local staging>/orthanc_storage-<date>.tgz   (closes BG-02)
  ├─ tar of pacs_archive volume    → <local staging>/pacs_archive-<date>.tgz      (closes BG-03)
  │
  ├─ encrypt each artifact (key management = owner decision, §5)          (addresses BG-07)
  ├─ copy encrypted artifacts to an off-host destination (owner decision, §5)   (addresses BG-06)
  ├─ apply retention policy to both local staging and the off-host copy   (addresses BG-08)
  └─ raise a Phase-8 alert on any step's failure, or if no successful run
     has completed within the expected interval                          (addresses BG-09)

Monthly (separate, lower-frequency job or manual runbook):
  └─ isolated-container restore drill, all four artifacts, verified against
     the method already proven in Phase 9 + this session's F-02 testing   (addresses BG-10)
```

This reuses **three mechanisms this project already has working code for**: `@nestjs/schedule` +
Redis-lock background jobs (Modules 1–3), the Phase 8 alerting/notification system, and the
isolated-throwaway-container restore-verification method (Phase 9, and reused twice more in this
session for F-02's seed-scenario testing). No new technology category is introduced.

## 3. Recovery order (ties back to the DR plan)

For any restore involving more than one artifact, the order matters, per the consistency dependencies
established in `F05_DISASTER_RECOVERY_PLAN.md`:

1. **Databases first** (`ris`, `orthanc`) — restore both from backups taken at mutually consistent
   times (ideally the same scheduled run).
2. **Volumes second** (`orthanc_storage`, `pacs_archive`) — restored from the backup taken alongside
   the same database snapshot, never a different one.
3. **Services last** — start `postgres` → `orthanc` → `backend` → everything else, in the dependency
   order already expressed by `docker-compose.yml`'s own `depends_on` chain (unchanged by this plan).
4. **Verification after every restore**, before declaring it complete — the integrity checks named in
   each DR scenario, not a bare "the restore command exited 0."

## 4. Verification strategy
- **Per-run**: after every scheduled backup, a lightweight check (e.g. `gzip -t` on each dump, confirm
  the volume tar's file count roughly matches the live instance/study count at dump time) — catches a
  truncated/corrupt backup immediately rather than discovering it during a real incident.
- **Monthly**: the full isolated-restore drill described above, for all four artifacts, with the same
  row-count/hash/GIN-index/signature checks already used in the one validated Phase 9 restore —
  extended to cover Orthanc and the archive volume, which have never had this done.
- **Never claim success without running it** — consistent with every test report produced in this
  project: a backup or restore is "PASS" only after being actually executed and checked, never assumed
  from the job merely completing without an explicit error.

## 5. Rollback considerations
- Implementing this plan is **additive** — a new scheduled job, new backup artifacts, optionally a new
  off-host destination. It does not modify how the live application reads or writes to Postgres,
  Orthanc, or the volumes. **Rolling back this implementation (if something about the new backup job
  itself misbehaves) is simply disabling the new scheduled job** — it carries no risk to the live data
  path, since backup jobs are read-only against the live system (they copy, they never write back).
- The one thing requiring care: if encryption-at-rest is implemented (§1), the **decryption key must
  itself be backed up/escrowed** through a process this plan does not invent — losing the key would
  make every encrypted backup artifact permanently unreadable, which would be a self-inflicted version
  of the very data-loss this plan exists to prevent. This is called out explicitly as a dependency on
  an owner decision, not assumed solved.

## 6. Decisions requiring owner approval (nothing below has been decided by this plan)
1. **Off-host backup destination** — network share, separate physical server, removable media, or
   something else? (The brief explicitly says not to assume internet connectivity or unlimited
   storage — this plan does not propose a cloud target without that being confirmed as viable.)
2. **Encryption key management** — who holds the key, how is it itself backed up/escrowed, what
   happens if the person/system holding it is unavailable during a real recovery?
3. **Retention policy numbers** — the 7-daily/4-weekly/3-monthly tiering above is a reasonable
   **starting proposal**, not a requirement derived from a stated hospital policy; confirm or adjust.
4. **Backup schedule/frequency** — daily is proposed as the default cadence for all four artifacts;
   confirm this matches acceptable data-loss exposure (an hourly cadence would shrink the exposure
   window but increase storage/overhead — this is a real tradeoff requiring a decision, not a
   technical fact this plan can settle alone).
5. **Volume-snapshot consistency method for `orthanc_storage`** — a scheduled low-activity window vs.
   a platform-level volume-snapshot mechanism (§1); which is actually available/acceptable depends on
   infrastructure this codebase cannot inspect (e.g. whether the hospital's eventual production host
   offers LVM/ZFS snapshots or similar).
6. **Whether this implementation work is approved to begin at all** — this entire document is a
   proposal; no part of it should be built without explicit approval, consistent with every other
   remediation phase in this project's history.

---

**No backup job was created. No existing backup was deleted or modified. No database was restored.
No volume was removed. No service was restarted. All eight services and the NGINX dynamic-DNS
configuration remain exactly as they were before this investigation began.**

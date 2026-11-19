# F-05 NAS Backup — Architecture (Proposal, Not Implemented)

**Status: DESIGN ONLY.** Builds directly on `F05_BACKUP_CURRENT_STATE.md`,
`F05_BACKUP_GAP_REGISTER.md`, and `F05_NAS_CONNECTIVITY_DESIGN.md` from this same investigation. No
component below has been built.

## 1. Components and their protection design

| Component | Current gap (from the register) | Proposed protection |
|---|---|---|
| **RIS PostgreSQL** (`ris`, 34 MB live) | Manual, stale, on-host only (BG-04/05/06) | `pg_dump -d ris \| gzip`, same mechanism already proven in Phase 9 — just run on-demand/scheduled, written to the NAS instead of the local `backups/` folder |
| **Orthanc PostgreSQL index** (`orthanc`, 22 MB live) | **Never backed up at all** (BG-01) | Same mechanism, second target: `pg_dump -d orthanc \| gzip` — this single addition closes BG-01 |
| **Orthanc DICOM storage** (`orthanc_storage`, 324.2 MB, 2489 instances) | **Never backed up** (BG-02) | Volume-level archive (`tar`) of the named volume's data directory, taken at a moment consistent with the `orthanc` DB dump (§ consistency plan) |
| **PACS archive** (`pacs_archive`, 3.97 MB, 5 jobs) | **Never backed up** (BG-03) | Same volume-archive approach, taken alongside the `ris` dump (its metadata lives in `ris`) |
| **Compose + application config** | One stale snapshot (BG-11) | A simple file copy of `docker-compose.yml`, `nginx/*.conf`, `orthanc/on-stored.lua`, `orthanc/worklist/`, `mwl-scp/mwl_scp.py`, `ohif/app-config.js`, `backend/prisma/migrations/` — these are already plain files in this project directory; the backup job tars them the same way it tars the Docker volumes |
| **Recovery-critical secrets and certificates** | No backup exists; `.env` holds real values, never copied anywhere today | **Encrypted separately from everything else** (its own artifact, its own access restriction — see §5), since a secrets backup is a different risk class from a DICOM-image backup: losing it is bad, but an *exposed* copy of it is worse than an exposed DICOM image. Never stored unencrypted at any point, including local staging. |
| **Redis** (`redis_data`, ~59 KB) | No backup; **this is correct, not a gap** | Per the brief's instruction to handle Redis "according to its actual persistence and recovery requirements": Redis's contents (refresh tokens, self-expiring job locks) are either re-issuable (re-login) or self-healing (PX-TTL locks) — confirmed by code inspection and the Phase 9 restart test. **No backup of `redis_data` is proposed.** Its RDB persistence already protects against a simple container restart; a full loss just means everyone re-authenticates, which is an acceptable, already-documented behavior, not a gap requiring new protection. |

## 2. Overall flow (ties the connectivity design's 9 steps to these components)

```
On-demand trigger (API call, pacs_admin/super_admin only — see §4)
  │  OR scheduled trigger (@Cron, same Redis-lock pattern as storage.scheduler.ts)
  ▼
[Connectivity Design steps 1-4: connect, auth, verify reachable, verify capacity]
  ▼
Create dated directory on NAS (step 5)
  ▼
Execute, IN THIS ORDER (step 6), writing into that one dated directory:
  1. pg_dump -d ris     → gzip → encrypt → <dir>/ris-<ts>.sql.gz.enc
  2. pg_dump -d orthanc → gzip → encrypt → <dir>/orthanc-<ts>.sql.gz.enc
       (both DB dumps taken back-to-back, inside the same run, to minimize the
        time gap between them — see the consistency plan for why this matters)
  3. tar orthanc_storage volume → encrypt → <dir>/orthanc_storage-<ts>.tgz.enc
  4. tar pacs_archive volume    → encrypt → <dir>/pacs_archive-<ts>.tgz.enc
  5. tar config files           → encrypt → <dir>/config-<ts>.tgz.enc
  6. encrypt .env's real values → <dir>/secrets-<ts>.enc   (SEPARATE artifact, SEPARATE
                                                              access restriction, see §5)
  ▼
[Connectivity Design steps 7-8: checksum + completeness verify, write manifest + app record]
  ▼
[Connectivity Design step 9: disconnect NAS safely]
  ▼
Phase-8 notification: success or failure, to pacs_admin/super_admin
```

## 3. Reuse of existing infrastructure (no new technology category introduced)

- **Trigger mechanism**: a new `BackupController`/`BackupService` pair, same shape as every existing
  PACS Operations module (`ReversePushController`/`Service`, `ArchiveController`/`Service`, etc.) —
  `POST /api/pacs/backup/run` for on-demand, gated by a permission following the exact pattern already
  established (`pacs.backup.manage` — a **new** permission, since none of the existing ones cover
  this; flagged as a decision requiring the same approval process every other new permission in this
  project has gone through, not assumed).
- **Scheduling (if a recurring cadence is also wanted alongside on-demand)**: `@Cron(...)` +
  the Redis `SET key 1 PX <ttl> NX` lock, identical in shape to `storage.scheduler.ts` — "only one
  backup run per calendar day" exactly mirrors "only one storage snapshot per calendar day."
- **Alerting**: `AlertsService.raise({ source: 'BACKUP', level: ... })` +
  `NotificationsService.create({ category: 'SYSTEM_ALERT', roleKey: 'pacs_admin', ... })` — the exact
  calls already used by the storage-threshold alert path, pointed at a new `source` value.
- **Audit**: `AuditService.log({ action: 'BACKUP_RUN_...', ... })` — same append-only audit mechanism
  used by every other mutating/sensitive action in this project.
- **Worker isolation for large volume tars**: the existing `worker_threads` pool pattern from
  `ArchiveService`/`archive.worker.ts` (Module 2) is the natural model for running the
  `orthanc_storage` tar+encrypt off the Node event loop, rather than inventing a new concurrency
  approach.
- **Run history surfaced to operators**: a new tab/section in the existing Command Centre
  (`OperationalCommandCentre.tsx`, Module 5) — "Backup Status" alongside the existing
  transfer/archive/storage/health tiles — rather than a standalone new UI page, keeping with Module
  5's own "one operational picture" design intent.

## 4. RBAC design

- **New permission proposed**: `pacs.backup.view` (see run history/manifests) and
  `pacs.backup.manage` (trigger an on-demand run, change schedule/retention settings) — following the
  exact `*.view`/`*.manage` split already used by every PACS Operations module (reverse-push, archive,
  storage). **This requires the same explicit approval every other new permission in this project has
  needed** — not introduced without that step.
- **No broad permission** — consistent with the project's standing rule, `super_admin` and the
  specific new permission are the only paths to triggering a backup; no existing unrelated permission
  (e.g. `pacs.archive.manage`) is overloaded to also mean "can trigger a NAS backup."
- **Organization isolation**: **does not apply in the usual per-study sense** — a backup run is a
  whole-system operation (it dumps both entire databases and both entire volumes), not scoped to one
  organization's data. This is stated explicitly here because every other module in this project
  enforces org isolation on reads, and a reviewer should not mistake a backup job's necessarily
  whole-system scope for an org-isolation gap — it is an intentional, correct difference in kind, not
  an oversight.

## 5. Security design

- **Encrypted backup files**: every artifact (database dumps, volume tars, config tar, and
  especially the secrets artifact) is encrypted **before** it is written to the NAS — the NAS itself
  is never trusted with plaintext clinical data or secrets, consistent with "the NAS is not
  permanently connected" implying it may not be a fully trusted, access-controlled destination at all
  times.
- **Separate encryption-key storage**: the key used to encrypt backup artifacts **must not** live on
  the NAS itself (an attacker or failure that compromises the NAS would then have both the ciphertext
  and the key) and **must not** live only on the single Docker host being backed up (the exact single
  point of failure this whole effort exists to remove). Recommended: the key lives in a location
  independent of both — e.g. a password manager / secrets vault the hospital's IT team already
  controls, or a physically separate, access-controlled location. This plan does not invent a
  key-management product; it states the requirement and flags the specific storage location as an
  owner decision (carried over from the prior F-05 implementation plan's open item #2).
- **Secure NAS credentials**: stored in a credentials file outside the project repository, under
  restrictive permissions — reusing the exact pattern already proven working in this session's F-02
  remediation (the test-credentials file move to `C:\Users\<user>\...` + `icacls /inheritance:r` +
  explicit grants to only the running account/SYSTEM/Administrators). Never passed as a command-line
  argument (visible in process lists/shell history).
- **Least-privilege NAS account**: a **dedicated** NAS user account, not an administrative/shared one,
  with write-only (or write+limited-read-for-verification) access scoped to exactly one backup folder
  on the NAS — never the NAS's full filesystem or admin functions. This account's creation happens on
  the NAS device itself (hospital IT's own NAS administration), outside what this codebase can
  configure — flagged as a dependency, not something this plan can create.
- **Backup access restrictions**: the backup folder on the NAS should be readable only by the backup
  account and whichever hospital-IT accounts are designated for disaster recovery — not a general
  shared folder. This is a NAS-side ACL configuration decision, same caveat as the account itself.
- **SHA-256 integrity verification**: covered in depth in the connectivity design's step 7 — computed
  pre-transfer and re-verified post-transfer, reusing the same hashing approach already proven in
  `ArchiveService`.
- **Protection against accidental overwrite**: the dated-directory-per-run design (connectivity
  design step 5) is the primary mechanism — no run ever writes into a path a prior run used. A
  secondary protection: the backup account's NAS permissions should be **append/create only** on the
  backup root (no delete/modify permission on prior dated directories), so even a bug in the backup
  job itself cannot overwrite or delete an earlier generation — only the separate, deliberate
  retention-pruning step (run with different, broader permissions, ideally a separate credential) can
  remove old generations.
- **Backup failure notifications**: covered in the connectivity design's failure-mode table — every
  failure class raises a Phase-8 alert at an appropriate severity, reusing existing infrastructure.

## 6. What this architecture explicitly does not do
- Does not implement anything — no script, job, or permission exists yet.
- Does not change Redis's backup posture (deliberately, per §1 — this is a reasoned "no," not an
  oversight).
- Does not pick a specific off-NAS secondary destination, key-management product, or exact retention
  numbers — these remain owner decisions from the prior F-05 implementation plan, carried forward
  unchanged by this NAS-specific design.

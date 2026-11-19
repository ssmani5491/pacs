# F-05 NAS Backup — Connectivity Design (Proposal, Not Implemented)

**Status: DESIGN ONLY.** No NAS was connected. No credential was created or exposed. No volume,
database, or service was touched.

## 1. Environment facts this design depends on (verified today)

- **Docker engine runs inside a WSL2 Linux VM** on this Windows host — confirmed:
  `Kernel Version: 6.6.114.1-microsoft-standard-WSL2`, `OSType: linux`, `Server Version: 29.4.3`
  (`docker info`). This is the single most important fact for the NAS design: **any mount must happen
  from inside the Linux context Docker actually runs in**, not from Windows Explorer/PowerShell
  directly — a Windows-mapped network drive is invisible to the containers.
- **All four backup-relevant Docker volumes are named volumes** (`pg_data`, `orthanc_storage`,
  `pacs_archive`, `redis_data`), physically stored at
  `/var/lib/docker/volumes/pacs-replica_<name>/_data` **inside that Linux VM** — already established
  in `F05_BACKUP_CURRENT_STATE.md`.
- **Existing scheduler infrastructure**: `@nestjs/schedule` `@Cron(...)` jobs guarded by a Redis
  `SET key 1 PX <ttl> NX` lock (one job per calendar unit, restart-safe) — the exact pattern in
  `backend/src/pacs/storage.scheduler.ts`, already proven across Modules 1–3. A NAS backup job would
  reuse this shape, not invent a new one.
- **Existing notification/alert infrastructure**: `AlertsService.raise` + `NotificationsService`
  (Phase 8), already used for storage-threshold and service-health alerts — the natural home for
  "NAS unreachable" / "backup failed" notifications.
- **The NAS is not permanently connected** — per your statement, it is made available only when a
  backup runs. This rules out a simple "always-mounted volume in `docker-compose.yml`" approach as
  the primary mechanism, since the mount target won't exist most of the time — the design below treats
  connect/verify/disconnect as explicit steps in the backup job itself, not a standing mount.

## 2. Protocol comparison — SMB vs. NFS vs. both

| | SMB (CIFS) | NFS | Verdict |
|---|---|---|---|
| **Linux client support** | Via `cifs-utils`/`mount.cifs` — mature, well-supported on any Linux (including inside the WSL2 VM or a dedicated backup container) | Native Linux support, typically lower overhead | Both are viable from the Linux side Docker actually runs in |
| **Authentication model** | Username/password (or Kerberos/AD if the NAS and hospital network support it) | Typically IP-based export rules, optionally Kerberos; weaker built-in user-auth without extra setup | **SMB is the stronger fit for "least-privilege NAS account" (§5)** — most consumer/business NAS devices (Synology, QNAP, TrueNAS, Windows Server shares) expose a straightforward user-account model over SMB that maps cleanly to "one dedicated backup account with write-only access to one folder" |
| **Typical hospital NAS reality** | Almost universally supported (every NAS vendor ships SMB; most hospital IT is more familiar with SMB/Windows-share semantics) | Supported on most NAS but less universally *administered* in a Windows-centric hospital IT shop | SMB is the safer default assumption absent a confirmed NFS-capable, NFS-administered NAS |
| **Recommendation** | **Primary: SMB** | **Fallback: NFS**, only if the actual NAS/IT environment confirms NFS is the supported/preferred option | This plan designs for SMB as the default, with NFS as a documented alternative path using the same step sequence — switching protocols later is a mount-command change, not an architecture change |

**This is a conditional recommendation.** Which protocol the actual NAS device and hospital network
support is not something this codebase can determine — if NFS is confirmed as the only option, every
step below still applies, only the mount command in step 1 changes.

## 3. The 9-step on-demand connect/backup/disconnect sequence

Each step below names the exact mechanism (not a shell one-liner to paste blindly) and, critically,
its **failure handling** — per your instruction, each failure mode gets an explicit behavior, not a
silent skip.

### Step 1 — Connect to NAS
- **Mechanism:** mount the SMB share from inside the context Docker runs in. Two sub-options, both
  valid designs (owner decision, see the architecture doc's open items):
  - (a) Mount on the **WSL2 host VM** itself (`mount -t cifs //<nas-ip>/<share> /mnt/pacs-nas -o
    credentials=<file>,vers=3.0`), then bind-mount `/mnt/pacs-nas` into a backup container.
  - (b) Run the mount **inside a dedicated, short-lived backup container** that has `CAP_SYS_ADMIN`
    and the `cifs-utils` package installed, mounting directly to a path only that container sees —
    cleaner isolation, no host-level mount persisting outside the backup job's own lifetime.
  - **Recommendation: (b)** — matches "on-demand," leaves no standing host-level mount to forget about
    or leak credentials from between runs.
- **Failure handling:** if the mount command fails (NAS powered off, wrong IP, network unreachable),
  the job **must stop immediately** — no subsequent step should run against a share that isn't
  actually there. Raise a Phase-8 alert (`source: BACKUP`, level `HIGH`) with the specific mount error
  message (never the credential), and exit non-zero.

### Step 2 — Authenticate securely
- **Mechanism:** SMB credentials supplied via a **credentials file** (`username=...`, `password=...`,
  `domain=...` if applicable), never as a command-line argument (which would leak into process lists
  and shell history — the same principle already enforced for every secret handled in this project's
  F-02 work). The credentials file itself follows the exact pattern already proven in this session:
  stored outside any path with broad inherited permissions, readable only by the account running the
  backup job.
- **Failure handling:** an authentication failure is distinguishable from a connectivity failure (SMB
  returns a specific auth-denied error) — raise a **CRITICAL** alert specifically flagging "NAS
  authentication failed," since this could indicate a credential rotation on the NAS side that the
  backup system wasn't updated for, which is operationally different from "NAS is just unreachable."

### Step 3 — Verify NAS availability
- **Mechanism:** after mounting, a lightweight write+read+delete of a small marker file (e.g.
  `.backup-health-check-<timestamp>`) in the target share, before touching anything real — confirms
  the mount is not just present but actually writable, not a stale/read-only/disconnected mount
  silently succeeding at the `mount` command itself.
- **Failure handling:** marker-file write failure → treat identically to a connection failure (step
  1's handling), abort before any real backup data is written.

### Step 4 — Verify available storage
- **Mechanism:** check free space on the mounted share (`df` equivalent against the mount point) and
  compare against the expected total size of this run's backup set (sum of current DB sizes +
  current volume sizes + a safety margin — e.g. 1.5×, to allow for the fact that gzip/tar artifacts
  don't always shrink as much as hoped, and that the retention policy from the earlier F-05
  implementation plan means multiple generations may need to coexist on the NAS, not just this one).
- **Failure handling:** insufficient space → **do not start the backup and then fail partway through**
  — check **before** writing anything, raise a HIGH alert naming the shortfall, and exit. This directly
  satisfies "handle insufficient capacity" as a pre-condition check, not a mid-transfer failure.

### Step 5 — Create a dated backup directory
- **Mechanism:** `<nas-share>/pacs-backups/<YYYY-MM-DD-HHMMSS>/` — one new, uniquely-timestamped
  directory per run, never reusing or overwriting a prior run's directory. This is the primary
  mechanism for "protection against accidental overwrite" (§5): a new run physically cannot collide
  with an old one's files, because its directory name is always new.
- **Failure handling:** directory-creation failure (e.g. a permissions issue even though the marker
  file in step 3 succeeded — possible if the backup account has write access to the share root but
  not to create subdirectories, depending on NAS ACL configuration) → abort, HIGH alert.

### Step 6 — Execute backups
- **Mechanism:** the four backup components from §3 of the architecture document, each written
  directly into this run's dated directory. Executed from the Linux context (the backup container),
  streaming each artifact (dump/tar/encrypt) to the NAS path rather than writing a local-then-copy
  two-step where practical, to minimize the "orphaned local temp file" surface — though a brief local
  staging step is unavoidable for the encryption step (§5) unless the NAS mount itself is trusted to
  hold the pre-encryption artifact, which it should **not** be (encrypt before it ever touches the
  NAS, not after).
- **Failure handling:** an **interrupted transfer** (network drop mid-write, NAS becomes unavailable
  partway through a large volume tar) must leave the dated directory in a visibly **incomplete**
  state — see step 7's completeness check — rather than something that could be mistaken for a
  successful backup. The job should not retry silently mid-stream; a clean, loud failure that a human
  or the monitoring system can see is safer than a partial-success ambiguity.

### Step 7 — Verify checksums and completeness
- **Mechanism:** compute a SHA-256 of every artifact **as written to the NAS** and compare against a
  SHA-256 computed **before** the transfer (at the point the artifact was produced, pre-encryption or
  post-encryption consistently — the design must pick one consistent point, see the architecture doc)
  — this is a transfer-integrity check, structurally identical in spirit to the already-proven
  application-level SHA-256 check in `ArchiveService` (Module 2/4/5), just applied to backup artifacts
  instead of compressed DICOM archives. Also verify the **expected set of files is present** (e.g.
  exactly one `ris-*.sql.gz.enc`, one `orthanc-*.sql.gz.enc`, one `orthanc_storage-*.tgz.enc`, one
  `pacs_archive-*.tgz.enc`, one manifest) — a run that produced 3 of 4 expected artifacts should fail
  completeness, not be reported as a success.
- **Failure handling:** any checksum mismatch or missing artifact → the **entire run is marked
  FAILED**, not partially successful — raise a CRITICAL alert, and do **not** prune any older backup
  generation based on this run's presence (retention logic must never assume "this run succeeded" when
  it didn't).

### Step 8 — Record results
- **Mechanism:** a manifest file written into the same dated directory (artifact names, sizes,
  SHA-256 values, start/end timestamps, source database/volume sizes at backup time, the
  success/failure status of every step above) **plus** a corresponding row in a new, small
  application-level record (e.g. a `BackupRun` table or reuse of the existing
  `background_job_records` table already used by Phase 8's scheduler — an owner/implementation
  decision, not fixed here) so the Command Centre / Phase 8 dashboard can show backup history
  alongside every other operational record, consistent with Module 5's existing pattern.
- **Failure handling:** if the manifest itself can't be written (e.g. the NAS became unavailable
  between step 7 and step 8), the **application-level record** (not dependent on the NAS) is the
  fallback source of truth for "did this run succeed" — this is why the record should exist in the
  RIS database, not only as a file on the NAS that might not be reachable later when someone asks "did
  last night's backup work?"

### Step 9 — Disconnect NAS safely
- **Mechanism:** unmount cleanly (`umount`), confirm no process still holds the mount point open
  before attempting to remove it, then (if using sub-option (b) from step 1) the backup container
  exits/is removed — leaving **nothing** mounted, no standing credential in memory, between runs.
- **Failure handling:** an unmount failure (busy mount point) should not be silently ignored — log it
  and raise at least a LOW/INFO-level alert, since a stuck mount from a prior run could interfere with
  the next scheduled/on-demand attempt.

## 4. NAS unavailable / auth failure / insufficient capacity / interrupted transfer — summary table

| Failure mode | Detected at step | Alert level | Behavior |
|---|---|---|---|
| NAS unreachable (powered off, network down) | 1 | HIGH | Abort before any write; no partial state created |
| Authentication failure | 2 | CRITICAL | Abort; flag as a credential/config issue, distinct from connectivity |
| Insufficient capacity | 4 | HIGH | Abort **before** backup starts, not mid-transfer |
| Interrupted transfer | 6 | CRITICAL (via step 7's completeness check) | Entire run marked FAILED; no retention pruning based on this run; prior good backups untouched |

## 5. What this design deliberately leaves to the architecture/implementation documents
- The exact NAS credential storage location and least-privilege account scope → §5 of
  `F05_BACKUP_ARCHITECTURE.md`.
- Which of sub-options (a)/(b) in Step 1 is implemented → an explicit open decision, not resolved
  here, since it depends on operational preferences (standing host mount vs. fully ephemeral
  container) this codebase cannot decide alone.

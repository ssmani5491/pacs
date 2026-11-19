# F-05 Backup & DR — Current State (Read-Only Investigation)

**Status: investigation complete. Nothing was backed up, deleted, modified, or restarted.** All
figures below are **verified facts**, obtained by direct inspection of the live stack on
2026-11-16, unless explicitly labeled otherwise.

## 1. Existing backup inventory (everything that exists today)

| Artifact | Date | Size | Covers |
|---|---|---|---|
| `backups/ris-pre-phase8-20261114-113347.sql.gz` | 2026-11-14 11:33 | 1.4 MB | RIS DB only |
| `backups/ris-phase9-20261114-150910.sql.gz` | 2026-11-14 15:09 | 1.5 MB | RIS DB only |
| `backups/ris-pre-revpush-20261114-153110.sql.gz` | 2026-11-14 15:31 | 1.5 MB | RIS DB only |
| `backups/ris-pre-archive-20261114-160035.sql.gz` | 2026-11-14 16:00 | 2.1 MB | RIS DB only |
| `backups/ris-pre-storage-20261114-170654.sql.gz` | 2026-11-14 17:06 | 2.2 MB | RIS DB only |
| `backups/config-20261114-151018/` | 2026-11-14 15:10 | ~27 KB | compose, nginx×2, orthanc lua/worklist, mwl_scp.py, ohif config, 7 Prisma migrations, `env.template` (keys only, no values) |

**Verified fact, directly inspected the dump content:** every `.sql.gz` is a `pg_dump -d ris`
(confirmed by grepping the most recent dump: it contains only RIS tables — `studies`,
`report_signatures`, etc. — and zero Orthanc index tables). None of these dumps include the
separate `orthanc` database.

**No automated or scheduled backup job exists anywhere** — no cron, no `@nestjs/schedule` backup
task, no script in `scripts/` or `tools/` named for backup/restore. These five dumps and the one
config snapshot were produced manually, once each, as milestones during earlier development phases
(their filenames — `pre-phase8`, `pre-revpush`, `pre-archive`, `pre-storage` — are safety snapshots
taken immediately before each module's work, not a recurring policy).

**Staleness, verified by date comparison:** the most recent backup of anything (2026-11-14 17:06)
predates **all** of PACS Operations Modules 1–5 and the entire F-02 credential-hardening work
(2026-11-15/16). A restore from the newest existing backup today would **lose** every reverse-push
job, archive job, Module 4/5 record, the break-glass admin account, and the rotated credentials —
reverting the system to a materially earlier state.

**Existing documentation** (`docs/PHASE9_BACKUP_RESTORE.md`, `docs/PHASE9_FAILURE_RECOVERY.md`)
already records real, executed validation work — not just a claim. One correction to that document's
own text is necessary (see §3 below): it states the Orthanc index is "covered by pg_dump of that DB,"
which does not match what the dump command it documents (`pg_dump -d <ris>`) actually does.

## 2. RIS database (`ris`)

| Property | Value | Verified how |
|---|---|---|
| Database name | `ris` | `psql -l` |
| Size (live, today) | **34 MB** | `pg_size_pretty(pg_database_size('ris'))` |
| Backup method | Logical (`pg_dump`, gzip) | inspected dump headers + the documented procedure |
| Backup frequency | **Manual, ad-hoc** (5 snapshots in ~6 hours on one day, none since) | file timestamps |
| Retention policy | **None** — all 5 dumps are simply kept, no pruning/rotation logic exists | no script found |
| Backup destination | `backups/` inside the project directory, **on the same disk as the live
  database** | `ls -la backups/` |
| Encrypted? | **No** — plain gzip, not encrypted | inspected file format |
| Integrity verified? | **Yes, once** (Phase 9: isolated restore, row counts + FK + GIN index + two
  signature hashes confirmed byte-identical) — not repeated since, and not automated | PHASE9_BACKUP_RESTORE.md, independently plausible from the dump's own content |

Current live counts (today, for reference — NOT what's in the stale backups): 5010 studies, 1007
patients, 28 reports, 3 signatures, 3377 audit log rows, 5 archive jobs, 9 transfer jobs, 8 users,
10 Prisma migrations applied (latest: `0010_pacs_storage`).

## 3. Orthanc index database (`orthanc`) — NOT covered by any existing backup

**Verified fact, corrects the existing Phase 9 documentation:** `orthanc` is a genuinely separate
PostgreSQL database on the same server (`psql -l` shows both `ris` and `orthanc` as independent
databases), currently **22 MB**. Every existing backup command runs `pg_dump ... -d <ris-db-name>`
— a dump of `ris` **does not** include `orthanc`'s tables. I verified this directly by grepping the
most recent `.sql.gz` for Orthanc-specific table definitions: none exist; every "orthanc" string
match in that file is the `orthancStudyId` *column name* inside RIS's own `studies` table (a foreign
identifier RIS stores, not Orthanc's own schema).

**Consistency requirement between the index and DICOM storage:** Orthanc's PostgreSQL index is the
authoritative map from DICOM UIDs to files on disk in `orthanc_storage`. Restoring one without the
other at a **matching point in time** produces an inconsistent Orthanc: either the index references
files that don't exist (if the index is older/newer than the volume), or files exist that no index
entry describes (functionally invisible/orphaned to Orthanc, though not deleted). **These two
artifacts must be backed up and restored together, from the same moment**, not independently.

## 4. DICOM storage (`orthanc_storage` volume)

| Property | Value | Verified how |
|---|---|---|
| Storage type | Named Docker volume (not a bind mount) | `docker volume inspect` |
| Real disk location | `/var/lib/docker/volumes/pacs-replica_orthanc_storage/_data` — **inside the
  Docker Desktop/WSL2 VM's own virtual disk on this Windows host**, not a path directly browsable
  from Windows Explorer or a plain Windows backup tool | `docker volume inspect` Mountpoint |
| Current size | **324.2 MB** | `docker system df -v` |
| Instances / studies / patients | **2489 / 10 / 6** | live `/api/pacs/operations/overview` →
  `storage.orthanc` (same number observed consistently throughout this entire multi-day session) |
| Existing backup coverage | **None** — no copy of this volume exists anywhere in `backups/` |
| Modification risk during backup | **Not assessed by this investigation** (no backup was performed);
  a naive `tar` of a live Orthanc storage volume **while a C-STORE is in progress** could capture a
  partially-written file — this is a real consistency risk any implementation must address (e.g. by
  using Orthanc's own backup guidance, or a brief read-only/quiesce window), not something I verified
  is currently safe. |
| DICOM files modified by inspection? | **No** — this investigation only ran `ls` inside the backend
  container's bind-mounted `pacs_archive` path and read counts via the REST API; no DICOM file in
  `orthanc_storage` was copied, moved, renamed, or deleted. |

## 5. PACS archive (`pacs_archive` volume)

| Property | Value | Verified how |
|---|---|---|
| Storage type | Named Docker volume, mounted into `backend` at `/var/lib/pacs/archive` | compose +
  `docker exec` listing |
| Current size | **3.97 MB** (5 archive jobs total) | `docker system df -v` + live job counts |
| Job records | 5 `archive_jobs` rows live in `ris` (1 completed, 2 verified, 1 failed, 1 cancelled) —
  **these rows are inside the `ris` database**, so they ARE included whenever `ris` is backed up;
  the **archive files themselves are not**, since they live in the separate `pacs_archive` volume |
| Integrity mechanism (existing, unchanged, verified in earlier work this session) | SHA-256 over the
  final `.zip.gz`, stored in `archive_jobs.sha256`; verification re-hashes + gunzips + counts ZIP
  entries, comparing against the stored hash — this is **application-level** integrity, separate from
  and not a substitute for a backup/restore integrity check of the volume itself |
| Existing backup coverage | **None** for the files; **partial** for the metadata (only via a
  whole-`ris` dump, and only as of whichever dump is newest — currently 2026-11-14, so today's 5
  records are not in any existing backup either) |
| What protects both together | **Nothing today.** A restore of `ris` from the stale backup would
  bring back metadata for archive jobs that may no longer match what's on disk in `pacs_archive`
  (which also has no backup of its own) — the same "restore the two things together, from the same
  point in time" requirement as Orthanc's index + storage pair. |

## 6. Redis

| Property | Value | Verified how |
|---|---|---|
| Persistence | **RDB only** (`save 3600 1 300 100 60 10000`), **AOF disabled**
  (`appendonly no`) | live `CONFIG GET` on the running container |
| Volume | Named Docker volume `redis_data`, currently **~59 KB** | `docker system df -v` |
| What's stored | Refresh-token records (re-issuable by re-login), background-job Redis locks
  (self-expiring, PX TTL), transient scheduler bookkeeping | code inspection (`auth.service.ts`,
  scheduler lock patterns across Modules 1–3) |
| Recovery requirement | **Low** — nothing clinical lives here; a full loss only forces every user to
  re-authenticate and lets in-flight scheduler locks expire and self-heal (already functionally
  verified in Phase 9's FR-2 restart test, not a full-loss test) |

## 7. Configuration and secrets

- `docker-compose.yml`, `nginx/nginx.conf`, `nginx/nginx-tls.conf.example`,
  `orthanc/on-stored.lua`, `orthanc/worklist/`, `mwl-scp/mwl_scp.py`, `ohif/app-config.js`,
  `backend/prisma/migrations/` — all are **files already under version control in this project
  directory** (even though the project itself has no `.git` repository today — see the F-02 work in
  this session). They are not "backed up" in the traditional sense; they are the **source of
  truth**, reproducible by redeploying this project directory itself. The one existing
  `backups/config-20261114-151018/` snapshot is a point-in-time copy of these, now 2 days stale
  relative to the live Module 5 + F-02 state.
- `.env` holds real secrets (DB/Redis passwords, JWT secrets, pepper, Orthanc credentials, the
  now-empty `SEED_ADMIN_PASSWORD` per the F-02 Step 4 work). **No backup of `.env` exists anywhere**,
  and the one `env.template` in the config snapshot deliberately holds **keys only, no values** — by
  design, not an oversight, since a plaintext secrets backup would itself be a risk requiring its own
  protection (encryption, access control) that this project has not built.
- I did not print, copy, or include any secret value anywhere in this investigation or this
  document.

## 8. What would be needed to rebuild the platform after total loss (inventory, not a procedure yet)
1. This project directory's own files (compose, nginx, orthanc, mwl-scp, ohif config, Prisma schema +
   migrations) — reproducible from the directory itself if it survives, or would need to be
   reconstructed from a separate source-code backup if it doesn't (**the project directory itself has
   no backup of its own today**, which is a gap distinct from the database/volume gaps above).
2. A real `.env` with real secret values — **no backup exists**; this would need to be
   re-populated from whatever secret-management process the hospital runs, which is outside what
   this codebase can verify.
3. `ris` database — last backed up 2026-11-14 (stale).
4. `orthanc` database — **never backed up**.
5. `orthanc_storage` DICOM files — **never backed up**.
6. `pacs_archive` compressed study files — **never backed up**.
7. `redis_data` — not needed for correctness, self-heals from empty.

## 9. Distinguishing verified facts from estimates in this document
- **Verified facts**: every size, count, file inventory, Redis config value, and volume-mount detail
  above was obtained live from the running stack or by direct file/content inspection, today.
- **Estimated/historical**: the Phase 9 restore timings (3 s dump restore, 15 s including container
  start) are **reported from the prior document**, not re-measured in this investigation — carried
  forward as "measured previously," not re-verified today.
- **Unverified assumption flagged explicitly**: whether a live `orthanc_storage` tar during active
  C-STORE would actually produce a corrupt file was **not tested** here (doing so would risk the live
  stack); it's stated as a reasonable risk, not a measured outcome.

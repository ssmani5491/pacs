# Product Validation — Phase 1D: Complete Backup and Disaster Recovery Assessment

**Status: assessment only. No remediation implemented.** This report is strictly read-only
investigation, per the brief. No file was modified, no container was restarted or stopped, no
Docker volume was touched, no database record was changed, no DICOM study was modified, no restore
was executed, and no new backup job was introduced. No credential, token, or password appears
anywhere below.

## 1. Executive summary

The system today has **no automated backup of any kind**. Everything that exists is five manual,
one-off `pg_dump` snapshots of the `ris` database, all taken on a single day (2026-11-14) as
pre-change safety nets before five different implementation phases, plus one manual configuration
snapshot from that same day. Both the DICOM image store (`orthanc_storage`, ~327 MB) and the
operational archive (`pacs_archive`, ~3.8 MB) have **never** been backed up. The `orthanc` Postgres
database (separate from `ris`, same Postgres instance) has also never been dumped. Point-in-time
recovery is **architecturally unavailable** — PostgreSQL's `archive_mode` is `off`, so no WAL
archiving exists, and recovery is only possible to the moment of a manual `pg_dump`. The one
existing configuration snapshot has already drifted from the live `docker-compose.yml` and
`nginx/nginx.conf`. All five Docker volumes live on a single local disk with no replication —
a single storage failure loses all data (patients, orders, reports, DICOM images, audit logs)
with no recovery path at all beyond the stale, partial, 4-day-old manual Postgres dumps.

**Bottom line**: the system can recover from "a bad deploy" (via the manual pre-phase dumps, if one
happens to predate the problem) but cannot recover from a disk failure, accidental deletion, or
any incident affecting DICOM storage, the `orthanc` database, Redis, or configuration — because no
backup of any of those exists at all.

## 2. Existing backup architecture

| Component | Backup mechanism | Automation | Last backup | Coverage |
|---|---|---|---|---|
| `ris` Postgres database | Manual `pg_dump` (gzip) | None — ad hoc, run by hand before risky changes | 2026-11-14 17:06 (pre-storage-phase dump) | Full `ris` schema/data at that moment only |
| `orthanc` Postgres database | **None** | None | Never | **No backup exists** |
| Orthanc DICOM storage (`orthanc_storage` volume, ~327 MB) | **None** | None | Never | **No backup exists** |
| Operational archive (`pacs_archive` volume, ~3.8 MB) | **None** | None | Never | **No backup exists** |
| Redis (`redis_data` volume) | RDB snapshotting only (Redis's own built-in persistence, not a project backup) | Redis default save points (`3600 1 300 100 60 10000`) | Continuous (Redis-internal) | Low priority — holds only `refresh:*` JWT tokens and `lock:*` scheduler locks, no clinical/durable data |
| Configuration (`docker-compose.yml`, `nginx/nginx.conf`, `.env`, Orthanc Lua/worklist config) | One manual directory snapshot (`backups/config-20261114-151018/`) | None | 2026-11-14 15:10 | **Stale** — confirmed drifted from live `docker-compose.yml` and `nginx/nginx.conf` (see §5) |
| `.env` (secrets/credentials) | **None, anywhere** | None | Never | Not present in the one config snapshot either — correct from a credential-hygiene standpoint, but means environment configuration has zero backup coverage |
| `app_logs` volume | **None** | None | Never | Low priority (operational logs only, confirmed near-empty) |

No scheduled backup job exists in code: the backend's `OpsScheduler`
(`backend/src/ops/ops.scheduler.ts`) runs exactly two jobs — a 60-second health-check interval and
an hourly notification/telemetry-cleanup job (`CronExpression.EVERY_HOUR`, prunes expired
notifications and old telemetry rows). Neither performs or triggers any backup. A repo-wide search
of `backend/src` for `pg_dump` or any backup-service pattern returns zero matches. `scripts/`
contains exactly one script, `init-db.sh` (database initialization, not backup).

## 3. Database backup assessment

- **`ris` database**: 5 manual dumps exist, all gzip-compressed `pg_dump` output, all from
  2026-11-14, ranging 1.4–2.2 MB compressed. Each was taken immediately before a specific
  implementation phase (Phase 8, reverse-push, archive, storage, Phase 9) as a rollback safety net,
  not as part of any ongoing backup discipline. **No dump has been taken in the 4 days since.**
  Every data change made across Phases 8B through Product Validation 1C — RBAC navigation data,
  study/report records, reverse-push jobs, archive jobs, audit log entries — exists only in the
  live database, with no backup covering it.
- **`orthanc` database**: this is a second, separate Postgres database on the same instance (created
  by `init-db.sh` alongside `ris`), holding Orthanc's own index of studies/series/instances. **No
  dump of this database exists anywhere**, manual or automated.
- **Cross-database consistency risk** (carried forward from Phase 1B, re-confirmed here): `ris` and
  `orthanc` are logically linked (a RIS order references a DICOM study by UID, which only exists in
  Orthanc's own database and storage). Because the 5 existing `ris` dumps have no corresponding
  `orthanc` dump taken at the same instant, **even the one backup type that exists cannot be
  restored consistently** — restoring `ris` to its 2026-11-14 17:06 state while Orthanc's database
  and storage remain at their current (2026-11-18) state would reintroduce order/study references
  that may no longer resolve correctly, or vice versa.
- **Point-in-time recovery**: confirmed architecturally unavailable. `archive_mode = off`,
  `archive_command = (disabled)`, and zero replication slots exist
  (`pg_replication_slots` returns 0 rows). `wal_level = replica` is set, but with archiving off this
  setting has no practical effect for recovery purposes — WAL segments are recycled, not retained.
  This means the **only** possible recovery point for `ris` is the timestamp of whichever manual
  dump is used, and there is no way to recover to any point between dumps, or to any point after the
  last dump (2026-11-14 17:06 — now 2026-11-18, a 4-day-and-growing gap).

## 4. DICOM storage backup assessment

- **No backup exists for Orthanc's DICOM storage at all.** The `orthanc_storage` Docker volume
  (~327 MB of DICOM instance files) has never been copied, exported, or snapshotted by any
  mechanism found in this investigation.
- Orthanc itself provides a study-level ZIP export (used operationally by the Phase-built archive
  feature, `pacs_archive` volume), but this is a **user-triggered, per-study operational archive
  feature**, not a backup mechanism: it depends on a staff member selecting individual studies to
  archive, has no completeness guarantee across the full study set, and its own output
  (`pacs_archive`, 3.8 MB) is itself unbacked-up.
- **Impact**: loss of the `orthanc_storage` volume (disk failure, accidental `docker volume rm`,
  host failure) would mean **permanent, total loss of every DICOM image in the system**, with zero
  recovery path. This is the single most severe gap identified in this assessment — more severe
  than the database gap, because the database loss at least has a stale-but-nonzero recovery point,
  while DICOM storage has none at all.

## 5. Configuration backup assessment

- One manual snapshot exists: `backups/config-20261114-151018/`, containing `docker-compose.yml`,
  `nginx.conf`, `app-config.js` (OHIF), `env.template` (not the real `.env`), `migrations`,
  `mwl_scp.py`, `nginx-tls.conf.example`, and the Orthanc `on-stored.lua` / `worklist` config.
- **Confirmed stale**: direct `diff` against the live files shows both `docker-compose.yml` and
  `nginx/nginx.conf` have diverged from this snapshot. The `nginx.conf` divergence is partly
  explained by today's Phase 1C change (the DICOMweb route removal), but the `docker-compose.yml`
  divergence predates that — meaning Compose configuration has changed through other phases since
  2026-11-14 without the config snapshot ever being refreshed.
- **No real `.env` file has ever been captured in any backup** — only the non-secret
  `env.template`. This is correct hygiene (a backup directory sitting in the project tree is not an
  appropriate place for live secrets), but it means that today, **if the live `.env` file were lost,
  there is no backup copy anywhere to recover from** — it would have to be entirely reconstructed
  from `env.template`'s structure plus re-generated/re-obtained secrets (database password, JWT
  signing secret, Orthanc credential, any pepper value), which is a manual, error-prone, and
  potentially service-breaking process (e.g., a regenerated JWT secret invalidates every existing
  session and refresh token).
- Orthanc's own config (`on-stored.lua`, worklist config) is captured in the one stale snapshot only;
  no newer copy exists.

## 6. Recovery feasibility

Assessed per component, against what actually exists today (no hypothetical tooling):

| Component | Can it be recovered today? | How | Caveats |
|---|---|---|---|
| `ris` database | Partially | Restore `ris-pre-storage-20261114-170654.sql.gz`, the most recent of the 5 dumps | Loses all `ris` data changes made since 2026-11-14 17:06 (4+ days as of this report); inconsistent with current Orthanc state (§3) |
| `orthanc` database | **No** | — | No backup exists in any form |
| DICOM images (`orthanc_storage`) | **No** | — | No backup exists in any form; total, permanent loss if the volume is lost |
| `pacs_archive` (operational archive ZIPs) | **No** | — | No backup exists; also itself derived from Orthanc data, so recreating it requires DICOM storage to still exist |
| Redis | Yes, trivially | Redis's own RDB file persists across container restart automatically | Not a "recovery" concern — holds only ephemeral tokens/locks; acceptable to lose entirely (users just re-authenticate) |
| Configuration (compose/nginx/Orthanc config) | Partially, with manual reconciliation | Restore the stale 2026-11-14 snapshot, then manually re-apply every change made since (Phase 1C's nginx change, and whatever else changed in `docker-compose.yml`) | No record exists of exactly what changed in Compose since the snapshot — reconciliation would require manual diffing against this report and project history, which is error-prone |
| `.env` / secrets | **No** | — | Must be manually reconstructed from `env.template`'s structure; any regenerated secret (JWT signing key, Orthanc credential) invalidates existing sessions/tokens and may require coordinated credential rotation across services |
| `app_logs` | N/A | — | Confirmed empty/negligible; not a meaningful recovery concern |

**Full-system "from zero" recovery is not feasible today** — not because any single step is
impossible, but because the DICOM image store and the `orthanc` database (which together constitute
the actual clinical imaging record) have no backup at all. A restore today recovers RIS metadata
circa 2026-11-14 with no corresponding images.

## 7. Identified risks

**Critical**

- **C-1: No backup of DICOM image storage exists.** Loss of the `orthanc_storage` volume (disk
  failure, accidental deletion, host loss) destroys every DICOM image in the system permanently,
  with zero recovery path. This is the system's core clinical asset.
- **C-2: No backup of the `orthanc` Postgres database exists.** Loss of this database destroys
  Orthanc's entire index of studies/series/instances — even if the raw DICOM files on disk somehow
  survived a scenario that lost only the database, Orthanc could not serve them without a full
  re-index, and metadata (e.g., which studies map to which RIS orders) would need reconstruction.
- **C-3: Point-in-time recovery is architecturally unavailable** (`archive_mode = off`). Any `ris`
  database incident loses all changes back to the last manual dump — currently a 4-day-and-growing
  gap, with no mechanism to shrink it short of running dumps more often by hand.

**High**

- **H-1: No backup automation exists at all** — every backup that exists was a one-off manual action
  taken as a side effect of five specific implementation phases, not an ongoing discipline. There is
  no expectation that a dump will exist for any future date.
- **H-2: Cross-database consistency is not maintained even for the backups that do exist** — the 5
  `ris` dumps have no corresponding `orthanc`-database or DICOM-storage snapshot taken at the same
  moment, making a fully consistent restore impossible even in the best existing case.
- **H-3: All 5 Docker volumes sit on a single local disk** (`Driver=local`, same host) with no
  replication of any kind — a single storage-layer failure is a single point of total data loss
  across every component (RIS data, DICOM images, archive ZIPs, Redis) simultaneously.
- **H-4: The one configuration backup has already drifted from live configuration** and is
  therefore unreliable for disaster recovery today; the gap between "a config backup exists" and
  "the config backup is usable" is currently unbridged by any process.

**Medium**

- **M-1: No backup of `.env`/secrets exists anywhere**, by design (correctly, for security), but with
  no compensating documented secret-recovery procedure — recreating `.env` after loss requires
  manually regenerating or re-obtaining every credential, with service-availability side effects
  (e.g., session invalidation) that are not currently documented anywhere.
- **M-2: No backup integrity verification has ever been performed** — none of the 5 existing `pg_dump`
  files has ever been test-restored to confirm it is actually valid/restorable; they are unverified
  artifacts of unknown reliability.
- **M-3: No documented RTO/RPO target exists today** — there is currently no stated expectation for
  how much data loss or downtime is acceptable, so "the backup is insufficient" cannot even be
  formally evaluated against a goal (addressed in §11).

**Low**

- **L-1: `app_logs` and Redis have no backup**, but both are confirmed low-value for DR purposes
  (operational logs and ephemeral session tokens respectively) — explicitly not a priority.

## 8. Recommended remediation

*(Proposed only — not implemented in this phase, per the brief's stop condition.)*

1. Introduce a scheduled, automated nightly `pg_dump` of **both** `ris` and `orthanc` databases,
   taken back-to-back in the same job run (to minimize the cross-database consistency gap identified
   in H-2), written to a location outside the live Docker volumes.
2. Introduce a scheduled, automated backup of the `orthanc_storage` volume (e.g., periodic
   filesystem-level snapshot or `tar` export of new/changed files since the last run), closing C-1.
3. Introduce retention and rotation for all of the above (e.g., keep the last N nightly backups plus
   a smaller number of weekly/monthly points), since unbounded retention on the same local disk
   defeats the purpose of H-3.
4. Address H-3 directly: ensure at least one backup copy is written somewhere other than the primary
   host disk (a second local disk, network share, or offsite location) — the current project is
   explicitly "local, offline stack," so this recommendation should be scoped to what's feasible in
   that constraint (e.g., a second physical/logical disk) rather than assuming cloud storage.
5. Automate configuration backup (`docker-compose.yml`, `nginx/nginx.conf`, Orthanc config files)
   on every change, or at minimum on a schedule frequent enough that drift (§5) cannot recur
   silently — closing H-4.
6. Document a `.env`/secrets recovery runbook: which values must be regenerated vs. preserved, and
   the exact consequence of regenerating each (e.g., JWT secret rotation invalidates sessions) —
   addressing M-1 without ever storing the live secrets file in a backup location.
7. Periodically test-restore a sample backup (database dump at minimum) to a scratch environment to
   confirm backups are actually valid — addressing M-2.
8. Consider enabling `archive_mode = on` with a WAL archive destination to close C-3 and shrink
   achievable RPO from "time since last dump" to near-continuous — see §11 for the concrete tradeoff.
9. Formally adopt the RPO/RTO targets proposed in §11 (or revised ones) as the stated goal against
   which future backup design is measured.

## 9. Proposed backup architecture

*(Proposed only — not implemented.)*

- **Database tier**: nightly automated dump of `ris` and `orthanc` together (single job, sequential
  dumps, same timestamp label) via a scheduled job — consistent with this project's established
  "no 9th service" convention, so implemented as an `@nestjs/schedule` `@Cron` job in the backend
  process (same pattern as the existing `OpsScheduler`), writing to a dedicated backup path.
- **DICOM storage tier**: nightly incremental filesystem copy of `orthanc_storage` (only
  new/changed files, to keep runtime bounded as the store grows), triggered by the same or a sibling
  scheduled job.
- **Configuration tier**: a lightweight job (or pre-commit-style manual step, given this project is
  not under git) that snapshots `docker-compose.yml`, `nginx/nginx.conf`, and Orthanc config
  whenever a deployment-affecting change is made — not purely time-based, since config changes are
  event-driven (a new phase), not continuous.
- **Retention**: rolling window (e.g., 7 daily + 4 weekly) applied uniformly across database and
  DICOM-storage backups.
- **Off-host copy**: at least one tier (ideally all) mirrored to storage outside the primary host
  disk, within the constraints of this being a local/offline deployment.
- **No new service/container**: consistent with the project's established convention, this should
  remain scheduled application logic rather than a dedicated backup container, unless a future phase
  decides otherwise.

## 10. DR implementation roadmap

*(Proposed only — not implemented.)*

1. **Immediate** (lowest effort, highest risk closed): take one fresh manual `pg_dump` of both
   databases now, and one fresh manual copy/archive of `orthanc_storage`, to immediately shrink the
   current 4-day gap and close C-1/C-2 for a single point in time, while automation is designed.
2. **Short term**: implement the nightly database-dump `@Cron` job (closes H-1 for the database
   tier, reduces C-3's practical impact).
3. **Short term**: implement the DICOM-storage backup job (closes C-1 on an ongoing basis).
4. **Medium term**: implement retention/rotation and move at least one backup copy off the primary
   host disk (closes H-3).
5. **Medium term**: automate configuration snapshotting tied to deployment changes (closes H-4).
6. **Medium term**: write and exercise the `.env`/secrets recovery runbook (closes M-1).
7. **Ongoing**: schedule periodic test-restores (closes M-2) and revisit whether `archive_mode` /
   WAL archiving is warranted once the above is stable (addresses C-3 fully, if adopted).

This roadmap is proposed sequencing only; no step has been started.

## 11. RPO and RTO recommendations

- **Current achievable RPO (today, as-is)**: approximately **4 days and growing** — the age of the
  most recent `ris` dump (2026-11-14 17:06) — for the `ris` database only. For the `orthanc`
  database and all DICOM images, the current achievable RPO is **infinite / total loss** (no backup
  exists at all).
- **Recommended target RPO**: **24 hours** for both databases and DICOM storage, achieved via the
  nightly automated backup job proposed in §8/§9. This is a conservative, easily achievable target
  given the system's modest total data volume (~466 MB) and is consistent with the project's
  "local, offline stack" nature — it does not require continuous replication infrastructure.
  If `archive_mode` is enabled per recommendation 8, RPO could be tightened toward near-zero for the
  `ris`/`orthanc` databases specifically (WAL-level recovery), though DICOM storage would remain
  bounded by backup frequency regardless.
- **Current achievable RTO (today, as-is)**: **not meaningfully definable** for a full-system
  recovery, since DICOM storage and the `orthanc` database cannot be recovered at all. For the `ris`
  database alone, restoring the most recent ~2 MB compressed dump into a running Postgres instance is
  a fast operation (well under 10 minutes), but this does not constitute a usable system recovery on
  its own.
- **Recommended target RTO**: **4 hours** for a full-system recovery once the proposed backup
  architecture (§9) exists — derived from: restoring two Postgres databases from dumps (~466 MB
  total working set, a minutes-scale operation), copying back the DICOM storage volume from its
  most recent backup (also minutes-scale at current ~327 MB), redeploying the 8 Docker services from
  `docker-compose.yml` (the project's own established rebuild loop, typically completing in under an
  hour per prior phases' observed build/redeploy times), and allowing margin for manual
  configuration reconciliation and validation testing. This target assumes the proposed backups
  exist and have been test-restored at least once (recommendation 7); without that assumption, RTO
  is unbounded, since an unverified backup may simply fail to restore.

## 12. Validation evidence

All findings in this report are based on direct, read-only inspection performed during this phase.
No destructive, mutating, or service-affecting command was run.

- **Redis**: `redis-cli CONFIG GET appendonly` → `no`; `CONFIG GET save` → default save points;
  `dump.rdb` confirmed present, 316,681 bytes, last modified 2026-11-18 04:50; key-space scanned via
  `--scan --count 100` (3,333 keys total, all `refresh:*` or `lock:*` patterns) with values redacted
  before display — no credential or token value was ever shown.
- **Docker volumes**: `docker volume ls` and `docker volume inspect` for all 5 volumes confirmed
  `Driver: local`, mount points under `/var/lib/docker/volumes/pacs-replica_<name>/_data`. Sizes
  measured directly: `pg_data` 135.1 MB, `redis_data` 316 KB, `app_logs` ~4 KB, `orthanc_storage`
  327 MB, `pacs_archive` 3.8 MB.
- **PostgreSQL**: `SHOW archive_mode;` → `off`; `SHOW archive_command;` → `(disabled)`;
  `SHOW wal_level;` → `replica`; `SHOW max_wal_size;` → `1GB`; `SELECT * FROM pg_replication_slots;`
  → 0 rows.
- **Existing backups directory**: `backups/` listed directly — 5 `.sql.gz` files (sizes and
  timestamps in §3) and 1 config snapshot directory, contents enumerated in §5.
- **Configuration drift**: `diff -q docker-compose.yml backups/config-20261114-151018/docker-compose.yml`
  and `diff -q nginx/nginx.conf backups/config-20261114-151018/nginx.conf` both report the files
  differ.
- **No automated backup job**: `backend/src/ops/ops.scheduler.ts` read in full — exactly two
  scheduled jobs exist (`healthcheck` `@Interval`, hourly `@Cron` notification/telemetry cleanup),
  neither backup-related. Repo-wide search of `backend/src` for `pg_dump` / backup-service patterns:
  zero matches.
- **No backup/restore scripts**: `scripts/` directory listed in full — contains only `init-db.sh`
  (database initialization).
- **Secrets hygiene**: `backups/` searched for any `.env*` file — none found, confirming no live
  secret has ever been written into a backup location (correct practice, but means zero backup
  coverage for secrets, as noted in §5/§7/M-1).
- **No report in this document contains any password, token, API key, or credential value.**

---

Stopping here per the brief's stop condition. This phase is strictly an assessment — no remediation
item from §8–§10 has been implemented. Awaiting explicit approval before any further action.

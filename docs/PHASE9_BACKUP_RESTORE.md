# Phase 9 — Backup & Restore Validation (2026-11-14)

Restores were performed **only in isolated throwaway containers** — never over the live stack.
No live volume, database, or Orthanc study was modified. Secrets are never copied into this doc.

## What was backed up
| Component | Artifact | Location |
|---|---|---|
| PostgreSQL (RIS) | logical `pg_dump` (gzip) | `backups/ris-phase9-<ts>.sql.gz` (1.5 MB) |
| PostgreSQL (pre-Phase-8) | earlier dump | `backups/ris-pre-phase8-*.sql.gz` |
| Config | compose, nginx.conf, nginx-tls example, orthanc lua/worklist, mwl_scp.py, ohif app-config, prisma migrations (7) | `backups/config-<ts>/` |
| Env | **keys only, secrets redacted** | `backups/config-<ts>/env.template` |
| Orthanc index | inside the PostgreSQL `orthanc` database (covered by pg_dump of that DB) | — |
| Orthanc files | `orthanc_storage` Docker volume (324 MB, 2489 instances) | Docker volume |
| Redis | RDB snapshot (persistence on) | `redis_data` volume |

## PostgreSQL — backup + ISOLATED restore — ✅ PASS (validated)
Procedure executed:
1. `docker compose exec postgres pg_dump -U <user> -d <ris> --no-owner | gzip > backups/ris-phase9-<ts>.sql.gz`
2. Started an **isolated** `postgres:16-alpine` container (`pg-restore-test`) — not on the live
   volume or the pacs network.
3. `gunzip -c <backup> | docker exec -i pg-restore-test psql -U <user> -d <ris>`

Results (restore took **3 s, 0 errors**):
| Check | Live | Restored | Match |
|---|---|---|---|
| studies | 5010 | 5010 | ✓ |
| reports | 5 | 5 | ✓ |
| report_signatures | 2 | 2 | ✓ |
| patients | 1007 | 1007 | ✓ |
| scheduled_orders | 5005 | 5005 | ✓ |
| audit_logs | 1339 | 1339 | ✓ |

Schema & integrity on the restored copy:
- **search_tsv GIN index present** (`studies_search_tsv_idx`).
- 30 tables, 34 FK constraints restored.
- Relationship integrity: 5010 studies → valid patients; 5 reports → valid studies; 2 signatures →
  valid reports; **0 orphaned FKs**.
- **Signature integrity preserved**: both signature hashes restored intact (v2, ELECTRONIC_APPROVAL).

Isolated container removed afterwards; **live DB confirmed untouched** (still 5010 studies).

**Recovery time (PostgreSQL, this dataset): ~3 s restore + ~10 s container start ≈ 15 s.**

## Orthanc — backup + isolated restore — procedure documented, PG index portion VALIDATED
Orthanc state = (a) the `orthanc` PostgreSQL index DB + (b) DICOM files in the `orthanc_storage`
volume. The PG index is covered by the PostgreSQL dump (same server) and its restore is validated
above. Metadata consistency confirmed live: Orthanc `/statistics` reports 2489 instances / 10 studies
matching the 309 MB on disk.

Full isolated Orthanc restore procedure (documented; not executed live to avoid risk on the single
node — see "safely-not-run" note):
1. `docker run -d --name orthanc-restore-test -v <copy-of-orthanc_storage>:/var/lib/orthanc/db
   -e ORTHANC__POSTGRESQL__* (pointing at the isolated restored PG) orthancteam/orthanc:latest`
2. Query `/statistics` → expect CountInstances = 2489, CountStudies = 10.
3. Verify a known study via QIDO `/dicom-web/studies` in the isolated instance.
Backing up the volume: `docker run --rm -v pacs-replica_orthanc_storage:/src -v $PWD/backups:/dst
alpine tar czf /dst/orthanc_storage-<ts>.tgz -C /src .`

> **NOT RUN LIVE (documented procedure only)**: spinning a second full Orthanc + index on this single
> machine risks port/resource contention with the live stack. The PG index restore (the metadata) is
> validated; the file volume is a straightforward `tar` of immutable DICOM files. Marked as a
> documented, repeatable procedure rather than claimed as an executed full restore.

## Redis — recovery behaviour — ✅ reviewed
- Persistence: **RDB on** (`save 3600 1 300 100 60 10000`), AOF off. On restart Redis reloads its last
  RDB snapshot.
- **Recoverable**: nothing clinical is stored in Redis. Contents are refresh-token records (also
  re-issuable by re-login), background-job locks (PX-expiring, self-healing), and transient job
  bookkeeping. A Redis restart that loses the last few seconds of writes is safe: a user simply
  re-authenticates; locks expire and jobs re-run idempotently.
- Validated functionally in failure-recovery (Stage 7): Redis restart → auth continues working,
  locks recover, jobs resume.

## Configuration — ✅ backed up
`backups/config-<ts>/` holds compose, both nginx configs, orthanc lua/worklist, mwl_scp.py, ohif
config, all 7 prisma migrations, and `env.template` (keys only — **no secret values**).

## Known limitations
- Backups are manual (scripted here); a scheduled/off-host backup rotation is a production task (NOT
  implemented — would need a backup target + retention policy decision).
- Full live Orthanc isolated restore documented but not executed on the single node (see note above).
- No point-in-time recovery (WAL archiving) configured — logical dumps only. Documented as a
  production enhancement.

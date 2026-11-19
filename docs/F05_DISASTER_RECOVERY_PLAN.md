# F-05 Disaster Recovery Plan

**Status: PLAN ONLY.** No restore was performed. No backup job was created. Every recovery-time
figure below is labeled **MEASURED** (carried from the one executed Phase 9 test, not re-run today) or
**ESTIMATED** (a reasoned projection, never claimed as tested). Given the gaps in
`F05_BACKUP_GAP_REGISTER.md`, several scenarios below have **no real backup to recover from today** —
this plan states that honestly rather than describing a recovery path that doesn't currently exist.

---

## Scenario A — RIS database corruption

- **Recovery source:** the newest `backups/ris-*.sql.gz` logical dump — **today, that is the
  2026-11-14 17:06 snapshot, which is stale** (see BG-05). A real incident today would require
  accepting the loss of everything created since then (Modules 1–5 operational records, the
  break-glass admin, the F-02 credential rotations) unless a fresher dump is taken **before** this
  plan is ever exercised for real.
- **Recovery sequence:**
  1. Stop the `backend` container (it holds the only live Prisma connection pool actively writing to
     `ris`) — isolate, don't touch Postgres itself yet.
  2. `gunzip -c <newest-backup>.sql.gz | docker compose exec -T postgres psql -U <user> -d ris` into a
     **freshly recreated, empty** `ris` database (drop-and-recreate only the `ris` logical database,
     never the `postgres` service or its volume).
  3. Run `prisma migrate deploy` against the restored DB to confirm it's at the expected migration
     head (`0010_pacs_storage`) — a dump taken mid-migration-history could be behind.
  4. Restart `backend`.
- **Dependencies:** none on Orthanc or the archive volume — this scenario is RIS-only. Orthanc keeps
  running throughout (it has its own separate database).
- **Integrity checks:** row counts for `studies`/`patients`/`reports`/`report_signatures`/
  `audit_logs` against what the backup's own manifest/log recorded at dump time; confirm
  `studies_search_tsv_idx` GIN index present post-restore (this has previously been verified to
  survive a restore — Phase 9); confirm signature hashes on any restored signed reports are
  byte-identical to their pre-corruption values (previously verified methodology, Phase 9).
- **Expected data-loss exposure:** everything written to `ris` between the backup's timestamp and the
  corruption event. **Today, that window is ~2 days and growing** (BG-05) — closing this requires
  BG-04 (automation) first.
- **Estimated recovery time:** **MEASURED** for the restore step itself in Phase 9 (3 s dump-apply +
  ~10 s container start ≈ 15 s, on this hardware, on a 34 MB database) — **ESTIMATED** for the full
  scenario including detection, decision-making, and backend stop/start overhead: on the order of a
  few minutes for a human-operated response, not an automated failover.

## Scenario B — Orthanc index database loss

- **Recovery source:** **none exists today** (BG-01). This scenario currently has **no backup to
  recover from** — this is the honest state, not a procedure gap to paper over.
- **Recovery sequence, once a backup exists (future-state, described for planning only):**
  1. Restore the `orthanc` database from its own dedicated `pg_dump` (once BG-01 is closed — see the
     implementation plan).
  2. Restore (or confirm unchanged) the `orthanc_storage` volume **from the same point in time** as
     the index restore — see §"Dependencies" below; mismatched timestamps between the two produce an
     inconsistent Orthanc.
  3. Restart the `orthanc` service; confirm `/statistics` instance/study counts match the index's
     expectation.
  4. Cross-check RIS's own `studies.orthancStudyId` references still resolve via Orthanc's REST API
     for a sample of studies (RIS and Orthanc must agree on which studies exist).
- **Dependencies:** **this is the critical consistency requirement the brief specifically asked not
  to assume away.** The index (what Orthanc believes exists) and the file volume (what's actually on
  disk) must be restored from the **same backup moment**. Restoring an older index against a newer
  volume (or vice versa) will either reference missing files or leave real files invisible to Orthanc.
- **Integrity checks:** `/statistics` CountInstances/CountStudies must match the backup-time
  snapshot's own recorded counts; a QIDO query for a known StudyInstanceUID must resolve.
- **Expected data-loss exposure:** **currently total** — there is no backup, so a real loss today
  recovers nothing for the index specifically (the files in `orthanc_storage` would still physically
  exist, if that volume itself survived, but Orthanc could not locate/serve them without its index).
- **Estimated recovery time:** **ESTIMATED only** (no backup exists to measure a real restore
  against) — for a 22 MB logical dump, the restore mechanics would likely resemble Scenario A's
  measured ~15 s, but this is an extrapolation from a different database, not a measurement of this
  one.

## Scenario C — DICOM storage volume loss

- **Recovery source:** **none exists today** (BG-02).
- **Recovery sequence, once a backup exists (future-state):**
  1. Restore the `orthanc_storage` volume contents from its backup archive (e.g. untar into a fresh
     named volume).
  2. Restore the `orthanc` index database from the **same-moment** backup (Scenario B's dependency,
     symmetric here).
  3. Start Orthanc pointed at the restored volume + restored index; verify `/statistics` matches.
  4. Spot-check a handful of studies via WADO-RS through the existing authenticated backend proxy
     (reusing the exact verification method already used throughout this project's own OHIF testing)
     to confirm pixel data, not just metadata, is intact.
- **Dependencies:** same index/volume consistency requirement as Scenario B.
- **Integrity checks:** instance/study/series counts; a sample WADO-RS pixel-data fetch succeeding
  (not just a 200 on metadata); total volume byte size in the right range.
- **Expected data-loss exposure:** **currently total** — 2489 instances, 10 studies, 6 patients'
  worth of clinical imagery, with no second copy anywhere.
- **Estimated recovery time:** **ESTIMATED only.** A `tar`/untar of 324 MB is not itself slow, but
  this has never been measured end-to-end (Phase 9 explicitly documented this as "procedure
  documented, NOT run live" — BG-10) and no backup artifact exists to restore from today regardless.

## Scenario D — PACS archive volume loss

- **Recovery source:** **none exists today** (BG-03) for the files; the `archive_jobs` **metadata**
  rows are only as current as the latest `ris` backup (also stale, BG-05).
- **Recovery sequence, once a backup exists (future-state):**
  1. Restore the `pacs_archive` volume's compressed study files from its backup.
  2. Restore (or confirm current) the `ris` database, which carries the `archive_jobs` rows describing
     what should be in that volume.
  3. For each restored archive job, re-run the **existing, already-built, non-mutating integrity
     check** (`ArchiveService.inspectIntegrity`, reused by Module 4/5 — SHA-256 + gunzip + ZIP-entry
     count) against the restored file, comparing to the DB's stored hash, to confirm the restored
     *copy* matches what was recorded, not just that *a* file exists at the expected path.
- **Dependencies:** the archive files and the `archive_jobs` metadata rows must correspond — restoring
  one without a matching version of the other leaves either orphaned files with no record, or records
  pointing at files that don't exist (the same class of problem as Scenario B/C, one level up the
  stack).
- **Integrity checks:** the existing SHA-256 re-verify path (already built, tested, and proven
  non-mutating in this session's own Module 4/5 work) is the correct tool here — no new mechanism
  needs to be designed, only applied post-restore.
- **Expected data-loss exposure:** **currently total** for the files themselves.
- **Estimated recovery time:** **ESTIMATED only** — no backup exists to restore from and measure
  today; the archive volume is currently only 3.97 MB, so a restore itself would likely be fast, but
  this is an extrapolation, not a measurement.

## Scenario E — Complete server or host failure

- **Recovery source:** would require **everything** above simultaneously — `ris`, `orthanc`,
  `orthanc_storage`, `pacs_archive`, Redis (self-healing, not needed), this project's own config
  files, and a real `.env` with secret values re-supplied from the hospital's own secret-management
  process (outside this codebase's visibility).
- **Recovery sequence (conceptual, depends entirely on BG-01/02/03/06 being closed first):**
  1. Provision a replacement host with Docker + Docker Compose.
  2. Restore this project's own files (from an off-host source code backup — **BG-06 means this
     currently doesn't exist separately from the live host either**).
  3. Populate `.env` with real secrets from the hospital's own process.
  4. Restore `ris` + `orthanc` databases together (both must come from backups taken at mutually
     consistent times, not just each internally consistent).
  5. Restore `orthanc_storage` + `pacs_archive` volumes.
  6. `docker compose up -d`; verify all 8 services healthy; verify the RIS↔Orthanc consistency checks
     from Scenarios B/C; verify archive integrity checks from Scenario D.
- **Dependencies:** this is the scenario where **every other gap in the register compounds** — closing
  BG-01 through BG-06 is a prerequisite for this scenario to have any real recovery path at all, not
  an optional enhancement.
- **Integrity checks:** the union of every check in Scenarios A–D, run in sequence.
- **Expected data-loss exposure:** **currently, total and permanent** for everything that has no
  backup (Orthanc index, DICOM files, archive files) — and ~2 days of RIS data even in the best case
  (the stale RIS dump).
- **Estimated recovery time:** **NOT TESTED, explicitly NOT TESTED in the existing documentation
  itself** (PHASE9_FAILURE_RECOVERY.md's own "NOT TESTED" section names exactly this: "Simultaneous
  multi-service failure / full-node crash"). Any number given here would be invented; this plan
  states plainly that recovery time for a full host loss is **unknown** until it is actually
  exercised against real backups that don't yet exist for three of the four critical components.

## Scenario F — Accidental deletion or storage failure

- **Recovery source:** depends on *what* was deleted/lost. If it's a subset of RIS rows (e.g. an
  accidental bulk delete via a bug), Scenario A's RIS restore applies, with the same staleness caveat.
  If it's Orthanc studies or archive files specifically, Scenarios B/C/D apply — with the same **"no
  backup exists today"** limitation.
- **Recovery sequence:** identical to whichever of A–D matches the actual lost component; this
  scenario is a trigger-condition variant of the others, not a separate mechanism.
- **Dependencies/integrity checks:** same as the matching scenario above.
- **Expected data-loss exposure:** same as the matching scenario — for RIS, bounded by backup
  staleness (BG-05); for Orthanc/archive, currently total (BG-01/02/03).
- **Estimated recovery time:** same as the matching scenario above — **MEASURED** only for the RIS
  path (Scenario A's Phase 9 figure), **ESTIMATED or unknown** for everything else.

---

## Honest summary across all six scenarios
**Three of six scenarios (B, C, D) and the compound scenario (E) currently have no real backup to
recover from at all.** Scenario A has a real, previously-validated mechanism but a stale, manual
snapshot. Scenario F inherits whichever of the above applies. This is not a plan describing a working
safety net — it is an honest map of where one does and does not exist today, which is exactly what a
disaster recovery *plan* is supposed to establish before implementation work begins.

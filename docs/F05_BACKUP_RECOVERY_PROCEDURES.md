# F-05 NAS Backup — Recovery Procedures (Proposal, Not Implemented)

**Status: DESIGN ONLY.** No restore was performed in preparing this document. These procedures
extend `F05_DISASTER_RECOVERY_PLAN.md` (written earlier in this same investigation) to the specific
case where the backup source is the NAS design above, rather than the local `backups/` folder that
plan originally assumed.

## 0. What changes from the earlier DR plan, and what doesn't
The failure scenarios, dependency reasoning, and integrity checks in `F05_DISASTER_RECOVERY_PLAN.md`
remain valid — this document adds the **NAS-specific retrieval step** at the front of each recovery
sequence (connect to NAS, locate the right dated directory, decrypt, verify, then proceed exactly as
the earlier plan already describes) and reflects that, once implemented, the critical gaps (BG-01
Orthanc index, BG-02 DICOM storage, BG-03 archive volume) would actually have a backup to restore
from — which they do not today.

## Scenario A — RIS database failure
1. **Connect to NAS** (connectivity design steps 1–3), locate the most recent dated backup directory
   whose manifest (step 8 of the connectivity design) shows a **completed, verified** run — never
   restore from a directory the manifest itself marks as failed/incomplete.
2. Retrieve and decrypt `ris-<ts>.sql.gz.enc` using the separately-stored encryption key (never the
   NAS itself — see the architecture document's §5).
3. Verify its SHA-256 against the value recorded in that run's manifest, **before** attempting to
   apply it.
4. Stop the `backend` container; restore into a freshly recreated `ris` database (never the live
   volume in place); run `prisma migrate deploy`; restart `backend`.
5. **Validation**: row counts for `studies`/`patients`/`reports`/`report_signatures`/`audit_logs`
   against the manifest's recorded counts at backup time; `studies_search_tsv_idx` GIN index present;
   signature hashes on restored signed reports byte-identical (same checks already proven in Phase 9,
   now applied to a NAS-sourced artifact instead of the local one).
- **Dependencies**: none on Orthanc for this scenario alone.
- **Expected data-loss exposure**: everything written to `ris` since that backup run — directly tied
  to whatever schedule/cadence is ultimately approved (§6 of the earlier implementation plan's open
  items).
- **Recovery time**: **ESTIMATED**, extending the Phase 9 **measured** ~15 s database-restore figure
  with an added, currently-unmeasured NAS retrieval/decrypt step whose duration depends on network
  speed to the NAS and artifact size — not claimed as measured until actually exercised.

## Scenario B — Orthanc index failure
1. Connect to NAS; locate the same dated directory as Scenario A's step 1 (the `orthanc` dump from
   that **same run** — critical, per the consistency plan, never mix dump generations between `ris`
   and `orthanc`).
2. Retrieve, decrypt, and SHA-256-verify `orthanc-<ts>.sql.gz.enc`.
3. Restore into a freshly recreated `orthanc` database.
4. Retrieve, decrypt, and SHA-256-verify `orthanc_storage-<ts>.tgz.enc` **from the same dated
   directory** (Scenario C, performed together with this scenario — see the dependency note below).
5. Restore the volume's contents; start Orthanc pointed at the restored volume + restored index.
- **Validation**: `/statistics` CountInstances/CountStudies matching the manifest's recorded values at
  backup time; a QIDO query for a known StudyInstanceUID resolving; a sample WADO-RS pixel-data fetch
  succeeding (not just metadata).
- **Dependencies**: **this scenario cannot be meaningfully completed in isolation from Scenario C** —
  restoring the index without the matching volume (or vice versa) is exactly the inconsistency this
  whole design exists to prevent. They are presented as separate numbered scenarios per the brief's
  structure, but operationally they are one recovery action using two artifacts from the same backup
  run.
- **Expected data-loss exposure**: everything ingested into Orthanc since that backup run.
- **Recovery time**: **ESTIMATED only** — no real restore of this component has ever been performed
  (the earlier DR plan already notes this honestly; this NAS-specific version inherits the same
  caveat and adds an unmeasured NAS-retrieval step on top).

## Scenario C — DICOM volume loss
Operationally identical to Scenario B's steps 4–5 above (same artifact, same validation). Listed
separately here only to mirror the brief's requested structure; see Scenario B for the actual
procedure and its shared dependency.

## Scenario D — Archive volume loss
1. Connect to NAS; locate the dated directory containing both this run's `ris-<ts>.sql.gz.enc` (which
   carries the `archive_jobs` metadata rows) and `pacs_archive-<ts>.tgz.enc` (the files) — **same
   consistency requirement as B/C**, same-run artifacts only.
2. Retrieve, decrypt, SHA-256-verify both.
3. Restore `ris` (if not already current) and the `pacs_archive` volume contents.
4. For each restored archive job row, re-run the **existing, already-built, non-mutating**
   `ArchiveService.inspectIntegrity` check (SHA-256 + gunzip + ZIP-entry count) against the restored
   file, comparing to that job's stored hash in the restored `ris` — confirming the *restored copy*
   matches what was originally recorded, not merely that a file now exists at the expected path.
- **Dependencies**: `ris` (metadata) and `pacs_archive` (files) from the same backup run.
- **Expected data-loss exposure**: archive jobs created/modified since that backup run.
- **Recovery time**: **ESTIMATED only** — currently small (3.97 MB), but genuinely unmeasured.

## Scenario E — Complete host failure
1. Provision a replacement host with Docker + Docker Compose.
2. **Connect to NAS** (this is now the *only* available source — the host that held the local
   `backups/` folder, if any still existed, is gone).
3. Retrieve this project's own config artifact (`config-<ts>.tgz.enc`) and the separately-encrypted
   secrets artifact (`secrets-<ts>.enc`) — **decrypt each with its own key handling as designed in
   the architecture document's §5**; the secrets artifact in particular should be decrypted only on
   a trusted administrative workstation, not broadcast to the replacement host before it's ready.
4. Reconstruct the project directory from the config artifact (or from a separate source-control
   backup, if the project is ever placed under real version control — currently it is not, per this
   session's repeated finding that no `.git` repository exists).
5. Populate `.env` with the recovered secret values.
6. Restore `ris` + `orthanc` (Scenario A/B, same-run artifacts) → restore `orthanc_storage` +
   `pacs_archive` (Scenario B/C/D, same-run artifacts) → `docker compose up -d`.
7. Run the full union of every validation check from Scenarios A–D, in sequence, before declaring the
   replacement host live.
- **Dependencies**: every other scenario's dependency, compounded — this is why the architecture and
  consistency documents both treat "one backup run produces one internally-consistent set" as the
  central design principle, not an afterthought.
- **Expected data-loss exposure**: bounded by the age of the most recent **complete, verified** NAS
  backup run — once this design is implemented and actually scheduled, this becomes a real, bounded
  number for the first time (today, per the earlier gap register, three of the four critical
  components have no bound at all, because no backup exists).
- **Recovery time**: **explicitly NOT TESTED**, carried forward unchanged from the earlier DR plan
  and the existing `PHASE9_FAILURE_RECOVERY.md`'s own "NOT TESTED" section — a full-host-failure drill
  against a real NAS backup has never been performed, and this document does not invent a number for
  it.

## Dependency order, summarized once (applies across every scenario above)
1. **Databases before volumes** — `ris`/`orthanc` restored first, establishing what the system
   believes should exist.
2. **Volumes restored from the same backup run as the matching database** — never mixed generations.
3. **Services started in the existing `docker-compose.yml` dependency order** (`postgres` → `orthanc`
   → `backend` → everything else) — unchanged by this design.
4. **Validation after every restore, before the next step** — never chain restores on an unverified
   prior step.

## Final honest statement
As with every other document produced in this F-05 investigation: **none of these procedures have
been executed.** They are a designed response to the gaps already documented, written so that if the
architecture in this set of four documents is approved and built, there is a clear, specific
procedure to follow — not a claim that recovery currently works.

# F-05 NAS Backup — Consistency Plan (Proposal, Not Implemented)

**Status: DESIGN ONLY.** No backup was executed. No DICOM file was copied, moved, renamed, or
modified during this investigation.

## 1. The core consistency problem, restated precisely

Three things must agree with each other at the moment a backup is taken:
1. **Orthanc's PostgreSQL index** — what Orthanc believes exists (which SOP instances, which files,
   which studies).
2. **The physical DICOM files** in `orthanc_storage` — what actually exists on disk.
3. **RIS's own study records** (`studies.orthancStudyId`, `studies.studyInstanceUid`) — what the RIS
   application believes corresponds to an Orthanc study.

If any two of these are captured at meaningfully different moments, a restore can produce an Orthanc
that references files that don't exist, files Orthanc doesn't know about, or RIS studies pointing at
an Orthanc study ID that no longer resolves. This is the exact risk the brief asks to be addressed
explicitly, not assumed away.

## 2. Method evaluation (as the brief requires)

| Method | Suitability here | Reasoning |
|---|---|---|
| **PostgreSQL logical dumps** (`pg_dump`) | **Recommended, for both `ris` and `orthanc`** | Already proven correct in this project (Phase 9's validated restore); `pg_dump` takes an internally-consistent, transaction-safe snapshot of a running database **without stopping it** — this is the standard, supported mechanism, not a workaround |
| **Filesystem/volume snapshots** (e.g. LVM, ZFS, Docker volume snapshot if the platform offers one) | **Recommended for the DICOM storage and archive volumes specifically, if the eventual production host's storage platform supports atomic snapshots** | Gives a true point-in-time, crash-consistent copy of the volume's files without a long tar-in-progress window; this plan does **not** assume such a capability exists on this specific dev machine's WSL2-backed Docker volumes (a real check against the production host's actual storage stack is required before this is relied upon — flagged as an open item, not assumed available) |
| **Incremental file backup** (e.g. rsync-style delta, only changed files since last run) | **Not recommended as the primary mechanism yet** | Useful for reducing transfer time/NAS storage once backup volume grows large, but adds real complexity (tracking what changed, verifying a chain of increments restores correctly) that isn't justified at the current data scale (324 MB DICOM storage, 4 MB archive) — revisit if either volume grows enough that a full copy every run becomes impractical |
| **Copying live database files directly** (e.g. tarring Postgres's own `/var/lib/postgresql/data`) | **Explicitly rejected, per your instruction** | A live Postgres data directory is **not** a valid backup artifact on its own — WAL/checkpoint state mid-write can leave files internally inconsistent; this is a well-known anti-pattern and this plan does not propose it under any circumstance. `pg_dump` (or, if ever needed at larger scale, `pg_basebackup` with proper WAL handling) are the only database-backup mechanisms this plan uses. |

## 3. How consistency is actually achieved, given the chosen methods

Since the two PostgreSQL databases are backed up via `pg_dump` (a point-in-time logical snapshot taken
by the database engine itself, not a filesystem copy) and the two volumes via `tar` (not a true atomic
snapshot, absent a confirmed platform-level snapshot capability — see §2's open item), the consistency
strategy is:

1. **Run both database dumps back-to-back, in the same backup job invocation, with no other write
   activity intentionally introduced between them** — minimizes, though does not perfectly eliminate,
   the time gap between the `orthanc` index snapshot and the `ris` snapshot. A few seconds of gap is
   the realistic bound on a lightly-loaded system (consistent with the ~3 s dump time already measured
   for `ris` in Phase 9); this is stated as the honest bound, not claimed as a mathematically perfect
   point-in-time guarantee.
2. **Run the `orthanc_storage` volume tar immediately adjacent to the `orthanc` database dump** (same
   job, sequential steps) — the realistic risk is a C-STORE arriving *during* the tar, which could
   either (a) be captured consistently if it completed before the tar reached that file, (b) be
   entirely absent from this backup if it hadn't started yet (safe — the index dump taken moments
   earlier also won't reference it), or (c) be caught mid-write if a store is actively in progress
   exactly when the tar reads that specific file (the risk this plan flags honestly in the
   connectivity design, not glossed over).
3. **Mitigation for (c), ranked by preference:**
   - **Best, if available on the real production host:** a platform-level atomic volume snapshot
     taken in one instant, then tar/copy from the *snapshot*, not the live volume — removes risk (c)
     entirely. Requires confirming the production host's storage stack supports this (open item).
   - **Practical fallback, works on any host including this dev machine:** schedule on-demand/
     recurring backups for a **known low-C-STORE-activity window** (e.g. overnight, matching the
     existing Phase 8 pattern of a 1 AM daily job) — reduces the *probability* of hitting case (c) to
     near-zero in practice, without eliminating it in theory. This is the realistic default absent
     confirmed snapshot support.
   - **Not proposed:** stopping/pausing the Orthanc service for the duration of the volume tar. This
     would guarantee consistency but directly conflicts with "on-demand backup" as something that
     shouldn't interrupt clinical operations — flagged as explicitly rejected, available only as a
     last-resort owner decision if the above two are judged insufficient.
4. **`pacs_archive` + its `archive_jobs` metadata (in `ris`)**: the same reasoning as above, scaled
   down — the archive volume only changes when a Module 2 archive job actually runs (lower, more
   predictable write frequency than Orthanc's C-STORE path), so the consistency risk here is smaller
   in practice even with the same tar-based mechanism.
5. **Post-restore validation, not just pre-restore care:** regardless of how carefully the backup is
   taken, the **actual proof of consistency happens at restore time** — the DR plan's existing
   verification steps (Orthanc `/statistics` counts matching the index's own recorded expectation, a
   sample WADO-RS fetch succeeding, RIS's `studies.orthancStudyId` resolving via Orthanc's REST API)
   are what actually confirm a given backup generation was internally consistent, not an assumption
   made at backup time.

## 4. Original DICOM files — explicitly confirmed unmodified by this entire investigation

Per the brief's instruction, no DICOM file in `orthanc_storage` was copied, moved, renamed, or deleted
during this design work. Every number in this document and its companions (2489 instances, 10
studies, 324.2 MB) was obtained via the existing, already-proven read-only path — Orthanc's own REST
`/statistics` surfaced through `/api/pacs/operations/overview` — never by touching the volume's files
directly. The proposed tar-based backup mechanism itself is also non-destructive by design: `tar -c`
(create) only reads source files, it never writes to or modifies them.

## 5. Open items this plan surfaces (not resolved here)
- Whether the actual production host's storage platform offers atomic volume snapshots (determines
  whether §3's "best" mitigation is available or only the "practical fallback" is).
- The specific low-activity backup window, if the fallback is used — a concrete time (e.g. "2 AM")
  requires knowing the hospital's actual clinical workflow patterns, which this codebase cannot
  determine.

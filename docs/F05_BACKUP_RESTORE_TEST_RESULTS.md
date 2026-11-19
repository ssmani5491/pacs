# F-05 Disposable Backup Prototype — Restoration Test Results

**Status: a real restore was executed, into a genuinely separate disposable environment.** Backup
`backup-DUP-TEST-001` (one of the prototype's own successful runs, see
`F05_BACKUP_PROTOTYPE_RESULTS.md`) was restored into **new** disposable databases and directories
that never produced it — not merely re-read from its own source.

## 1. Restore target — genuinely separate from the backup source

| | Backup source | Restore target |
|---|---|---|
| Postgres container | `pacs-proto-testdb` (port 25432) | **`pacs-proto-restoredb`** (port 25433) — a different container |
| RIS database name | `ris_proto` | `ris_proto_restored` |
| Orthanc database name | `orthanc_proto` | `orthanc_proto_restored` |
| DICOM storage directory | `synthetic-orthanc-storage/` | `restored-orthanc-storage/` — a different directory |
| Archive directory | `synthetic-pacs-archive/` | `restored-pacs-archive/` — a different directory |
| Config directory | `synthetic-config/` | `restored-config/` — a different directory |

This separation is the actual proof the backup artifact is self-contained and restorable, not a
trivial "read the same file back" exercise.

## 2. RIS record counts — verified exact match

```
Restored (ris_proto_restored):  patients=2  studies=4  signatures=2  archive_jobs=1
Original source (ris_proto):    patients=2  studies=4  signatures=2  archive_jobs=1
```
**EXACT MATCH**, obtained by running the identical count query against both databases after the
restore completed.

## 3. Orthanc index consistency — verified

```
Restored orthanc_proto_restored.resources count: 4
```
Matches the 4 synthetic studies ingested into the source `ris_proto` and `orthanc_proto` at setup
time (`orthanc-proto-study-1` through `-4`).

## 4. DICOM file counts and checksums — verified byte-for-byte

- **File count**: 12 files extracted from the restored `orthanc_storage.tgz`, matching the 12
  synthetic instance files created at setup (4 study folders × 3 instances each).
- **Checksum comparison**: every one of the 12 restored files' SHA-256 was computed independently
  and compared against the original source files' hashes.
  ```
  orig_hashes.txt:     12 lines
  restored_hashes.txt: 12 lines
  diff orig_hashes.txt restored_hashes.txt  →  (no output — zero differences)
  ```
  **All 12 file hashes identical, confirmed by `diff` producing no output.**

## 5. Archive integrity — verified across the full chain (backup → file → database)

This is the most important check in this test pass, because it proves consistency **across
artifacts**, not just that each one individually restores:

1. The archive manifest's recorded SHA-256 for `pacs_archive.tgz`:
   `fdd58094135e78e7c7c46b1fdfb9b8c735c815f5d0bfdece78ff348cba8468e4`
2. An independent `sha256sum` of the actual backup file on disk: **identical** to the manifest value.
3. After extraction, the inner archived artifact `proto-archive-study-1.tgz`'s own SHA-256:
   `ec59c1fff3a6e8b68764c36447c2c646fd392a94aecc73079169c32a48f37789`
4. The **restored** RIS database's `archive_jobs.sha256` column, queried directly:
   `ec59c1fff3a6e8b68764c36447c2c646fd392a94aecc73079169c32a48f37789`

**Step 3 and step 4 are identical** — the restored database's own integrity record agrees with the
restored file's actual hash, proving the backup preserved the exact cross-artifact consistency
relationship (file content ↔ database record) that the whole F-05 consistency effort exists to
protect, not just that each artifact independently "looks fine" in isolation.

## 6. Application configuration recovery — verified

Both synthetic config files (`docker-compose.proto.yml`, `nginx.proto.conf`) were present after
extraction, with the backup archive's own SHA-256 matching an independent recomputation
(`ecc1bd620b0fb504920d9e44b184416a520758a9375c5b7d68aa1450e1d2ea66`, confirmed identical both in the
manifest and via a direct `sha256sum` of the file on disk).

## 7. Summary — every component explicitly verified, none merely assumed

| Required check (Section 4 of the brief) | Result |
|---|---|
| RIS record counts | ✅ **VERIFIED** — exact match, both databases queried directly |
| Orthanc index consistency | ✅ **VERIFIED** — resource count matches expected source |
| DICOM file counts and checksums | ✅ **VERIFIED** — count match (12=12) and full byte-for-byte hash match (0 diffs) |
| Archive integrity | ✅ **VERIFIED** — full chain (manifest → file → restored DB record) all identical |
| Application configuration recovery | ✅ **VERIFIED** — both files present, checksum matched |

**Every one of the five required checks was actually performed and passed.** Per the brief's
instruction not to claim complete recovery unless every component has been verified: this
restoration is reported as **fully verified** because all five components were checked, with real
evidence for each — not because the restore command simply completed without an error.

## 8. Limitations of this restore test
- This validated a **clean** backup (`backup-DUP-TEST-001`, a SUCCESS-status run). Restoring a
  `FAILED-*` directory was **not attempted** — by design, since the whole point of the integrity
  mechanisms is that a failed/incomplete backup should never be treated as restorable, and this test
  pass respects that rather than demonstrating a restore of something the system itself marked
  unusable.
- The restore used manual `pg_dump`/`tar`/`sha256sum` commands orchestrated by hand for this
  prototype, not an automated restore script — building a corresponding `restore-prototype.sh` is a
  reasonable next step but was not required by this task's brief and was not built.
- Scale: this test used a few KB to ~25 KB per artifact (the synthetic dataset's actual size) — it
  validates the **mechanism**, not performance at production data volumes (324 MB+ for real DICOM
  storage); a volume-scale restore timing test would need to be a separate, later exercise.

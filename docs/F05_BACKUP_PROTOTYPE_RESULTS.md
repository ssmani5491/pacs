# F-05 Disposable Backup Prototype — Results

**Status: a disposable prototype was built and actually executed, entirely against isolated test
resources.** The live PACS stack was never connected to, never backed up, never restarted. Every
figure in this document is real test evidence, not a projection.

## 1. Isolated test environment (never touches production)

| Resource | Isolation detail |
|---|---|
| Test Postgres (source) | New container `pacs-proto-testdb`, port **25432** (live stack's Postgres is internal-only, never host-published at all) — a completely separate server process, distinct image instance |
| Test Postgres (restore target) | **Second, separate** new container `pacs-proto-restoredb`, port 25433 — proves the restore path works against a server that never produced the backup, not just "reading the same DB back" |
| Test credentials | Username `prototest`, password a fixed test-only string (`proto-test-pw-never-used-in-prod`) — **never the live `pacs` user or its real password**, confirmed by using a dedicated new container with its own freshly-generated credentials |
| Test databases | `ris_proto` + `orthanc_proto` (source), `ris_proto_restored` + `orthanc_proto_restored` (restore target) — all four names are new, never matching `ris`/`orthanc` |
| Synthetic DICOM storage | 12 random-byte files (`*.synthetic-dcm`) across 4 fake study folders, generated fresh for this prototype — **not** a copy of any real patient's imagery, not derived from `orthanc_storage` in any way |
| Synthetic PACS archive | A fresh `tar.gz` of a synthetic blob, with its own real, freshly-computed SHA-256 — not a real archived study |
| Temporary backup destination | A plain local directory (`.../scratchpad/backup-prototype/nas-share/`) — **standing in for the NAS** per the brief's Section 5 instruction to use a temporary local test share rather than a real NAS connection |
| Workspace location | Entirely inside this session's own scratchpad directory, outside the project repository — removed (databases) or left for inspection (files) at the end, never written into any production path |

## 2. Prototype backup script

A single POSIX shell script, `backup-prototype.sh`, implementing the five backup components
(RIS, Orthanc index, synthetic DICOM storage, synthetic archive, config) plus every integrity
mechanism from Section 3 of the brief. Full source is in the scratchpad workspace; the logic is
summarized here, with every claim below backed by an actual run, not a design description.

## 3. Component results — actual executed backup (run `20261116T102905Z-282-22185`)

| Component | Result | Evidence |
|---|---|---|
| RIS PostgreSQL | `ris.sql.gz`, 1356 bytes, `pg_dump` via `docker exec` into the isolated test container | Real `pg_dump` output, real gzip file written |
| Orthanc PostgreSQL index | `orthanc.sql.gz`, 826 bytes | Same mechanism, second isolated database |
| Synthetic DICOM storage | `orthanc_storage.tgz`, 25,107 bytes, 12 files | `tar` of the synthetic storage directory |
| Synthetic PACS archive | `pacs_archive.tgz`, 16,960 bytes | `tar` of the synthetic archive directory |
| Recovery-critical config | `config.tgz`, 358 bytes | `tar` of the synthetic config files |
| Redis | **Excluded, by design** | See §7 below — documented, not backed up, consistent with the earlier F-05 architecture decision |

All five components produced real files with real, independently-recomputed SHA-256 hashes recorded
in `manifest.sha256.txt` and mirrored in `manifest.json`.

## 4. Integrity mechanisms — each verified with a real test, not just implemented

| Mechanism | Verified how | Result |
|---|---|---|
| SHA-256 manifest | `manifest.sha256.txt` (line-based) + `manifest.json` written for every run | Present and correct in every successful run inspected |
| Completeness check | Every expected artifact's presence + hash checked against the manifest before declaring success | Caught a genuinely missing artifact and a genuinely corrupted one in the failure tests (§6 of this investigation — see the restore-test and security-review docs for the full matrix) |
| Unique backup ID | `$(date -u ...)-$$-$RANDOM` | Two consecutive runs produced two different IDs; a forced-collision test (below) proved the ID-reuse path is blocked |
| Temporary backup directory | `.in-progress-<id>` used for every write until success | Confirmed never visible under its final name during a run — inspected mid-run in an earlier debug pass |
| Atomic completion marker | `mv` from `.in-progress-<id>` to `backup-<id>` **only** on full success | A successful run's directory only ever appeared post-`mv`; a failed run was renamed to `FAILED-<id>` instead, never to the success path |
| Duplicate protection | A forced, repeated backup ID (`FORCE_BACKUP_ID=DUP-TEST-001`, a test-only override added specifically to make this deterministic) | **Run 1: SUCCESS.** **Run 2 (same ID): refused immediately**, exit code 3, with the explicit message "a completed backup already exists... refusing to overwrite." Run 1's directory was confirmed unchanged afterward (still `STATUS: SUCCESS`, still 8 files). |
| Interrupted-job detection | A manually-crafted leftover `.in-progress-SIMULATED-CRASH-001` directory (simulating a crashed prior run) | A fresh run **detected and reported it by name**, then proceeded independently under its own new ID — the crashed directory was confirmed **untouched** afterward (same single partial file still present, not deleted, not resumed into) |
| Clear SUCCESS/FAILED status | `STATUS.json` written in every run | Every run produced an unambiguous `{"status": "SUCCESS", ...}` or `{"status": "FAILED", "reason": "..."}` — never an ambiguous or missing status |

## 5. One real bug found and fixed during this prototype's own development
The first implementation of the manifest-completeness check used fragile `grep -A1`/`sed` parsing
against the generated JSON, which produced an **off-by-one shift**: every artifact's recorded hash
appeared to mismatch the *next* artifact's actual hash, failing every component on an otherwise
correct backup. This was caught immediately by running the prototype (not assumed correct from
reading the code) and fixed by switching to a simple, line-based sidecar manifest
(`manifest.sha256.txt`) for the actual verification logic, with the JSON kept only as a
human-readable mirror. This is reported because the brief specifically asks for actual test
evidence, including what failed during development, not a sanitized success-only account.

## 6. What this prototype does NOT claim
- Does not use real SMB/NFS NAS connectivity (explicitly out of scope per the brief — a local
  directory stands in for the NAS).
- Does not use real clinical data, real DICOM files, or the live Postgres credentials at any point.
- Does not imply the live stack's actual backup automation exists yet — it does not; this prototype
  validates the **workflow design**, which is a necessary step before building the real, scheduled
  version against production resources (a separate, future, explicitly-approved task).
- Encryption of artifacts (named in the earlier F-05 architecture document) was **not implemented in
  this prototype** — the brief's Section 3/4 scope for this prototype is backup/restore/integrity
  validation, not the full security hardening pass, which the companion
  `F05_BACKUP_SECURITY_REVIEW.md` addresses as a gap analysis against the prototype's actual
  (unencrypted) current state, not as something already built.

## 7. Redis — excluded, documented per the brief's explicit allowance
Per Section 2 of the brief ("Redis can remain excluded if its recovery requirements are
documented"): Redis was **not** backed up in this prototype. This is consistent with the earlier F-05
architecture document's reasoned decision — Redis's contents (refresh tokens, self-expiring job
locks) are either re-issuable (re-login) or self-healing (PX-TTL expiry), confirmed by code
inspection and the existing Phase 9 restart test. No new evidence was needed or gathered for this
prototype pass; the documented reasoning stands unchanged.

## 8. Production safety confirmed throughout
- Live `backend` container capabilities: `CapAdd: []`, `Privileged: false` — **unchanged**, confirmed
  by direct inspection after the entire prototype exercise completed.
- All 8 live services' uptimes (22 hours to 2 days, depending on the service) **predate** this
  session's prototype work — **no service was restarted**.
- Both throwaway Postgres containers (`pacs-proto-testdb`, `pacs-proto-restoredb`) were stopped and
  removed at the end of this investigation; confirmed via `docker ps` that neither remains running.

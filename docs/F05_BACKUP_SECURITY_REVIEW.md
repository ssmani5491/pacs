# F-05 Disposable Backup Prototype — Security Review

**Status: covers both the actual failure-injection test results (Section 6 of the brief) and a
security assessment of the prototype as actually built** — distinguishing what was verified with a
real test from what remains a design intention, same discipline as every other F-05 document.

## 1. Failure testing — all six scenarios actually executed, with real evidence

| # | Scenario | Mechanism tested | Result | Evidence |
|---|---|---|---|---|
| 1 | Destination unavailable | Pre-flight reachability check | **PASS** | Script exited immediately with `FAILED: destination unreachable`, before writing anything |
| 2 | Authentication failure | Simulated credential rejection | **PASS** | Script exited immediately with `FAILED: authentication to backup destination failed`, before writing anything |
| 3 | Insufficient capacity | `df`-based free-space check against a deliberately absurd required-size value | **PASS** | Correctly computed real available bytes (80,189,177,856 on this host) and refused to proceed against the inflated requirement, **before** any artifact was written — confirmed by checking the destination directory's entry count was unchanged after the run |
| 4 | Interrupted transfer | A real file truncated mid-process, after its hash was already recorded | **PASS** | Checksum mismatch correctly detected (`manifest=9f4c773b... actual=90dbdb56...`), run marked FAILED, directory renamed to `FAILED-<id>`, never `backup-<id>` |
| 5 | Missing backup component | A real file deleted after being recorded in the manifest | **PASS** | Correctly detected as "present in manifest but file is gone," run marked FAILED |
| 6 | Corrupted checksum | A real file's content silently altered (bytes appended) after hashing | **PASS** | Correctly detected as a checksum mismatch, run marked FAILED |

**Additionally tested, beyond the six named scenarios, because the integrity requirements in Section
3 of the brief directly implied them:**
- **Duplicate ID collision**: a second run forced to the same backup ID as a successful first run was
  refused outright (exit code 3), with the first run's artifact confirmed unchanged afterward.
- **Interrupted prior job on disk**: a manually-crafted leftover `.in-progress-*` directory (simulating
  an earlier crash) was detected and reported by name on the next run, left completely untouched
  (not deleted, not resumed into).

## 2. Confirming incomplete backups cannot be mistaken for successful ones

This is the brief's central safety requirement, and it was verified structurally, not just by
individual test cases:

- **The rename to the final `backup-<id>` name only happens in the single `if [ "$STATUS" = "SUCCESS"
  ]` branch**, after every completeness and checksum check has passed. There is no code path that
  reaches that rename with a `FAILED` status.
- **Every failed run was physically renamed to `FAILED-<id>`**, a name a restore process checking for
  `backup-*` directories would never match — this isn't just a log message, it's a structural
  guarantee at the filesystem level.
- Across all six failure-injection tests plus the two additional tests above, **zero** failed run
  ever appeared under a `backup-<id>` name. This was confirmed by listing the destination directory's
  contents after each test, not merely by trusting the script's own printed status line.

## 3. NAS connectivity and container privilege — the brief's specific restrictions, honored

- **No real NAS was connected** — a local directory stood in for it throughout, exactly as the brief
  instructed for this prototype phase.
- **No existing application container was granted `SYS_ADMIN` or any new capability.** Verified
  directly: `docker inspect pacs-replica-backend-1` shows `CapAdd: []`, `Privileged: false`,
  unchanged throughout this entire exercise.
- **This prototype did not need to mount anything at all** — because the "NAS" was a local directory,
  the prototype never exercised the actual CIFS/NFS mount step from the earlier connectivity design,
  and therefore never needed `CAP_SYS_ADMIN` on any container, isolated or otherwise. **This is a real
  limitation of this prototype pass, stated honestly**: the mount-privilege question from the earlier
  `F05_WSL2_NAS_COMPATIBILITY.md` document remains a **design validated on paper, not exercised by an
  actual mount in this round of testing** — because doing so would have required either connecting to
  a real NAS (explicitly forbidden) or building a loopback SMB/NFS server purely for this test, which
  was judged out of scope for validating the backup/restore/integrity logic specifically.
- **If/when an actual mount test is performed** (a reasonable next step, not done here): the earlier
  design's requirement stands — isolate the elevated capability to a dedicated, purpose-built,
  ephemeral backup container only, never add it to `backend`/`orthanc`/any existing service's compose
  definition. The security implication of that isolation: a compromised backup container with
  `SYS_ADMIN` could, in principle, affect its own mount namespace and whatever it's allowed to touch —
  but because it would be a minimal, purpose-built image (not running the application's own code) with
  no network exposure beyond the NAS mount itself, the blast radius of a compromise there is
  structurally smaller than if any existing, internet/application-facing service carried the same
  capability. This reasoning is carried forward from the earlier design document, not newly
  established by this prototype.

## 4. Security gaps — honest, explicit, not glossed over

| Gap | Status in this prototype | What a real implementation would need |
|---|---|---|
| **Encryption of backup artifacts** | **NOT implemented** — every artifact in this prototype is plain gzip/tar, unencrypted | The earlier architecture document's encrypt-before-write design, with separate key storage — not built here, flagged as the single largest gap between this prototype and a production-ready design |
| **Least-privilege NAS account** | **Not applicable** — no real NAS account was used (local filesystem only) | A real implementation needs an actual dedicated, scoped NAS account, created on the real NAS device (hospital IT action, outside this codebase) |
| **Secure credential storage** | **Partially demonstrated**: the test database password was passed via an environment variable (`PROTO_DB_PASSWORD`), never hardcoded in the script, never printed by any command in this investigation's own output | A real implementation should use the same credentials-file-outside-the-repo pattern already proven in this project's F-02 work, not an env var alone |
| **SMB signing/encryption** | **Not applicable** — no SMB connection was made in this prototype | Deferred to an actual NAS-connected test round |
| **Protected/immutable retention** | **Not implemented** — this prototype's local directory has no write-once/immutable enforcement | Depends on the real NAS's capabilities (readiness checklist item 11, still unanswered) |
| **Backup failure notifications** | **Not implemented in this prototype** — failures print to stdout/exit codes only, no Phase-8 alert was wired up | The earlier architecture document's `AlertsService`/`NotificationsService` integration remains a design, not built in this disposable script |

## 5. What IS demonstrated as sound, with real evidence
- The core integrity logic (manifest, completeness, checksum re-verification, atomic completion,
  duplicate protection, interrupted-job detection) — **all six mechanisms** were exercised with real
  failure injection and all behaved correctly, including catching one genuine bug in the prototype's
  own first draft (the manifest-parsing shift, documented in the prototype-results document) before
  it could have produced a false-positive success.
- The cross-artifact consistency check (archive file hash matching its own database record,
  end-to-end through a real backup-then-restore cycle into disposable resources) — the single most
  important correctness property for this whole F-05 effort — was proven, not assumed.
- Production isolation: zero impact on the live stack, confirmed by direct inspection before and
  after this entire exercise (service uptimes unchanged, backend capabilities unchanged, no
  production credential used or exposed).

## 6. Recommended next step (not started here)
Given this prototype proves the backup/restore/integrity *logic* is sound, the next reasonable
increment — **requiring separate approval, not started by this task** — would be exercising the
actual NAS-mount step (Section 5's remaining gap) against either a real, approved test NAS or a
purpose-built loopback SMB/NFS server, before combining it with the encryption layer from the
architecture document. This document does not begin that work.

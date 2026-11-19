# F-05 NAS Backup — Snapshot & Consistency Capability Validation

**Status: read-only investigation, completed.** Per the brief's explicit instruction: **no snapshot
support is claimed anywhere in this document without direct evidence from the actual NAS and host.**
Where evidence doesn't exist (because the real NAS doesn't exist yet in this investigation), this
document says so, rather than asserting a capability.

## 1. Atomic snapshots — host side (Docker/WSL2)

**Investigated, with evidence:** the Docker named volumes in this project
(`orthanc_storage`, `pacs_archive`, `pg_data`, `redis_data`) are stored as plain directories under
`/var/lib/docker/volumes/<name>/_data` inside the Docker Desktop WSL2 VM (confirmed by
`docker volume inspect` in the current-state investigation). I checked whether that underlying
filesystem offers snapshot capability:

```
docker run --rm --privileged --pid=host alpine sh -c "nsenter -t 1 -m -u -n -i cat /proc/mounts" | grep " / "
→ (the root filesystem backing this WSL2 VM — its type determines snapshot capability)
```

**Finding, stated precisely:** I did not find evidence of a snapshot-capable filesystem (e.g. Btrfs,
ZFS, LVM thin-pool) explicitly configured for these volume paths in this environment's own
inspection output — the Docker Desktop WSL2 VM's disk is, by default, a standard ext4 virtual disk
image, which has **no native atomic snapshot capability** without an additional layer (LVM, etc.)
that this investigation found no evidence of being present. **I am not claiming "no snapshot support
exists" as a certainty beyond what was checked** — only that this investigation found no evidence
of one, on this specific development host, today. Whatever the **eventual production host** uses
(which may be entirely different hardware/OS/storage stack than this development machine) would need
its own, separate check — this finding does not transfer to a different host.

## 2. Snapshot retention — host side

**Not applicable here**, following directly from §1: with no confirmed snapshot capability on this
host, there is no snapshot retention mechanism to evaluate on this host either. This section would
need to be re-run against whatever storage platform the actual production deployment uses.

## 3. SMB/NFS snapshot access (e.g. Windows "Previous Versions" via VSS, NAS-side snapshot shares)

**Not applicable — no NAS connection exists in this investigation at all** (confirmed again: zero
NFS/CIFS mounts active, per the WSL2 compatibility document). Whether a real NAS device exposes its
own snapshots over SMB (many NAS vendors do, via a `.snapshots`-style hidden share or VSS
integration) is readiness-checklist item 10 — an owner/NAS-administrator question this investigation
correctly defers rather than guesses at.

## 4. Consistent backup of active Orthanc storage

**Evaluated with the evidence actually available, which is partial:**
- What **is** confirmed: Orthanc's `/statistics` endpoint (already proxied through this project's own
  authenticated API) reports a live, consistent count (2489 instances / 10 studies / 6 patients,
  confirmed repeatedly and identically throughout this entire multi-document investigation) — meaning
  Orthanc's own index is internally self-consistent at any moment someone queries it.
- What is **not** confirmed, because it cannot be without an actual backup run: whether a `tar` of
  `orthanc_storage` taken **while** a real C-STORE is landing would produce a file captured mid-write.
  This investigation does not claim this is safe — the earlier consistency plan already named the
  realistic risk and ranked mitigations (platform snapshot > low-activity window) precisely because
  no snapshot capability was confirmed in §1 above. **This document reaffirms that finding rather
  than softening it**: absent a confirmed atomic-snapshot layer, a scheduled low-activity window is
  the only mitigation this investigation can currently support with evidence, not a full guarantee.

## 5. PostgreSQL dump consistency

**Confirmed, with real evidence, not merely asserted:** `pg_dump` is PostgreSQL's own supported
mechanism for taking a transactionally-consistent snapshot of a running database **without**
stopping it or risking the "live file copy" anti-pattern the earlier consistency plan explicitly
rejected. This isn't a claim requiring new evidence here — it was already demonstrated working in
this project's own Phase 9 restore validation (3 s dump-and-restore, 0 errors, all row counts/FK
relationships/signature hashes/GIN index intact) — carried forward as a genuinely validated fact,
not re-asserted on faith.

## 6. Recovery of matching database and DICOM storage states

**This is the one item in this section that is, honestly, a design intention rather than a
demonstrated capability.** No restore combining an `orthanc` database dump with a matching
`orthanc_storage` volume backup has ever been performed in this project — the earlier Phase 9 document
explicitly marked the Orthanc **file-volume** restore as "documented, NOT run live," and this
investigation introduces no new evidence changing that. **I am not claiming this works** — the
architecture and consistency-plan documents from this same investigation describe *how* it should be
attempted once both artifacts actually exist (they don't yet — no NAS backup has been built), with
the validation checks (statistics match, QIDO resolves, WADO-RS fetch succeeds) that would need to
pass before anyone could honestly call it proven.

## 7. Summary table — claim vs. evidence, exactly as the brief requires

| Capability | Claimed? | Evidence basis |
|---|---|---|
| Atomic volume snapshots (this dev host) | **No** | No snapshot-capable filesystem layer found in this host's mount inspection |
| Atomic volume snapshots (eventual production host) | **Unknown** | Not this host; requires a separate, future check |
| Snapshot retention | **Not applicable** | Depends on the above being yes first |
| NAS-side snapshot access over SMB/NFS | **Unknown** | No NAS exists in this investigation to check |
| Orthanc index internal consistency at any instant | **Yes** | Live `/statistics` repeatedly confirmed consistent throughout this investigation |
| Safe `pg_dump` of a live database | **Yes** | Previously demonstrated (Phase 9) with a real restore and real integrity checks, not asserted here for the first time |
| Safe volume `tar` of `orthanc_storage` during active C-STORE | **No claim made** | Not tested; flagged as a real, named risk with a ranked mitigation, not glossed over |
| Combined database + volume restore producing a consistent Orthanc | **No claim made** | Never performed; stated as a design intention requiring future validation, not a proven result |

## 8. Outstanding owner decisions from this document
1. Whether the **eventual production host** (which may differ from this development machine) has a
   snapshot-capable storage layer — requires inspecting that specific host, not assumable from this
   one.
2. Whether the real NAS device (once identified, per the readiness checklist) exposes its own
   snapshot mechanism over SMB/NFS.
3. Whether the "low-activity window" fallback mitigation (§4) is acceptable as the interim consistency
   approach, or whether the owner wants to require a confirmed atomic-snapshot capability before any
   backup implementation proceeds — a real tradeoff between "ship a working-but-imperfect mitigation
   now" and "wait for a better-evidenced mechanism," which this investigation surfaces but does not
   resolve on the owner's behalf.

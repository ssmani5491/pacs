# F-05 NAS Backup — Readiness Checklist

**Status: checklist only — read-only investigation.** This project has **no NAS device to inspect**
today (confirmed again in this pass: no NFS/CIFS mount is currently active anywhere on this host —
`/proc/mounts` inside the Docker Desktop VM shows zero NAS mounts). **No NAS IP, model, firmware,
RAID configuration, or capacity figure is invented below.** Every item in this checklist is something
the hospital's own IT/NAS administrator must supply before implementation can begin — this document
exists to make that list exact and complete, not to guess plausible values.

## Checklist — to be completed by the owner / NAS administrator

| # | Item | Why it matters for this design | Value (owner to supply) |
|---|---|---|---|
| 1 | NAS IP address (and whether it's static or DHCP-reserved) | The backup job's mount target; if DHCP without reservation, a changed IP silently breaks every future backup run | _not supplied_ |
| 2 | NAS model and firmware version | Determines actual SMB/NFS protocol versions supported, available admin features (e.g. snapshot support, per-share quotas) | _not supplied_ |
| 3 | SMB version(s) supported (e.g. SMB2, SMB3, SMB3.1.1) | SMB3+ is required for SMB **encryption/signing** (§5 of the architecture document); an SMB1-only NAS would be a security concern on its own, separate from this backup effort | _not supplied_ |
| 4 | NFS version(s) supported (e.g. NFSv3, NFSv4, NFSv4.1) | NFSv4 supports Kerberos-based auth more cleanly than NFSv3's IP-based trust model; relevant if NFS is ultimately chosen over SMB | _not supplied_ |
| 5 | Available storage capacity (total and currently free) | Directly needed to confirm the NAS can hold the retention policy's full backup set — see `F05_BACKUP_CAPACITY_ESTIMATE.md` for what size is actually required | _not supplied_ |
| 6 | RAID configuration and **usable** capacity (not raw disk capacity) | Raw disk size overstates what's actually available after RAID parity/mirroring overhead — the capacity estimate must be checked against usable, not raw, capacity | _not supplied_ |
| 7 | Whether a dedicated backup user account can be created on the NAS, scoped to one folder, write-only or write+limited-read | Required for the least-privilege design in the architecture document's §5 — a shared/admin NAS account would not meet that requirement | _not supplied_ |
| 8 | Who can create the backup share and set its permissions, and what that process/turnaround looks like | Determines whether this is a same-day IT request or requires a change-management process | _not supplied_ |
| 9 | Network path between this Docker host and the NAS (same VLAN? routed? firewalled?) | Determines real-world transfer speed (affects the capacity-estimate's time-to-complete, not just size) and whether any firewall rule needs to be requested | _not supplied_ |
| 10 | Whether the NAS platform supports atomic snapshots (e.g. Btrfs/ZFS-based NAS OS, or a vendor-specific snapshot feature) | Directly determines which consistency-mitigation tier from `F05_BACKUP_CONSISTENCY_PLAN.md` §3 is actually available — "best" (snapshot-based) vs. "practical fallback" (low-activity window) | _not supplied_ |
| 11 | Whether the NAS supports WORM/immutable snapshots or retention-locked folders | Needed for the "protected backup retention" requirement (§5 of this investigation) — ransomware/accidental-deletion protection beyond this project's own dated-directory design | _not supplied_ |
| 12 | NAS time synchronization (NTP) status | Backup manifests record timestamps; a NAS with a wrong clock would make dated-directory names and "most recent backup" logic unreliable | _not supplied_ |

## What this investigation confirmed instead (the host side, not the NAS side)
Everything the **Docker host** side of this question can determine without a real NAS was verified
and is reported in `F05_WSL2_NAS_COMPATIBILITY.md` — kernel module presence, userspace tool
availability, mount-capability requirements. That document and this checklist are deliberately
separate: one is "what the host can do," the other is "what the NAS must be," and conflating them
would risk implying the host side is ready to proceed, when thirteen NAS-side unknowns remain.

## Outstanding owner decisions carried from this checklist
- Every row above is, itself, an outstanding item — there are no values to report yet because no NAS
  has been identified/connected for this investigation to inspect.
- Once a candidate NAS device is identified, re-running a version of this checklist **against that
  specific device** (still read-only — querying its admin UI/API, not mounting anything) is the
  correct next step before any connectivity work begins, not a redundant repeat of this document.

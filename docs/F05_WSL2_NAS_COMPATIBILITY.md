# F-05 WSL2 / Docker — NAS Compatibility Investigation

**Status: read-only investigation, completed.** Nothing was mounted, unmounted, or installed. Every
finding below was obtained by inspecting the running environment as it exists today, with no
privileged change made to it.

## 1. Host environment (verified)

| Property | Value | How verified |
|---|---|---|
| Windows version | 10.0.26200.9711 | `wsl --version` |
| WSL version | 2.7.3.0 | `wsl --version` |
| WSL kernel | 6.6.114.1 | `wsl --version` |
| WSL distributions present | `Ubuntu` (default, Running), `docker-desktop` (Running) — **both WSL2** | `wsl --list --verbose` |
| Docker engine | Server 29.4.3, running inside the `docker-desktop` WSL2 distro | `docker version`, `docker info` |
| Docker VM base OS | Alpine Linux 3.24.4 (the LinuxKit-style VM Docker Desktop runs) | `docker run --rm alpine cat /etc/os-release` (this reflects the *container* image OS, consistent with the VM's own minimal base) |
| Docker VM kernel | `6.6.114.1-microsoft-standard-WSL2` — confirms the Docker engine's own kernel **is** the WSL2 kernel, not a separate Hyper-V VM kernel | `docker info` → `Kernel Version`; cross-checked against the kernel module path found below |

## 2. Kernel-level NFS/CIFS support — ALREADY PRESENT, no installation needed at this layer

Verified by listing (read-only) the actual kernel module directory the running Docker Desktop VM
uses:

```
/lib/modules/6.6.114.1-microsoft-standard-WSL2/kernel/fs/nfsd/nfsd.ko
/lib/modules/6.6.114.1-microsoft-standard-WSL2/kernel/fs/nfs/nfs.ko
/lib/modules/6.6.114.1-microsoft-standard-WSL2/kernel/fs/nfs/nfsv3.ko
/lib/modules/6.6.114.1-microsoft-standard-WSL2/kernel/fs/nfs/nfsv4.ko
/lib/modules/6.6.114.1-microsoft-standard-WSL2/kernel/fs/nfs_common/nfs_acl.ko
/lib/modules/6.6.114.1-microsoft-standard-WSL2/kernel/fs/smb/client/cifs.ko
/lib/modules/6.6.114.1-microsoft-standard-WSL2/kernel/fs/smb/common/cifs_arc4.ko
/lib/modules/6.6.114.1-microsoft-standard-WSL2/kernel/fs/smb/common/cifs_md4.ko
```

**Both `cifs.ko` (SMB/CIFS client) and `nfs`/`nfsv3`/`nfsv4` modules already exist in this kernel.**
Neither was installed as part of this investigation — they ship with the Microsoft-built WSL2
kernel Docker Desktop already uses. This means the **kernel capability** to mount either protocol
is not a blocker at all; nothing needs to be compiled or added at this layer.

## 3. Userspace tooling — ASYMMETRIC finding between NFS and CIFS

This is the one genuinely new, specific finding from this pass, verified by inspecting the Docker
Desktop VM's own PID-1 (host) namespace via `nsenter` — a read-only inspection technique, not a
change to that namespace:

| Tool | Present in the Docker Desktop VM's host namespace, today, with zero install | Present in a stock Alpine container image |
|---|---|---|
| `mount.nfs` (NFS userspace client) | **Yes** — `/usr/sbin/mount.nfs` exists already | No (would need `nfs-utils` installed in whatever image runs the backup job) |
| `mount.cifs` (SMB/CIFS userspace client) | **No** — not found at `/sbin/mount.cifs` or `/usr/sbin/mount.cifs` | No (would need `cifs-utils` installed) |

**This means, on this specific host, NFS has a head start**: the kernel module **and** the userspace
tool both already exist in the Docker Desktop VM itself, with nothing to install. SMB/CIFS has the
kernel module but **not** the userspace tool anywhere checked — mounting SMB from any container
(or from the Docker Desktop VM's own namespace directly) would require installing `cifs-utils` (or
equivalent) into whichever environment actually issues the mount command.

**This is a new fact for the owner to weigh against the earlier protocol recommendation.** The
connectivity design document recommended SMB as the primary protocol on different grounds (stronger
least-privilege account model on most hospital NAS devices, broader vendor support) — that
reasoning is unchanged by this finding. This finding adds a **practical, host-side** consideration:
NFS would need zero new userspace package on this specific host; SMB would need one small package
install (`cifs-utils`) in whatever container/image ends up running the mount. Neither is a blocker —
installing one small package in a purpose-built backup container is routine — but it is a real,
concrete difference this investigation uncovered, not previously stated.

## 4. No mount is currently active (confirmed, not assumed)

```
docker run --rm --privileged --pid=host alpine sh -c "nsenter -t 1 -m -u -n -i cat /proc/mounts" | grep -iE "cifs|nfs"
→ (no output — zero NFS or CIFS mounts exist anywhere on this host right now)
```

This confirms the starting state is exactly what the strict safeguards require: nothing mounted,
nothing to accidentally disturb.

## 5. Safest method for an ephemeral backup container to access NAS storage

Given the findings above, the safest design (not yet implemented) is:

- **A dedicated, purpose-built backup container image** (not a stock `alpine`/`node` image reused
  from an existing service) with the needed userspace client package(s) pre-installed at **build**
  time — `cifs-utils` if SMB is used, `nfs-common`/`nfs-utils` if NFS is used (already present at the
  kernel level either way; only the chosen protocol's userspace tool needs adding to the image).
- **Run with `--cap-add=SYS_ADMIN`** (confirmed, by inspecting the live `backend` container, that no
  existing service in this stack has `CapAdd` set — `"CapAdd": null` — so this would be a
  **new, explicit, minimal** capability grant scoped to only the backup container, not something
  already broadly present that this design would be piggybacking on unnoticed).
- **Mount inside that container's own, private mount namespace** (the Docker default for any
  container), not on the Docker Desktop VM's shared host namespace — keeps the NAS mount's lifetime
  strictly tied to the backup container's own lifetime (created when the job starts, destroyed when
  it ends), matching the "on-demand, not permanently connected" requirement precisely.
- **Do not mount via a Docker named volume driver pointed at the NAS** (e.g. a `local` volume with
  `o=addr=<nas>,...` driver options) **as the primary mechanism** — that approach creates a
  longer-lived Docker-level object that could be accidentally reused or left behind between runs;
  an ephemeral container's own internal mount (removed when the container is removed) is the cleaner
  fit for "not permanently connected."

**This section describes a method, it does not implement one.** No image was built, no container
was run with elevated capabilities, nothing was mounted.

## 6. What remains unverifiable from the host side alone
- Actual throughput to a real NAS (depends on the NAS and network path — item 9 of the readiness
  checklist).
- Whether `cifs-utils`'s specific version available to this build process supports SMB3 encryption
  end-to-end with whatever the actual NAS offers — only testable once a real NAS and its SMB version
  (readiness checklist item 3) are known.

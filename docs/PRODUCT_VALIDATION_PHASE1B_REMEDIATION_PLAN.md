# Product Validation — Phase 1B: Security & Backup Remediation Planning

**Status: investigation and planning complete, strictly read-only. No fix was implemented.** No
application file, database record, Docker Compose file, NGINX config, Orthanc config, firewall
rule, container, volume, credential, or package was modified. Every item below was investigated by
reading source files, inspecting live (but unmodified) configuration, and running read-only queries
against the already-running stack. Where a check would have required a state-changing action, it is
explicitly marked **NOT TESTED** with the reason.

## 1. Executive summary

Nine items were investigated in depth, building directly on the evidence already gathered in
`docs/PRODUCT_VALIDATION_PHASE1_SYSTEM_AUDIT.md`. Two findings changed in important ways once
investigated further, and the rest were confirmed and given a concrete, reviewable design:

- **The direct Orthanc DICOMweb exposure (`/dicom-web/`) is more serious than Phase 1's framing
  suggested.** It isn't just "an unused secondary path" — it bypasses the application's `study.view`
  permission check *and* its audit logging *and* Orthanc has no concept of organisation at all, so
  anyone holding the one shared Orthanc credential can read **any organisation's** imaging data
  through it with zero audit trail. This is now treated as the single highest-priority security
  finding in this plan, ahead of F-03 and F-07.
- **The PostgreSQL "never analyzed" finding has a different, better-understood root cause than
  Phase 1 could determine from the timestamps alone.** `n_tup_ins` (Postgres's own count of rows
  inserted) for the three affected tables is itself only 3–6 — meaning almost all of their ~11,000
  combined rows predate the Postgres container's own stats-tracking epoch (the container was last
  started 2026-11-14, 4 days before this investigation). Autovacuum is correctly configured
  (`autovacuum=on`, standard 50-row + 10–20%-of-table thresholds) and is demonstrably working
  (`audit_logs` and `service_health_checks`, which *have* received real write traffic since the
  restart, both show recent `last_autoanalyze` timestamps). The fix is the same either way (a
  one-time `ANALYZE`), but the correct framing is "stale statistics from before a stats-tracking
  restart, not working autovacuum had a working autovacuum", not "autovacuum is broken."
- **F-03's SSRF surface is narrower than a typical web-SSRF finding**, because no code path ever
  makes an HTTP request to the user-supplied destination host — the only direct network action
  against it is a raw TCP connect-scan (`tcpProbe`); the actual DICOM C-ECHO/C-STORE traffic is
  issued by *Orthanc itself* (a fixed, trusted container), with the user-supplied host/port passed
  only as JSON data to Orthanc's own HTTP API. This doesn't make the gap unimportant — a TCP
  connect-scan can still fingerprint internal infrastructure, and pointing Orthanc's C-STORE SCU at
  an internal host is still a real capability-misuse risk — but it does mean the remediation design
  is DNS-resolution-and-range-checking, not the classic "block redirects / block internal HTTP
  responses from leaking" SSRF pattern (there is no redirect-following HTTP client in this path at
  all).
- **The Orthanc health-probe noise has a clean, low-risk fix already sitting in the same file.**
  The backend's `orthanc` health check already does a correct, authenticated `GET /system` HTTP
  probe against Orthanc — which, because Orthanc is a single process, already proves the DICOM
  listener is alive whenever it succeeds. The separate `dicom-cstore` check's raw TCP connect to
  port 4242 is the one causing all 5,400+ "rejected association" log lines, and provides no signal
  that the `orthanc` check doesn't already provide.
- **Backup coverage remains the most operationally urgent gap**: a concrete, five-asset backup
  architecture is proposed in §3, un-gated by any assumption about NAS availability (none is
  assumed — the design works against local disk alone, with offsite replication noted as a
  separate, later concern).

No remediation was implemented. Every proposed change below is a design for a future, separately
reviewable phase.

## 2. Finding-by-finding investigation

Original finding IDs preserved throughout, per the brief's instruction.

### F-03 — Reverse-push SSRF protection

**Root cause**: `backend/src/pacs/reverse-push.service.ts`'s `validateHost()` (lines 49–55) performs
two checks only: a character-class regex (`^[a-zA-Z0-9.\-_]+$`, which incidentally rejects every
IPv6 literal since `:` isn't in the allowed set — accidental, not intentional, protection) and a
6-item case-insensitive string denylist (`postgres`, `redis`, `backend`, `nginx`, `localhost`,
`127.0.0.1`, `::1`). No DNS resolution, no private/loopback/link-local/metadata IPv4 range check, no
IPv6 range check at all (beyond the accidental regex block), no redirect handling (not applicable —
see below), no protocol allow-list (not applicable — see below).

**Evidence**: confirmed directly by reading the function and by testing the exact regex against
`169.254.169.254` (cloud metadata — passes), `10.0.0.5` (private range — passes), and
`metadata.google.internal` (arbitrary hostname — passes). Confirmed the DTO layer
(`reverse-push.dto.ts`) adds no additional validation (`host` is only `@IsString() @IsNotEmpty()
@MaxLength(255)`).

**Actual network path, traced precisely** (this refines Phase 1's framing): `validateHost()`'s
result feeds two things — (a) `tcpProbe(host, port)`, a raw `net.Socket` connect run *from the
backend container itself* directly against the user-supplied host:port, used both for the
"Test Connection" feature and as a fast-fail before C-ECHO; and (b) `orthanc.putModality(id, aet,
host, port)` / `orthanc.echoModality(id)` / the C-STORE job — all of which are HTTP `PUT`/`POST`
calls to **Orthanc's own fixed, internal `http://orthanc:8042` API** (confirmed in
`orthanc.service.ts`), with the user-supplied host/port sent only as a JSON body field. Orthanc
itself — not the backend — is the process that actually opens a DICOM TCP connection to the
user-supplied destination. There is no HTTP client anywhere in this flow that fetches a URL built
from user input, so the classic SSRF sub-risks of "the attacker reads an internal HTTP response" or
"a redirect is followed to an unintended internal target" do not apply here. What *does* apply:
(1) the backend's own `tcpProbe` is a genuine connect-scan primitive against any resolvable
host:port reachable from the backend's network position; (2) Orthanc can be made to open a DICOM
association (C-ECHO, and — if a study is also supplied — C-STORE) against any host:port Orthanc
itself can reach, which is the same Docker network the backend is on.

**Risk**: a user holding `pacs.destination.manage` (admin-tier in every role that has it — see the
role catalogue) could configure a destination pointing at an internal service or a cloud metadata
IP, then use "Test Connection" to connect-scan it, or create a push job to have Orthanc attempt a
DICOM association against it. Genuinely gated by an admin-level permission already (not
unauthenticated), which bounds the severity, but the gap is real and worth closing as defense in
depth — especially since Orthanc itself has no further network restriction of its own outbound
DICOM connections.

### F-07 — Missing API rate limiting

**Root cause**: no `@nestjs/throttler` (or any other rate-limiting package) is installed; no
`ThrottlerModule`/`ThrottlerGuard` appears anywhere in `backend/src`; nginx's own config has no
`limit_req` zone defined either (confirmed by reading `nginx/nginx.conf` directly — no
`limit_req_zone` or `limit_req` directive present). Per-*account* lockout exists (5 failed attempts
→ 15-minute lock, confirmed in `auth.service.ts`'s `MAX_FAILED`/`LOCK_MINUTES` constants) but
nothing per-*IP* or per-source, so an attacker can still (a) exhaust the lockout against many real
usernames to deny them service, or (b) distribute attempts to avoid tripping any single account's
counter.

**Full public-endpoint inventory** (every `@Public()` route, confirmed by grep across every
controller — no route was missed): `POST /auth/login`, `POST /auth/refresh`, `GET /health`, and
`POST /ingest/orthanc-study` (shared-secret protected, called by Orthanc's own Lua script, but still
reachable and unauthenticated at the JWT layer — confirmed by a direct external request returning
401-without-secret rather than being blocked at the network layer). There is **no self-service
password-reset endpoint** — only an authenticated `change-password` (requires an existing session)
and an admin-only `users/:id/reset-password` (requires `user.manage`) — so the "forgot password /
public reset" tier the brief asks to consider separately simply doesn't exist as an attack surface
today.

### F-08 — DICOM ports bound to all host interfaces

**Root cause**: `docker-compose.yml` binds `orthanc`'s C-STORE port and `mwl-scp`'s MWL port with
`"${ORTHANC_DICOM_PORT}:4242"` / `"${MWL_PORT:-4243}:4243"` — Docker's default short-form port
syntax, which binds to `0.0.0.0` (all host interfaces) unless an explicit host IP is given. No
calling-AE allow-list is configured on either Orthanc or the MWL SCP (confirmed: Orthanc accepts
any calling AE by default unless `DicomModalities` restricts it, and no such restriction is present
in the Orthanc environment configuration; the MWL SCP's own code validates the *called* AE —
confirmed in `docker-compose.yml`'s `MWL_AET` env var being the only AE-related config — but not the
*calling* AE).

**Deployment constraint — carried forward as an open question, not newly answered here**: unlike
the web-facing ports, 4242/4243 exist specifically so physical modalities (CT/MR/ultrasound
scanners etc.) on a clinical network can reach this server directly over DICOM — they cannot
traverse nginx/HTTP. `docs/F01_TLS_OPEN_QUESTIONS.md` (question 13) already asked, and never
received an answer to, whether those modalities sit on an isolated trusted VLAN with no untrusted
hop, or might need to traverse a network boundary. **That same unanswered question governs this
finding too** — the correct host-interface restriction depends entirely on real deployment topology
this investigation has no visibility into from inside the dev stack. See §12.

### Direct Orthanc DICOMweb exposure (new emphasis this phase)

**Root cause**: `nginx/nginx.conf` defines two separate DICOMweb paths. `location /api/dicom-web/`
(line 52) routes to the backend, which enforces `@RequirePermissions(PERMISSIONS.STUDY_VIEW)` and
writes an audit-log entry on every access (confirmed directly in `dicomweb.controller.ts`).
`location /dicom-web/` (line 84) routes **directly to Orthanc's own DICOMweb plugin**
(`http://orthanc:8042/dicom-web/...`), forwarding only whatever `Authorization` header the client
already sent — gated exclusively by Orthanc's own single, shared HTTP Basic Auth credential
(`ORTHANC_USERNAME`/`ORTHANC_PASSWORD`), with **no per-user permission check and no audit log
entry**, because Orthanc has no concept of the application's users, roles, or organisations at all.

**Confirmed externally reachable**: `GET /dicom-web/studies` (no credentials) returns 401 — i.e.
the route is live, routed, and reachable from outside the Docker network, gated only by Orthanc's
credential.

**Confirmed OHIF does not use it**: `ohif/app-config.js` is configured with
`wadoRoot`/`qidoRoot`/`wadoUriRoot` all set to `/api/dicom-web` — the authenticated backend proxy —
never the direct Orthanc path. No other part of the frontend or backend references `/dicom-web/`
(the bare path) anywhere (confirmed by a full-repo search).

**Risk, precisely stated**: anyone who holds (or obtains, e.g. via the shared credential being
reused, written down, or guessed — it's a single static Basic Auth pair, not per-user) the Orthanc
credential can read **any organisation's** DICOM studies through this path, completely bypassing
the application's RBAC and org-isolation layers, and leaving no audit trail. This is a real
organisation-isolation bypass, not merely an "unused, low-risk surface" — its only mitigating factor
is that nothing in the current application actually drives traffic through it, so removing or
restricting it has zero functional cost.

### Missing Orthanc index backup / missing DICOM storage backup / missing archive storage backup

Covered together in §3 (backup architecture), since they share one proposed mechanism.

### PostgreSQL VACUUM ANALYZE requirement

See the corrected root-cause analysis in §1 and the detailed investigation in §7.

### Orthanc rejected-association health-probe messages

See §8.

## 3. Backup and recovery assessment

**Do not assume NAS availability** — this design works entirely against local disk; an offsite/NAS
copy is noted as a desirable follow-on, not a prerequisite.

### Current backup mechanism, locations, frequency, retention (as found)

| Asset | Current mechanism | Location | Frequency | Retention | Last known successful backup |
|---|---|---|---|---|---|
| RIS PostgreSQL DB (`ris`) | Manual, ad-hoc `pg_dump \| gzip`, run by hand before risky changes | `backups/*.sql.gz` (local disk, same host as live data) | None scheduled — purely manual, tied to whoever remembered to run it before a past phase's changes | None defined (5 dumps currently present, oldest and newest both from the same day) | **2026-11-14 17:06** (`ris-pre-storage-20261114-170654.sql.gz`) — **4 days stale** as of this investigation |
| Orthanc index DB (`orthanc`, same Postgres instance, separate database) | **None** | — | — | — | **Never** |
| Original DICOM storage (`orthanc_storage` volume, 327 MB) | **None** | — | — | — | **Never** |
| Archive storage (`pacs_archive` volume, 3.8 MB) | **None** | — | — | — | **Never** |
| Application configuration | One manual snapshot exists (`backups/config-20261114-151018/`: `docker-compose.yml`, `nginx.conf`, migrations, `mwl_scp.py`, Orthanc config, `app-config.js`, `env.template`) | `backups/config-20261114-151018/` (local disk) | None scheduled, one-time | None defined | 2026-11-14 15:10 |

### Database consistency requirements

The `ris` and `orthanc` databases are **independent but cross-referenced**: `studies.orthancStudyId`
and `instances.orthancId` in the `ris` database point at resource IDs that only have meaning inside
Orthanc's own index. A backup/restore of `ris` alone, without a matching-point-in-time `orthanc`
backup, can leave these references dangling (an `ris` row pointing at an Orthanc resource that no
longer exists after a partial restore, or vice versa). **The two Postgres databases should always
be dumped in the same `pg_dump` session or immediately back-to-back**, and ideally the DICOM storage
volume snapshot should be taken at the same moment too, since Orthanc's index DB and its on-disk
DICOM files must agree with each other (an index entry with no corresponding file, or a file with no
index entry, both break Orthanc). The `pacs_archive` volume is comparatively low-risk to back up
independently, since its own manifest/integrity is self-contained per archive job (confirmed by the
existing archive verification logic using a stored SHA-256 per job).

### Recovery dependencies and sequence (as the existing `docs/F05_DISASTER_RECOVERY_PLAN.md`
already documents, re-confirmed still accurate by reading it): Postgres must be restored and
healthy **before** Orthanc starts (Orthanc's `depends_on: postgres: condition: service_healthy`
already encodes this at the container level); Orthanc's index DB and its storage volume must be
restored together, not independently; the backend should not be started until both Postgres
databases are consistent, since several backend paths assume `study.orthancStudyId` resolves.

### Estimated storage requirements

At current data volume: `ris` DB dump ~1.4–2.2 MB compressed (observed range across the 5 existing
dumps); `orthanc` index DB dump — not currently measured, but given Orthanc's index is typically
small relative to the DICOM files themselves, likely well under 10 MB at this data volume;
`orthanc_storage` 327 MB (raw, not separately compressed by Orthanc — DICOM files are already
compressed where the modality sent them compressed); `pacs_archive` 3.8 MB (already compressed, per
Phase 6E/6F's own report on the archive module). **A single full backup cycle today would be on the
order of 340–350 MB** — small enough that daily full backups are entirely practical at this data
volume; this estimate should be revisited if/when the dataset grows toward real clinical volumes
(where `orthanc_storage` would dominate and incremental/differential strategies become worth
considering).

### Recovery risks (what could go wrong, read from the current gap)

1. **Total data loss on disk/volume failure** — since every backup lives on the same host as the
   live data, a single-disk failure destroys both the live system and every existing backup
   simultaneously. This is the single most urgent risk the current state leaves open.
2. **Inconsistent partial restore** — restoring `ris` from a 4-day-old dump without a matching
   Orthanc restore (which doesn't exist at all) would resurrect references to Orthanc resources that
   may have changed or been added since, producing silently broken study-detail/report pages.
3. **No tested restore path** — `docs/F05_BACKUP_RESTORE_TEST_RESULTS.md` exists and documents a
   prior disposable-prototype validation (per project memory, never promoted to a real implementation),
   meaning the *procedure* has been exercised once, but there is no evidence of a repeatable, current
   restore drill against today's actual backup artifacts (which are themselves 4 days stale).

### Proposed backup architecture (design only — not implemented this phase)

A single, scheduled job (candidate: a `@nestjs/schedule` `@Cron` job in the backend process, the
same pattern already used for `OpsScheduler`'s health checks and notification cleanup — no new
Docker service needed, consistent with this project's established "no 9th service" convention)
that, on each run, in order:

1. `pg_dump` both `ris` and `orthanc` databases, each gzip-compressed, into one timestamped,
   same-run output directory (keeping them paired, per the consistency requirement above).
2. Snapshots the `orthanc_storage` volume — at this data size, a straightforward `tar czf` of the
   volume's mount point is sufficient; at larger scale, a copy-on-write filesystem snapshot or
   Orthanc's own `/tools/create-archive` export would be worth considering, but is not necessary at
   today's 327 MB.
3. Snapshots the `pacs_archive` volume the same way.
4. Snapshots current application configuration (`docker-compose.yml`, `nginx.conf`, the Orthanc Lua
   script, `app-config.js`, `.env.example` — **never the live `.env`** with real secrets, to avoid a
   backup artifact becoming a new secrets-exposure risk) — mirroring what the one existing manual
   `config-20261114-151018/` snapshot already captured by hand.
5. Writes a manifest (timestamp, sizes, checksums of each artifact) so a future restore can verify
   it has a complete, matched set before attempting anything.
6. Prunes backups older than a configurable retention window (the same `OPS_TELEMETRY_RETENTION_DAYS`-style
   env-var pattern already used elsewhere in this codebase would fit naturally here).

Local disk is the only requirement for this design to work end-to-end. **Offsite/NAS replication**
(copying the completed backup set to a second location) is a natural, separate follow-on step once
local backups are automated and proven — not assumed or required by this design.

## 4. Orthanc DICOMweb security assessment

Summarising §2's investigation into the four questions the brief asks directly:

- **Is the route actually required?** No — confirmed no part of the application (frontend or
  backend) references the bare `/dicom-web/` path anywhere.
- **Does OHIF use it?** No — confirmed OHIF is configured exclusively against `/api/dicom-web`.
- **Does direct access bypass application controls?** Yes, completely — no `study.view` permission
  check, no audit log entry, no organisation isolation (Orthanc has no org concept at all).
- **Safest options to restrict or remove unnecessary exposure** (not implemented this phase; options
  only):
  1. **Remove the `location /dicom-web/` block from `nginx.conf` entirely.** Lowest-risk option —
     since nothing uses it, this has zero functional cost and the smallest possible config diff.
  2. If some unknown external integration is later found to genuinely need direct DICOMweb access,
     **route it through the same backend proxy** (`/api/dicom-web/`) instead of removing the
     capability — this preserves RBAC, org-isolation, and audit logging for that integration too.
  3. If removal is judged too risky without further confirmation, an interim step would be
     restricting the nginx location to specific trusted source IPs (`allow`/`deny` directives) while
     a longer observation period confirms nothing depends on it — weaker than removal, but
     reversible with less certainty needed up front.

Option 1 is the recommended design; it is deferred to the implementation roadmap in §10, not acted
on in this phase.

## 5. SSRF remediation design

Design only — no source file modified this phase.

**Principle**: validate the *resolved* IP address, not just the hostname string, and reject any
address in a private, loopback, link-local, or well-known metadata range — for both IPv4 and IPv6.
Use only Node's built-in `net`/`dns` modules (no new package required, consistent with the "do not
install packages" constraint that would otherwise apply to a future implementation phase too).

**Proposed logic** (pseudocode, for review — not a diff):

```
async function validateHost(host, port):
  # existing checks retained
  assert host matches a safe character class
  assert port is an integer in [1, 65535]

  # NEW: resolve and range-check
  addresses = await dns.lookup(host, { all: true, family: 0 })  # both A and AAAA records
  for each addr in addresses:
    if isPrivateOrReservedIPv4(addr) or isPrivateOrReservedIPv6(addr):
      reject "Destination resolves to a disallowed network range"

  # existing denylist retained as defense-in-depth (cheap, catches the obvious
  # cases even if DNS resolution is somehow bypassed or re-added later)
  assert host not in existing string denylist
```

**IPv4 ranges to reject**: `127.0.0.0/8` (loopback), `10.0.0.0/8`, `172.16.0.0/12`,
`192.168.0.0/16` (private), `169.254.0.0/16` (link-local, **includes the cloud-metadata address
169.254.169.254**), `0.0.0.0/8`, `100.64.0.0/10` (carrier-grade NAT, worth including for
completeness).

**IPv6 ranges to reject**: `::1/128` (loopback), `fc00::/7` (unique local / private), `fe80::/10`
(link-local), `::ffff:0:0/96` (IPv4-mapped — must be unwrapped and re-checked against the IPv4
rules above, otherwise it's a bypass of the IPv4 checks), `fd00::169:254::/...`-style metadata
equivalents where applicable.

**DNS resolution and rebinding risk**: resolving once at validation time and connecting later (as a
naive fix would) reopens a classic TOCTOU/DNS-rebinding gap — an attacker-controlled DNS name could
resolve to a safe IP at validation time and an internal IP at connection time. The safest design
resolves **once**, immediately before use, and passes the **resolved IP** (not the original
hostname) to both `tcpProbe` and to Orthanc's `putModality` call — this also has the side benefit of
removing a second, independent DNS lookup from Orthanc's own code path, closing the rebinding window
entirely rather than narrowing it. This is a behavior change worth flagging explicitly for review:
Orthanc's `Host` field would then receive a resolved IP rather than a hostname, which is correct for
security but should be verified against Orthanc's DICOM stack to confirm it has no hostname-specific
requirement (unlikely, but worth a reviewer's explicit sign-off before implementation).

**Redirect handling**: not applicable — confirmed in §2 that no HTTP client in this flow ever
follows a URL built from user input.

**Internal service access**: the existing 6-item denylist is retained as a cheap, explicit
belt-and-suspenders layer on top of the range-based check, not replaced by it.

**Allowed protocols**: not applicable in the usual SSRF sense — the destination is always addressed
as a DICOM TCP peer (host:port), never as a URL with a scheme, so there is no `file://`/`gopher://`-style
protocol-smuggling surface to restrict.

## 6. DICOM network restriction design

Design only — no port binding changed this phase.

**Constraint reaffirmed**: 4242 (C-STORE) and 4243 (MWL) must remain reachable from wherever actual
modalities are deployed; they cannot be closed or routed through nginx/HTTP the way the web ports
are, since DICOM is not HTTP.

**Three restriction options, in order of how much topology information each requires**:

1. **Host-interface binding** (lowest information requirement, works today): change
   `docker-compose.yml`'s port mappings from the implicit `0.0.0.0` bind to an explicit host IP —
   e.g. `"${CLINICAL_NIC_IP}:4242:4242"` — if this host has a dedicated NIC/IP on the clinical
   network, separate from its general-purpose/management IP. **Requires knowing that such a
   dedicated interface exists and which IP it has** — this investigation has no visibility into the
   deployment host's actual network interfaces from inside the dev stack, so this remains an open
   question (§12), not a value this plan can fill in.
2. **Host OS firewall rule restricting the source subnet** (works regardless of NIC topology, but
   requires knowing the clinical subnet's CIDR): e.g. only allow inbound TCP 4242/4243 from
   `10.20.30.0/24` (illustrative). This is a host-level change outside Docker's own config, so it
   is explicitly out of this phase's "do not change firewall rules" boundary — listed here as a
   design option for a future phase, not something this plan modifies.
3. **Orthanc calling-AE allow-list** (works independent of network topology, lowest coupling to
   deployment specifics): Orthanc supports a `DicomModalities` configuration restricting which
   calling AE titles are accepted; the MWL SCP's own code would need a matching allow-list added for
   the calling AE (it already validates the *called* AE, per Phase 1's finding — extending it to
   also validate *calling* AE is a contained, source-level change, distinct from any network/firewall
   change). This is the option that most directly "preserves legitimate modality connectivity" per
   the brief's explicit requirement, since it discriminates by DICOM identity rather than network
   position, and doesn't require answering the open deployment-topology question at all to be useful
   as a first layer.

**Recommendation for the roadmap**: implement option 3 first (self-contained, no topology knowledge
needed, meaningfully raises the bar even if the network itself stays open), and treat options 1/2 as
follow-on hardening once the open deployment question in §12 is answered.

## 7. PostgreSQL maintenance plan

Design only — no `VACUUM`, `ANALYZE`, or configuration change run this phase.

**Current state, precisely** (re-stated from §2's corrected root-cause analysis): `autovacuum=on`
globally; default thresholds (`autovacuum_vacuum_threshold=50`, `autovacuum_vacuum_scale_factor=0.2`,
`autovacuum_analyze_threshold=50`, `autovacuum_analyze_scale_factor=0.1`) — all standard, sensible
values, not misconfigured. `patients` (1,007 live rows, 608 kB), `studies` (5,010 live rows, 4.2 MB),
and `scheduled_orders` (5,005 live rows, 2.6 MB) each show `n_tup_ins` of only 3–6 — i.e. almost
none of their real row count has been observed as an "insert" by the current stats-tracking epoch,
which began when the Postgres container was last started (2026-11-14). `audit_logs` and
`service_health_checks`, both under continuous real write load since that same restart, both show
healthy, recent autoanalyze timestamps — direct evidence autovacuum itself is functioning correctly.

**Dead tuples**: low in absolute terms today (`scheduled_orders` 17 dead tuples against 3,005 total
operations tracked, `studies` 4 dead tuples) — not a bloat concern at this scale.

**Safe maintenance recommendation**: a single, one-time `ANALYZE patients, studies,
scheduled_orders;` (read-only in effect — `ANALYZE` only updates planner statistics, it does not
rewrite table data the way `VACUUM FULL` would, and does not take an exclusive lock) would bring the
planner's statistics in line with reality immediately. This is **not run in this phase**, per the
explicit restriction, but is flagged as the lowest-risk, highest-value first step in the roadmap
(§10) — it requires no downtime, no application change, and no schema change.

**Longer-term consideration**: since this pattern (bulk-loaded tables showing artificially low
`n_tup_ins` right after a container restart) is a predictable consequence of how Postgres tracks
statistics across restarts, a maintenance job that runs `ANALYZE` on these specific tables shortly
after every Postgres container start would prevent this specific situation from recurring after a
future restart — worth considering as part of whatever backup/maintenance scheduler gets built per
§3, since it is the same kind of "runs on a schedule, inside the backend, no new service" job.

## 8. Health-probe improvement plan

Design only — the probe itself was not modified this phase.

**Precise mechanism, confirmed from source**: `health.service.ts`'s `checkOne('orthanc')` already
performs an authenticated `GET http://orthanc:8042/system` HTTP request and treats `200` as healthy
— this is a correct, complete proof that Orthanc's entire process (including its DICOM listener,
since Orthanc is single-process) is alive and responsive. Separately, `checkOne('dicom-cstore')`
performs `tcpProbe('orthanc', 4242)` — a raw TCP connect with no DICOM handshake — purely to prove
the DICOM port specifically is open. Orthanc's DICOM listener logs **any** non-DICOM TCP connection
on that port (including a connect-then-immediately-close, which is exactly what `tcpProbe` does) as
a rejected association, which is the entire source of the 5,400+ "Association Received from an
invalid AET... rejecting the association" log lines traced in Phase 1.

**Why a separate `dicom-cstore` check exists at all** (inferred from the `SERVICES` array and the
Command Centre/System Monitoring UI, which display `dicom-cstore` as its own named tile): the intent
is almost certainly to let an operator distinguish "Orthanc's HTTP API is up but its DICOM listener
specifically has somehow failed" from "Orthanc is fully down" — a real, legitimate distinction in
principle, since Orthanc *could* theoretically have its DICOM listener fail to bind while its HTTP
server stays up (e.g. a port conflict at startup). In practice, because Orthanc binds both at
startup as part of the same initialization, this failure mode is rare, and the `orthanc` check
already catches the more common "Orthanc is down entirely" case.

**Recommended approach** (not implemented this phase): replace the raw `tcpProbe('orthanc', 4242)`
in the `dicom-cstore` case with a read of Orthanc's own `/system` response, specifically its
`DicomAet` field (already available from the exact same HTTP call the `orthanc` check already makes
— confirmed `orthanc.service.ts`'s `system()` method exists and returns this). This would let
`dicom-cstore`'s status derive from the same single, already-correct HTTP probe instead of a second,
noisy TCP connect — eliminating the log noise entirely while **improving** the signal (confirming
Orthanc reports its AE title as configured, not merely that *some* process is listening on the
port). If the two checks are considered worth keeping fully independent for operator-visible
reasons, a second, lower-noise option is to replace the raw TCP connect with a single, minimal, valid
DICOM A-ASSOCIATE-RQ/A-ABORT exchange (so Orthanc logs a normal, successful low-level association
instead of a rejected one) — more faithful to "is the DICOM listener specifically healthy," but a
larger, more DICOM-protocol-aware change than simply reusing the existing HTTP probe. **Recommendation:
the HTTP-reuse option, as the lower-risk, lower-effort fix** that fully resolves the log-noise finding.

## 9. Remediation roadmap

Each item lists exactly what the brief requires. All "Files/configurations expected to change" are
**predictions for a future implementation phase** — none of them were touched in this phase.

---

**Finding: Direct Orthanc DICOMweb exposure**
- Root cause: §2/§4.
- Evidence: `GET /dicom-web/studies` externally reachable, 401-gated by Orthanc's shared credential
  only; `nginx.conf` lines 82–93; OHIF confirmed not to use it.
- Risk: org-isolation bypass, zero audit trail, for anyone holding the shared Orthanc credential.
- Proposed correction: remove the `location /dicom-web/` block from `nginx.conf` (Option 1, §4).
- Expected file(s) to change: `nginx/nginx.conf` only.
- Dependencies: none — confirmed nothing depends on this route.
- Downtime: none (nginx config reload only; a `docker compose restart nginx` would be needed to
  apply it, which is a sub-second interruption of the single ingress point — see §11).
- Rollback: restore the previous `nginx.conf` and reload/restart nginx.
- Validation: confirm `GET /dicom-web/studies` returns a connection/404-level failure (route gone)
  while `GET /api/dicom-web/studies` continues to work correctly (with auth) and OHIF continues to
  load studies normally end-to-end.
- Clinical workflow interruption possible: only the brief nginx restart window noted above; the
  viewer path itself (`/api/dicom-web/`) is unaffected by this change.

---

**Finding: F-03 — SSRF protection**
- Root cause / evidence / risk: §2, §5.
- Proposed correction: §5's resolve-then-range-check design, applied in `validateHost()`.
- Expected file(s) to change: `backend/src/pacs/reverse-push.service.ts` only (the DTO layer needs
  no change, since validation stays in the service).
- Dependencies: none — uses only Node built-ins.
- Downtime: none (a backend code change requires a backend rebuild/redeploy, the existing
  established pattern from every prior GUI phase — brief backend restart only).
- Rollback: revert the file, rebuild, redeploy.
- Validation: a dedicated Playwright/API test attempting to register a destination at
  `169.254.169.254`, `10.0.0.1`, and `::1` should all be rejected; a legitimate external IP should
  still be accepted; the existing `reverse-push.spec.ts` suite (which already tests "destination
  SSRF protection blocks internal infra") should be extended, not replaced.
- Clinical workflow interruption possible: none for existing, legitimately-configured destinations
  (they continue to resolve to public/allowed ranges); a destination currently misconfigured to
  point at an internal/private address would start being rejected, which is the intended effect.

---

**Finding: F-07 — Missing API rate limiting**
- Root cause / evidence: §2.
- Proposed correction: add `@nestjs/throttler`, with a stricter limit on `POST /auth/login` and
  `POST /auth/refresh` (the two unauthenticated, sensitive endpoints) than on authenticated
  clinical-API traffic. Suggested starting tiers for review, not final: `/auth/login` — 5 requests
  per minute per IP (tighter than the existing 5-per-account/15-minute lockout, so the per-IP limit
  bites first against a distributed attempt); `/auth/refresh` — 20 per minute per IP (refresh happens
  automatically and more frequently in normal use); `/ingest/orthanc-study` — a generous limit (e.g.
  60/minute), since it's secret-gated and internal-triggered but still worth bounding; all other
  authenticated routes — a much higher general ceiling (e.g. 300/minute per authenticated user) sized
  to not interfere with normal worklist/reporting usage, acting mainly as abuse protection rather
  than a workflow constraint. These numbers are a starting proposal for review, not a final
  specification.
- Expected file(s) to change: `backend/package.json` (new dependency), `backend/src/app.module.ts`
  (register `ThrottlerModule`), likely a small number of controller-level `@Throttle(...)`
  overrides on `auth.controller.ts` specifically.
- Dependencies: new npm package — explicitly flagged, since "do not install packages" applies to
  this phase but necessarily not to the implementation phase that follows it.
- Downtime: none beyond the standard backend rebuild/redeploy.
- Rollback: revert the files, remove the dependency, rebuild, redeploy.
- Validation: confirm normal clinical usage (worklist polling, dashboard refresh, reporting
  worklist) stays well under the general ceiling in practice (worth a brief manual load check, not
  just a unit test); confirm a rapid-fire login-attempt test now gets throttled (429) before the
  existing 5-attempt account lockout would even trigger.
- Clinical workflow interruption possible: only if a limit is set too low for real usage patterns —
  mitigated by sizing the general ceiling generously and validating against actual observed
  traffic before rollout, not guessing.

---

**Finding: F-08 — DICOM ports bound to all host interfaces**
- Root cause / evidence: §2, §6.
- Proposed correction: implement §6's Option 3 (Orthanc + MWL calling-AE allow-list) first, since it
  requires no deployment-topology information; defer Options 1/2 (interface/firewall restriction)
  until the open question in §12 is answered.
- Expected file(s) to change: `docker-compose.yml` (Orthanc `DicomModalities`/equivalent
  environment config), `mwl-scp/mwl_scp.py` (add calling-AE validation alongside the existing
  called-AE check).
- Dependencies: requires knowing the real calling AE titles of legitimate modalities — not available
  from inside this dev stack; would need to come from whoever manages the real deployment.
- Downtime: a brief Orthanc/`mwl-scp` restart to apply.
- Rollback: revert the config/code, restart the two services.
- Validation: confirm a known-good calling AE can still complete C-ECHO/MWL C-FIND; confirm an
  unlisted calling AE is now rejected (this can be tested entirely within the existing Docker network
  using a second throwaway test client, without touching the real host firewall or network).
- Clinical workflow interruption possible: yes, if a legitimate modality's calling AE is omitted
  from the allow-list by mistake — mitigated by validating the complete, correct list with whoever
  manages the real modality fleet before rollout, not guessing it.

---

**Finding: PostgreSQL maintenance (ANALYZE)**
- Root cause / evidence: §2, §7 (corrected framing: stale stats from a restart, not broken
  autovacuum).
- Proposed correction: one-time `ANALYZE patients, studies, scheduled_orders;`.
- Expected file(s) to change: none (a one-time operational command, not a code change) — optionally,
  a small addition to whatever backup/maintenance scheduler is built per §3, to run this
  automatically after a Postgres restart in the future.
- Dependencies: none.
- Downtime: none — `ANALYZE` (without `FULL`) takes only a brief read lock, does not block normal
  reads/writes.
- Rollback: not applicable — `ANALYZE` only updates statistics, it cannot corrupt or lose data.
- Validation: re-run the same `pg_stat_user_tables` query from Phase 1/this phase and confirm
  `n_live_tup` now matches the real `COUNT(*)` for all three tables.
- Clinical workflow interruption possible: none.

---

**Finding: Orthanc health-probe noise**
- Root cause / evidence: §2, §8.
- Proposed correction: §8's recommendation — derive `dicom-cstore` status from the existing
  `orthanc` HTTP `/system` probe's `DicomAet` field instead of a separate raw TCP connect.
- Expected file(s) to change: `backend/src/ops/health.service.ts` only.
- Dependencies: none.
- Downtime: none beyond the standard backend rebuild/redeploy.
- Rollback: revert the file, rebuild, redeploy.
- Validation: confirm the Command Centre / System Monitoring UI still shows `dicom-cstore` as a
  distinct tile with correct HEALTHY/DOWN status; confirm Orthanc's log stops accumulating new
  "rejected association" lines after the fix is deployed (observe over at least a few
  60-second cycles).
- Clinical workflow interruption possible: none — this is a monitoring-only change.

---

**Finding: Backup architecture (RIS DB, Orthanc index DB, DICOM storage, archive storage)**
- Root cause / evidence: §2, §3.
- Proposed correction: §3's scheduled, in-backend-process, five-asset backup job.
- Expected file(s) to change: a new backend module (e.g.
  `backend/src/ops/backup.scheduler.ts`, following the existing `*.scheduler.ts` convention),
  `backend/src/app.module.ts` (register it), new environment variables for schedule/retention,
  likely a new `backups/` subdirectory structure for the paired/manifested output described in §3.
- Dependencies: sufficient local disk headroom for the retention window chosen (at ~350 MB per
  full cycle today, even a 30-day daily retention is well under 11 GB — not a concern at current
  scale).
- Downtime: none — the backup job runs without stopping any service (standard `pg_dump` against a
  live database, standard volume read for the `tar` step).
- Rollback: disable/remove the scheduled job; existing manual backup practice continues unaffected.
- Validation: a full restore drill against a disposable copy of the stack (never the live one) —
  exactly the kind of exercise `docs/F05_BACKUP_RESTORE_TEST_RESULTS.md` already describes having
  been done once as a prototype; this would need repeating against the new automated artifacts
  specifically.
- Clinical workflow interruption possible: none during normal operation; a future *restore* (not
  covered by this phase) would necessarily involve downtime, sequenced per §3's dependency order.

---

## 10. Prioritized implementation roadmap

Ordered by a combination of risk reduction and implementation cost/risk — independently reviewable
phases, each small enough to review and roll back on its own:

1. **Remove the direct `/dicom-web/` nginx exposure** — smallest possible change (one config
   block), closes the single most serious finding in this plan (an org-isolation bypass with zero
   audit trail), zero functional cost since nothing uses it.
2. **One-time `ANALYZE`** on the three affected tables — smallest possible change (one SQL
   statement, no code), zero risk, immediate planner-accuracy benefit.
3. **Orthanc health-probe fix** — small, self-contained, eliminates ongoing log noise with no
   functional risk.
4. **SSRF hardening (F-03)** — moderate-sized, self-contained backend change, no dependency on
   unanswered deployment questions.
5. **API rate limiting (F-07)** — moderate-sized, needs the limit values validated against real
   traffic patterns before rollout, but otherwise self-contained.
6. **Automated backup architecture** — the largest single piece of new functionality in this
   roadmap; highest operational value (closes the single most urgent *data-loss* risk, as opposed to
   the access-control risks above), but also the most implementation work and the one most worth
   its own dedicated review phase.
7. **DICOM calling-AE allow-list (F-08, Option 3)** — blocked on obtaining the real list of
   legitimate calling AE titles from whoever manages the modality fleet; can be designed and coded
   ahead of that answer but shouldn't be rolled out until validated against it.
8. **Host-interface/firewall restriction (F-08, Options 1/2)** — blocked on the open deployment-topology
   question in §12; not actionable until that's answered.

Items 1–5 have no blocking dependency on information this investigation couldn't obtain, and could
be sequenced as a single Phase 2 implementation effort if desired. Items 6–8 either need more design
work (6) or external information this investigation cannot supply (7, 8).

## 11. Downtime and rollback considerations

Summarised from each finding's entry in §9: only three of the seven proposed changes require even a
brief service restart (the nginx removal, the SSRF fix's backend redeploy, the rate-limiter's
backend redeploy, and the health-probe fix's backend redeploy — all standard, sub-minute
rebuild/redeploy cycles consistent with every prior GUI phase in this project's history, not a new
kind of risk). The `ANALYZE` fix and the backup-architecture rollout both require zero downtime by
design. The two DICOM-network-restriction options are the only items in this plan with a genuine
clinical-workflow-interruption risk (a misconfigured calling-AE allow-list or an over-narrow
interface binding could block a real modality) — both are explicitly flagged as requiring validation
against real deployment information before rollout, not estimated or guessed.

## 12. Unresolved questions

Carried forward, not newly resolved by this investigation (none of these can be answered from
inside the dev stack):

1. **Does this host have a dedicated network interface for the clinical/modality network, separate
   from its general-purpose/management interface?** Governs whether DICOM port host-interface
   binding (§6, Option 1) is even possible, and if so, which IP to bind to. (Same open question
   already on record in `docs/F01_TLS_OPEN_QUESTIONS.md`, question 13 — still unanswered.)
2. **What is the real clinical network's subnet/CIDR**, if a host-firewall restriction (§6, Option
   2) is later pursued instead of or alongside the interface-binding option?
3. **What are the real calling AE titles of the modalities that will connect to this system?**
   Required before the calling-AE allow-list (§6, Option 3 / roadmap item 7) can be safely rolled
   out — implementing it with a guessed or incomplete list risks blocking a legitimate modality.
4. **Is there any other system, inside or outside this Docker network, that currently relies on the
   direct `/dicom-web/` route** that this investigation's full-repo search could not see (e.g. an
   external tool, a manual integration, or a future planned consumer)? The investigation found zero
   evidence of one, but cannot prove a negative for something entirely outside this codebase.
5. **What rate-limit values would genuinely not interfere with real clinical traffic patterns?**
   The tiers proposed in §9 are a reasoned starting point, not measured against real production
   usage, since this environment has only synthetic/test traffic to observe.
6. **Is there a maintenance-window process for this application**, or can changes like the nginx
   removal and the two backend redeploys in this roadmap happen at any time? (Same open question
   already on record in `docs/F01_TLS_OPEN_QUESTIONS.md`, question 15 — still unanswered, and
   directly relevant to sequencing the roadmap in §10.)

## 13. Confirmation: no files, configurations, databases, or services were modified

- **Application files**: zero modified. Every file referenced in this report (`reverse-push.service.ts`,
  `health.service.ts`, `nginx.conf`, `docker-compose.yml`, `auth.service.ts`, `auth.controller.ts`,
  `ingest.controller.ts`, `dicomweb.controller.ts`, `orthanc.service.ts`, `app-config.js`, and
  others) was opened with a read tool only.
- **Database**: zero `VACUUM`, `ANALYZE`, `INSERT`, `UPDATE`, `DELETE`, or configuration-changing
  statement was executed. Every database interaction in this phase was a `SELECT` or a `SHOW`
  (read-only) statement.
- **Docker Compose / NGINX / Orthanc**: zero configuration files modified.
- **Firewall rules**: none inspected via live firewall tooling and none modified — the "firewall
  rule restriction" discussed in §6 is a design option for a future phase, not an action taken here.
- **Containers**: zero restarted during this investigation (the two external `curl` requests made to
  confirm the `/dicom-web/` route's reachability and the one earlier `/api/ingest/orthanc-study`
  check are read-only `GET`/unauthenticated `POST` probes against the already-running stack, not a
  restart or configuration action).
- **Volumes**: zero deleted, reset, or modified.
- **Backups/restores**: none initiated.
- **DICOM files**: none transferred, copied, deleted, or modified; no clinical data was touched.
- **Credentials**: none changed.
- **Packages**: none installed — every design in this report that would require a new package (only
  F-07's `@nestjs/throttler`) is explicitly flagged as a future-phase dependency, not installed now.

---

Stopping here per the stop condition. This is a planning document only — no remediation was
implemented. Awaiting approval before any implementation phase begins.

# RIS + PACS — All-in-One Install Guide

This guide is for hospital IT staff installing the system, not developers.
For the developer/dev-setup stack, see the project's own `docker-compose.yml`
instead — that remains unchanged and is unaffected by anything in this
folder.

## What this is

Everything the system needs — image storage (PACS), the DICOM worklist, the
web application, and the image viewer — runs inside **one application
container** (`rispacs`). The patient/order database runs in a **second,
dedicated container** (`postgres`), the same official Postgres image this
project has always used. You manage both with a single `docker compose up -d`
command, one configuration file, and one data folder.

Why two containers instead of one: Postgres's own upgrade path (`docker pull`
→ restart) is far safer when its data isn't entangled with the application's
own release cycle, and keeping it on the stock `postgres:16-alpine` image
(rather than rebuilding Postgres into a different base OS) means an existing
database can be moved over with a simple file copy, not a riskier logical
dump/restore — see "Migrating" below.

## Server requirements

- A Linux server with **Docker Engine** installed (Docker Desktop on Windows
  works for testing, but has two real limitations for production use):
  - Docker Desktop requires a user to stay logged in to the Windows machine
    for the Docker service to keep running — not suitable for a server that
    reboots unattended.
  - On Windows, modality devices on your hospital network reach the
    container through Docker's NAT layer, which hides their real IP address
    from the application. This affects troubleshooting (you won't see a
    modality's actual IP in logs) but does not affect whether C-STORE/C-FIND
    works.
- **CPU**: 2 cores minimum, 4+ recommended. This single container runs 5
  processes concurrently (web app, DICOM server, worklist server, cache,
  web server) plus a separate Postgres container.
- **RAM**: 4 GB minimum, 8 GB recommended for a department with regular CT/MR
  volume (Orthanc and Postgres both benefit from more memory for caching).
- **Disk — sizing for DICOM storage**: budget roughly 5–10 MB per CR/DX image,
  100–500 MB per CT study, and 50–300 MB per MR study (varies with slice
  count and compression). A department doing 20 CT studies/day at ~250 MB
  average needs roughly 5 GB/day, or ~150 GB/month, before considering
  retention policy. Add headroom for: the Postgres database (typically small,
  under 1 GB even at tens of thousands of studies), the nightly backup folder
  (`/data/backups` — holds full database dumps plus a DICOM storage archive,
  so budget at least as much free space again as your current `/data/dicom`
  size), and logs (capped at ~50 MB per service, see "Viewing logs"). As a
  starting point: **50 GB minimum for a small clinic doing a handful of
  studies a day; 500 GB–1 TB+ for an active imaging department**, and plan to
  monitor and grow the `/data` volume over time rather than guessing once.
- Ports 80, 4242, and 4243 available (see "Open the firewall" below).

## Install steps

1. **Get the `deploy/allinone/` folder** onto the server (it contains
   `docker-compose.yml`, the example config files, and the operations
   scripts).
2. **Copy the example configuration files**:
   ```
   cd deploy/allinone
   cp rispacs.ini.example rispacs.ini
   cp db_password.txt.example db_password.txt
   ```
3. **Edit `rispacs.ini`.** At minimum, change every value marked
   `CHANGE ME`:
   - `server.public_host` — the IP address or hostname your staff and
     modalities will use to reach this server (e.g. `192.168.1.50`).
   - `admin.seed_password`, `services_ui.password`, `orthanc.password` — set
     these to real, unique values. The container refuses to start if any of
     these are left as `change-me`.
4. **Edit `db_password.txt`** — a single line, the database password. This is
   a separate file (not inside `rispacs.ini`) because the same file is handed
   to both the `postgres` container (`POSTGRES_PASSWORD_FILE`) and the
   `rispacs` container, so the password only ever needs to be set in one
   place and the two containers are guaranteed to agree on it.
5. **Load the image** (if installing offline from a `.tar.gz` file — see
   `build-release.sh`):
   ```
   gunzip -c rispacs-1.0.0.tar.gz | docker load
   ```
6. **Start both containers**:
   ```
   docker compose up -d
   ```
7. **Open the firewall** for ports 80 (web application), 4242 (DICOM
   C-STORE, used by modalities to send images), and 4243 (DICOM Modality
   Worklist, used by modalities to look up scheduled patients). Port 5432
   (Postgres) is NOT exposed outside the two containers by default.
8. Wait about a minute for first-boot database setup, then browse to
   `http://<public_host>/` and log in with the `admin.seed_username` /
   `admin.seed_password` you set in step 3.

## Configuring a modality (CT, X-ray, etc.)

Give the modality's DICOM configuration screen:
- **Called AE Title**: the value of `dicom.ae_title` in `rispacs.ini`
  (default `RISPACS`) for sending images (C-STORE, port 4242), and
  `mwl.ae_title` (default `RISMWL`) for querying the worklist (C-FIND,
  port 4243).
- **Server IP**: `server.public_host`.
- **Port**: `4242` for image send, `4243` for worklist query.

**Test the connection with C-ECHO** before relying on it for real studies.
Most modalities have a "Verify"/"Echo" button in their DICOM network setup
screen that does exactly this — point it at the server IP, port 4242, and
the AE title above, and confirm it reports success. If your modality doesn't
have a built-in test, or you want to test from a PC on the same network
using the free DCMTK tools:
```
echoscu -aet YOURSCU -aec RISPACS <server-ip> 4242
```
A successful test prints "Received Echo Response (Success)". If it fails,
see "Troubleshooting" below.

## Checking status

```
docker exec rispacs-rispacs-1 supervisorctl status
```
or use the bundled script:
```
./scripts/status.sh rispacs
```
This shows every internal service's state (`RUNNING`, `STOPPED`, `FATAL`,
etc.), the container's overall health, disk usage, and recent backups. The
same information is also available inside the application's own **System
Monitoring** page (it queries this through a backend API endpoint —
`GET /api/system/process-status` — that talks to supervisord's status API;
this only works inside the all-in-one image, not the dev Compose stack).

You can also reach supervisord's own web UI at `http://<public_host>/admin/services/`,
protected by the `services_ui` username/password from `rispacs.ini`.

## Viewing logs

Every service's logs are under `/data/logs/` on the host (via the `/data`
bind mount): `backend.log`, `postgres.log`, `orthanc.log`, `mwl-scp.log`,
`nginx.log`, `redis.log`, and `supervisord.log`. Each is capped at 10 MB with
5 rotated backups, so they can't fill the disk unbounded.

## Backing up

The backend already runs an automated nightly backup (database dumps +
a DICOM storage archive) — see `backup.sh`, which does not run a second,
competing backup system. It simply confirms the backend process is running
and shows you what's already in `/data/backups`.

**Important**: `/data/backups` holds point-in-time snapshots taken once a
night, not continuous protection. `/data/dicom` (the live DICOM image store)
should also be backed up separately at the file level on whatever schedule
your hospital's backup policy requires, since the nightly `DICOM_STORAGE`
backup component is itself just a periodic snapshot, not real-time
replication.

## Restoring

```
./scripts/restore.sh rispacs-postgres-1 rispacs-rispacs-1 ris_db-2026-11-18T02-00-00-000Z.sql.gz
```
This is interactive and destructive — it asks you to re-type the filename to
confirm before touching anything.

## Upgrading

Set `RISPACS_VERSION` in your shell (or in a `.env` file next to
`docker-compose.yml`) to the new version, then:
```
export RISPACS_VERSION=<new-version>
docker compose pull
docker compose up -d
```
`docker compose up -d` only recreates a container whose image actually
changed — **Postgres is only restarted when the `postgres:16-alpine` image
itself changes** (rare; you control this independently by not changing that
pin), so a routine `rispacs` application upgrade does not interrupt the
database. All your data and configuration live outside both containers (in
`data/` and `rispacs.ini`/`db_password.txt`), so recreating either container
is safe — nothing is lost. The new `rispacs` container's first boot applies
any new database migrations automatically.

`docker compose down` stops `rispacs` before `postgres` (Compose always
stops services in reverse dependency order, and `rispacs` depends on
`postgres`), so the application never loses its database connection
mid-shutdown; `postgres`'s `stop_grace_period` of 60s then gives it time to
shut down cleanly without corruption.

## Release process

This image is built by the repo's `Jenkinsfile`, which tracks two branches:

- **`dev`** — day-to-day work. Every push builds a dev/release-candidate
  image (tagged as an RC), runs the backend tests, smoke test, and (unless
  skipped) the Sonar/Trivy scans. Nothing on `dev` is tagged as a release.
- **`main`** — releases only. `dev` is merged into `main` only when it's
  ready to ship. A build on `main` additionally creates the next `vX.Y.Z`
  git tag and publishes the production `rispacs` image under that tag (plus
  the offline bundle, if requested).

In short: **work on `dev` → Jenkins builds a dev/RC image → merge `dev` into
`main` only for a release → Jenkins creates `vX.Y.Z` and the production
image.**

## Migrating from the developer docker-compose.yml stack

If you (or your vendor) previously ran this system via the project's root
`docker-compose.yml` and now want to move to this all-in-one deployment, use
`scripts/migrate-from-compose.sh <old-compose-dir> <new-deploy-allinone-dir>`.

By default it copies the Postgres data directory directly (a plain file
copy) rather than a logical `pg_dump`/`psql` round-trip. This is safe
**specifically because** both the old stack's `postgres` service and this
deployment's `postgres` service use the exact same `postgres:16-alpine`
image — there is no musl/glibc text-sorting (collation) mismatch to worry
about, since neither side ever changed Postgres's base image. The script
still checks the old volume's `PG_VERSION` is `16` before copying, requires
the old stack to be stopped for the copy itself (captures row counts first,
while briefly starting just the old `postgres` service, then stops it before
copying), and never modifies or deletes the old volume — it remains a
fallback.

If you ever need to move data between two **different** Postgres images or
major versions, pass `--use-dump` instead, which uses `pg_dump`/`psql` (a
portable logical copy, safe across any image boundary, but slower and
requiring the schema to already match on the destination).

Either way, DICOM images are always copied as plain files (no collation
concern applies to files), and the script compares patient/order/study row
counts and Orthanc's own study/instance counts before and after so you can
confirm nothing was lost.

**Rolling back a migration**: the script never modifies or deletes anything
in the old Compose stack's volumes — it only reads from them. If the
row-count comparison shows a mismatch, or anything looks wrong in the new
deployment once you've checked it, the safe rollback is simply:
1. `docker compose down` in the new `deploy/allinone/` deployment (stops it,
   leaves its `data/` folder in place for later investigation — don't delete
   it, in case you need to see what went wrong).
2. Resume operating the old Compose stack exactly as before — nothing about
   it was changed, so there is nothing to undo there.
3. Investigate the mismatch (check `migrate-from-compose.sh`'s own output
   for which counts differed) before attempting the migration again.

## Why this Orthanc version

The image pins `orthancteam/orthanc:25.12.3` rather than `latest` (the dev
Compose stack's current choice, which is a moving target). This tag was
chosen because it was the most recent stable, numbered release at the time
this image was built, with the plain (non-`-full`) variant matching what the
dev stack already relies on: the PostgreSQL index/storage, DICOMweb, and
Worklists plugins, confirmed present in this tag. Update this pin
deliberately in a future release after testing, not automatically.

## Known behaviour

- **A Postgres restart briefly rejects incoming studies.** If the `postgres`
  container restarts (a host reboot, an update, a manual restart) while
  `rispacs` keeps running, the application recovers on its own — no action
  needed. In practice, during the roughly 10 seconds it takes Orthanc to
  re-establish its own database connection pool after Postgres comes back,
  an incoming C-STORE can be rejected with "Out of Resources." Modalities
  normally queue and automatically retry a rejected send, but **check the
  modality's send queue / job list after any Postgres restart** to confirm
  nothing was left stuck, and resend manually if it was. MWL queries and the
  web application itself recover essentially immediately (well under this
  window), so this specifically affects image transfer in that narrow
  reconnect period.

## Troubleshooting

- **"port is already in use"**: another process on the host is already using
  80, 4242, or 4243. Stop it, or change the host-side port mapping in
  `docker-compose.yml`'s `rispacs.ports` section (the in-container ports
  stay the same).
- **Postgres restarted and the application looks broken**: it should
  self-recover — `wait-for-postgres.sh` and each supervised program's
  `autorestart=true` are designed to reconnect automatically once Postgres
  is reachable again, without needing the `rispacs` container itself
  restarted. If a service seems stuck anyway, check its own `.err.log`
  under `/data/logs/` for the specific error.
- **C-ECHO/C-STORE failing from a modality**: confirm the modality's
  configured AE title exactly matches `dicom.ae_title` in `rispacs.ini`, and
  that port 4242 is open in the server's firewall. Check `/data/logs/orthanc.log`
  for the specific rejection reason.
- **Viewer (OHIF) shows a blank page**: check the browser's developer console
  for a failed request to `/api/dicom-web/`. This usually means the backend
  isn't healthy yet — check `docker exec rispacs-rispacs-1 supervisorctl status backend`.
- **Database not starting / container unhealthy on first boot**: check
  `/data/logs/postgres.err.log`. The most common cause is `/data` being
  owned by the wrong user on the host filesystem — the container adjusts
  ownership on first boot, but an unusual host filesystem (e.g. certain
  network mounts) can prevent this.
- **Supervisord shows a service as `FATAL`**: it crashed more times than its
  configured retry limit. Check that service's own `.err.log` under
  `/data/logs/` for the actual error, then
  `docker exec rispacs-rispacs-1 supervisorctl start <service>` once the underlying
  problem is fixed.
- **Browser console shows CORS errors** ("blocked by CORS policy") when
  loading the web app: `server.public_host` in `rispacs.ini` doesn't match
  the address staff actually use in their browser. CORS is derived
  automatically from `public_host` + `http_port`, so if staff reach the
  server at a hostname (e.g. `pacs.hospital.local`) while `public_host` is
  set to an IP (or vice versa), the browser's origin won't match what the
  backend allows. Fix: either set `public_host` to the address staff
  actually use, or add it to `server.extra_origins` (comma-separated, for
  supporting both an IP and a hostname at once), then restart
  `docker compose restart rispacs`.

## Security checklist before go-live

Work through this before putting the system in front of real patients or
real network traffic:

- [ ] **Every default/example password has been changed.** Specifically:
      `admin.seed_password`, `services_ui.password`, `orthanc.password` in
      `rispacs.ini`, and the database password in `db_password.txt`. None of
      these should still read `change-me` — the container refuses to start
      if the ones it validates are left at that value, but double-check all
      of them regardless (`seed_password` and `db_password.txt` in
      particular are only checked for presence, not re-validated after the
      very first boot).
- [ ] **`/admin/services/` (the supervisord web UI) is protected** by a real
      `services_ui.password`, not the example value, and is only reachable
      through the firewall rules you've set — it is not separately exposed
      on its own port, but confirm your network doesn't route around nginx
      to port 9001 some other way.
- [ ] **Only ports 80, 4242, and 4243 are reachable from outside the
      server.** Postgres (5432), Orthanc's internal HTTP port (8042), and
      the backend (3000) are bound to `127.0.0.1` inside the container by
      design and are never published to the host — confirm this wasn't
      changed in `docker-compose.yml`.
- [ ] **HTTPS is not yet built in.** This deployment currently serves plain
      HTTP only. If the server is reachable over a network you don't fully
      control physically (not just a private VLAN), put a reverse proxy or
      load balancer with a real TLS certificate in front of port 80 before
      go-live — do not expose this system directly over HTTP across an
      untrusted or internet-facing network.
- [ ] **Backups have been tested, not just scheduled.** Confirm at least
      once that `/data/backups` actually contains recent, non-empty backup
      files (see "Checking status"), and — ideally in a throwaway test
      environment, not against live data — that `restore.sh` actually works
      against one of them. A backup that has never been test-restored is an
      unverified assumption, not a safety net.
- [ ] **`server.public_host` and `server.extra_origins` are set correctly**
      for exactly the addresses staff will actually use (see the CORS
      troubleshooting entry below) — this is a safety check as much as a
      functionality one, since a CORS misconfiguration that's "fixed" by
      overly broad origins is a real exposure.

## Known limitations

- There is currently no "run a backup right now" API — the nightly backup
  runs on the schedule configured in `rispacs.ini`'s `[backup]` section
  (default 02:00). `backup.sh` reports status; it does not trigger an
  out-of-schedule run.
- Horizontal scaling (running more than one instance of this image against
  shared storage) is not supported. Every internal lock (job scheduling,
  session tracking) assumes a single backend process.

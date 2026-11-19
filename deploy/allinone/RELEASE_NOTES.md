# RIS + PACS All-in-One — Release Notes

## Version 1.0.1

### DICOM connectivity fixes (Modality Devices "Test Connection" + reverse-push)

Follows directly from the investigation in
`docs/DICOM_CONNECTIVITY_ROOT_CAUSE_ANALYSIS.md`. All five fixes recommended in
that report's §8, applied:

1. **Modality Devices "Test Connection" now performs a real DICOM C-ECHO.**
   Previously a TCP-only stub (its own code comment admitted the real DICOM
   check was never implemented) paired with a frontend that read response
   field names the backend never returned — the UI always showed the literal
   word "unreachable" no matter what actually happened. It now does a TCP
   reachability check, then a genuine Orthanc-native C-ECHO, and reports one
   of six specific, real outcomes (success with response time; TCP
   unreachable; TCP timeout; association rejected with Orthanc's own reason;
   echo timeout; other echo error).
2. **`OrthancService.putModality()` now sends `LocalAet`.** Previously every
   modality registered through either the Modality Devices test or the
   reverse-push (PACS Destinations) feature silently used Orthanc's
   server-wide default Calling AE — a destination's configured `callingAet`
   was stored and shown in the UI but never actually sent to Orthanc. Fixed
   for both features.
3. **Orthanc REST error responses are no longer discarded.** The shared
   Orthanc request helper now reads and logs the full response body on any
   failed call (never logging credentials), so a real DICOM-level rejection
   reason is visible in logs and surfaced to the UI instead of only an HTTP
   status code.
4. **Temporary test modality registrations always clean up.** The
   reverse-push destination test previously only deregistered its temporary
   Orthanc modality entry on the success path — a `try`/`finally` now
   guarantees cleanup even when the test itself fails, so a failed test can
   no longer leave a stray entry in Orthanc's `/modalities`.
5. One further item from the investigation (the health monitor's periodic
   raw-TCP probe to Orthanc's DICOM port, which produces harmless but
   recurring "blank Calling AE" log noise) was deliberately **not** changed —
   out of scope for this fix series and carries more risk than benefit to
   touch alongside these changes; see the Work Log for the full reasoning.

**Testing**: added unit coverage for the new `testConnection` outcome
contract (6 new tests); full backend suite 48/48 passing across all 11
suites; `tsc --noEmit` clean.

**Safety**: per the fix brief, testing against the real Pivotal PACS used
C-ECHO only — no C-STORE/C-MOVE was ever sent, and no study was transferred.
No database schema change was required.

## Version 1.0.0 (first release)

### What's included

A single application image (`rispacs`), paired with a standard `postgres`
container, replacing the multi-container developer `docker-compose.yml`
stack for production/hospital deployment:

- **`rispacs` image**: backend (NestJS), frontend (React SPA), OHIF viewer,
  Orthanc (DICOM server, pinned `orthancteam/orthanc:25.12.3`), mwl-scp
  (DICOM Modality Worklist SCP), Redis, and nginx — all supervised by
  `supervisord` inside one container.
- **`postgres` container**: the same `postgres:16-alpine` image the
  developer stack already uses, run as a dedicated sibling container so its
  data and upgrade cycle stay independent of the application's.
- **One configuration file** (`rispacs.ini`) covering server identity, DICOM
  AE titles/ports, the admin seed account, the supervisord web UI, Orthanc
  credentials, and nightly backup settings.
- **One data folder** (`data/`) holding everything that must survive a
  container upgrade: Postgres's data directory, DICOM storage, the
  compressed study archive, nightly backups, logs, and generated
  config/secrets.
- **Operational scripts**: `backup.sh`, `restore.sh`, `migrate-from-compose.sh`
  (moves data from the developer stack), `status.sh`, and `build-release.sh`.
- **Reused, not duplicated**: the nightly backup feature is the backend's
  own existing scheduled job (Product Validation Phase 1D) — this release
  does not introduce a second backup system. Database migrations and the
  admin-account seed reuse the backend's existing, already-idempotent
  `docker-entrypoint.sh` unchanged.

### Bugs fixed during Phase 4 testing

All seven were found by actually running the system end-to-end (DICOM
C-ECHO/C-STORE, MWL C-FIND, login, a Postgres-restart recovery test, and a
real migration against a copy of production-shaped data), not by code
review alone:

1. **Seed step failed with "DATABASE_URL not found."** Plain `node` doesn't
   auto-load `.env` files; only the Prisma CLI does. Fixed by exporting the
   generated config into the real process environment before starting the
   backend.
2. **Backend crashed outright** on an early fix attempt (a cron expression
   value broke when the config file was shell-sourced instead of parsed as
   plain key/value data). Fixed with an explicit, shell-evaluation-free
   parser.
3. **Redis never started** — `redis-server` was missing from the image's
   package list entirely. Added.
4. **Orthanc failed to start** ("port 8042 already in use") — an internal
   naming collision meant nginx's public port and Orthanc's internal port
   briefly shared one variable, so nginx was misconfigured to also try
   binding Orthanc's port. Fixed by giving Orthanc's port its own,
   correctly-namespaced variable.
5. **Modality Worklist queries were rejected** ("Called AE Title Not
   Recognized") because the worklist service silently kept its built-in
   default AE title instead of the one configured in `rispacs.ini` — same
   root cause as #1/#2, a different service. Fixed the same way.
6. **The migration script misreported Postgres's version as unreadable**,
   even when it was readable, specifically when run from a Windows/Git Bash
   environment (a path-mangling quirk of that shell). Fixed by wrapping the
   affected commands so the path resolves correctly inside the container
   regardless of host OS/shell.
7. **The migration script could start under the wrong, non-isolated project
   name** in some invocation paths. Fixed by letting Docker Compose's own
   `-p`/`COMPOSE_PROJECT_NAME` override work as designed.

### Known limitations

- **No on-demand backup trigger.** The nightly backup runs on its configured
  schedule only; there is currently no API or script to force an
  out-of-schedule run. `backup.sh` reports status, it doesn't trigger one.
- **No horizontal scaling.** This image assumes a single running instance —
  internal locks (scheduled job coordination, session handling) are not
  designed for multiple replicas sharing the same data.
- **HTTPS is not built in.** The image serves plain HTTP. A TLS-terminating
  reverse proxy in front of it is required before any deployment reachable
  over an untrusted network — see the README's security checklist.
- **A brief C-STORE rejection window after a Postgres restart.** Roughly 10
  seconds while Orthanc's own database connection pool reconnects; MWL and
  the web app recover faster. See the README's "Known behaviour" section —
  this is expected, self-recovering behavior, not a defect, but it's worth
  knowing about operationally (check a modality's send queue after any
  Postgres restart).
- **Image size has not yet been optimized** (2.34 GB as of this release).
  A follow-up pass could realistically trim an estimated 300–500 MB,
  concentrated in the OHIF viewer bundle and the base Orthanc image's own
  dependencies — deferred as a separate task, not part of this release.

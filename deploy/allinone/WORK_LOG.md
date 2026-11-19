# Work Log

## 2026-11-18 16:56 IST — Phase 4 testing (all-in-one container)

### 1. What I did

Ran the full Phase 4 test suite (10 tests from the brief, plus test #11 —
Postgres-only restart resilience) against the `rispacs` all-in-one
application image + sibling `postgres` container, under an isolated Compose
project (`-p rispacs-test`), separate data folder (`test-data/`), and
non-default host ports (8080/14242/14243), per the mandatory isolation
rules. Found and fixed 5 real bugs along the way (see §4). All 11 tests
pass. Cleaned up the `rispacs-test` project afterward; the dev
`pacs-replica` stack was never stopped, restarted, or modified.

### 2. Files changed

- `deploy/allinone/scripts/run-backend.sh` — **NEW**. Exports `backend.env`
  into the real process environment (as `KEY=VALUE` lines, not shell-
  sourced) before calling `docker-entrypoint.sh`, so the Prisma CLI/seed
  script/Node app all see `DATABASE_URL` etc. the same way Compose's
  `env_file:` already provides them in the dev stack.
- `deploy/allinone/scripts/run-mwl-scp.sh` — rewrote to use the same
  explicit-export loop instead of a bare `source`, which only set shell-
  local variables invisible to the Python subprocess.
- `deploy/allinone/entrypoint.sh` — fixed a variable-name collision:
  `HTTP_PORT` was used for both nginx's public port (from `rispacs.ini`)
  and, later, Orthanc's internal port — the second assignment silently
  overwrote the first, so nginx was misconfigured to also try binding
  Orthanc's port. Renamed Orthanc's to `ORTHANC__HTTP_PORT`.
- `deploy/allinone/scripts/migrate-from-compose.sh` — wrapped three
  `docker run ... alpine <cmd> /path>` invocations in `sh -c "..."`; on
  Windows/Git Bash, a bare absolute path argument gets silently mangled
  into a Windows path before reaching the container.
- `deploy/allinone/docker-compose.yml` — removed the hard-coded top-level
  `name: rispacs` so `docker compose -p <name>` (required by the isolation
  rules, and by any real-world migration run alongside another instance)
  actually takes effect instead of being overridden.
- `Dockerfile.allinone` — added `redis-server` to the apt install list (it
  was missing entirely — `redis` was crash-looping with "command not
  found"); added `COPY`/`chmod` for `run-backend.sh`.
- `orthanc/on-stored.lua` — added error logging to the previously-silent
  `pcall` around `HttpPost`, so a future ingest failure is visible in
  Orthanc's log instead of vanishing. (This file is shared with the dev
  Compose stack too — the change is a strict improvement there as well,
  zero behavior change on success.)

### 3. Important / risky changes

- Removing `name: rispacs` from `docker-compose.yml` changes the **default**
  container/network names for a normal (non-`-p`) `docker compose up -d` —
  they now derive from the directory name (`allinone`) instead of the fixed
  `rispacs`. This only matters if something external already hard-codes the
  old `rispacs-postgres-1`/`rispacs-rispacs-1` names; nothing in this repo
  does. Documented nowhere else — flagging here.
- `run-backend.sh`/`run-mwl-scp.sh` parse `backend.env`/`mwl-scp.env` as
  plain `KEY=VALUE` lines (split on the *first* `=` only) rather than
  shell-sourcing them. This is deliberate and safer (values with spaces,
  `*`, or `=` in them — e.g. a cron expression or a password containing
  `=` — are passed through literally instead of being shell-evaluated), but
  it means a future `.env`-style file with multi-line values would not
  work with this loader. Not a current need; noted for awareness.

### 4. Problems found → cause → fix

| # | Problem | Cause | Fix |
|---|---|---|---|
| 1 | Login failed with "DATABASE_URL not found" from the seed step only (migrations ran fine) | Plain `node dist/prisma/seed.js` doesn't auto-load `.env` the way Prisma's CLI does; supervisord doesn't inject the generated `backend.env` into the process environment on its own | `run-backend.sh` exports the file's contents into the real environment first |
| 2 | Backend crashed entirely (`FATAL`), log showed `backend.env: line 31: 2: command not found` | `run-backend.sh`'s first attempt used `source backend.env`, which shell-*executes* the file; `BACKUP_CRON=0 2 * * *` is valid dotenv but not valid shell (unquoted spaces/`*`) | Rewrote as an explicit `KEY=VALUE` parse+export loop, no shell evaluation of values |
| 3 | `redis` program permanently `FATAL`, log: `can't find command 'redis-server'` | `redis-server` was never added to the apt install list in `Dockerfile.allinone` | Added `redis-server` to the package list |
| 4 | Orthanc crash-looping, log: `TCP port ... already in use (port 8042)` | `entrypoint.sh` reused the variable name `HTTP_PORT` for both nginx's public port and Orthanc's internal port; the second `export` silently clobbered the first, so nginx was rendered with `listen 8042` too | Renamed Orthanc's variable to `ORTHANC__HTTP_PORT` |
| 5 | MWL C-FIND rejected: "Called AE Title Not Recognized", `mwl-scp.log` showed it started with the default `GGHMWL` instead of the configured `RISMWL` | Same class of bug as #1/#2 — `run-mwl-scp.sh` originally used bare `source`, which never exported anything into the Python subprocess's environment | Same export-loop fix as `run-backend.sh` |
| 6 | `migrate-from-compose.sh`'s `PG_VERSION` check failed with "unreadable" even though the file genuinely contained `16` | On Windows/Git Bash, `docker run --rm -v vol:/src:ro alpine cat /src/PG_VERSION` has its bare `/src/PG_VERSION` argument silently path-mangled before reaching the container | Wrapped the three affected `docker run` calls in `alpine sh -c "..."` |
| 7 | Test #9 initially failed at the final `docker compose up -d` step with a port-80 conflict, then started under the wrong (default) project name | Isolation rules require `-p rispacs-test`-style naming, but the compose file had `name: rispacs` hard-coded, which overrides `-p`/`COMPOSE_PROJECT_NAME` | Removed the hard-coded `name:` key |

All 7 were found, fixed, and the affected test re-run to confirm the fix
before moving on — nothing above is still open.

### 5. Commands run + pass/fail

| # | Test | Command (abridged) | Key output | Result |
|---|---|---|---|---|
| 1 | Services RUNNING, container healthy | `docker compose -p rispacs-test ps` + `docker exec ... supervisorctl status` | 5/5 `RUNNING`, both containers `healthy` | ✅ PASS |
| 2 | Web UI loads, login works | `curl .../`, `curl -X POST .../api/auth/login` | `HTTP 200`; real `accessToken` returned | ✅ PASS |
| 3 | DICOM C-ECHO | `echoscu -aet TESTSCU -aec RISPACS 127.0.0.1 4242` | "Received Echo Response (Success)", exit 0 | ✅ PASS |
| 4 | C-STORE + worklist + OHIF | `storescu ...` (2 synthetic pynetdicom test files) + `GET /api/pacs/reconciliation/unmatched` + `GET /viewer/` | Both studies visible via API (`CompressedSamples CT1`/`MR1`); OHIF `HTTP 200` | ✅ PASS |
| 5 | MWL C-FIND returns a real order | created patient+order via API, then `findscu -aec RISMWL ... -k 0008,0050=<accession>` | Full matching record returned (name, MRN, accession, modality, procedure) | ✅ PASS |
| 6 | Kill backend → auto-restart | `kill -9 $(pgrep -f main.js)` | New PID within ~14s, login works again | ✅ PASS |
| 7 | Data survives stop/start and remove/recreate | `docker stop/start`, then `docker rm -f` + `compose up -d` | Patient/order/orphan-study data intact both times | ✅ PASS |
| 8 | Change AE title + restart → new AE used | edited `rispacs.ini`, `compose restart rispacs` | `orthanc.json`'s `DicomAet` = new value | ✅ PASS |
| 9 | `migrate-from-compose.sh` against a **copy** of dev volumes | ran full script against `migration-test-source_{pg_data,orthanc_storage}` (copies) into a throwaway target | `patients=1007 orders=5005 studies=5010 orthanc-studies=10 orthanc-instances=2489` — source and destination **identical** | ✅ PASS |
| 10 | Image size + 5 largest layers | `docker images`, `docker history --no-trunc \| sort -rh` | **2.34 GB** total; see §6 for the breakdown | ✅ PASS (report only) |
| 11 | Restart only `postgres`; app self-recovers | `docker restart rispacs-test-postgres-1` (rispacs container never touched) | `rispacs` container uptime continuous throughout; MWL C-FIND and login worked immediately after; C-STORE needed ~10s extra for Orthanc's own DB pool to reconnect (first attempt got "OutOfResources", retry succeeded) | ✅ PASS (noted the ~10s reconnect window) |

**11/11 PASS.**

### 6. Image size (report only, not optimized)

Total: **2.34 GB**. Five largest layers:

1. **310 MB** — `npm ci --omit=dev && npx prisma generate` (backend production deps + Prisma engine). Estimated savings: modest (~20–40 MB) by pruning Prisma's unused engine binaries for platforms never used, or switching to `npm ci --omit=dev --omit=optional`.
2. **277 MB** — the base `orthancteam/orthanc` image's own Python/Boost/GDCM/plugin dependencies. Not under our control (comes from the pinned upstream image); switching to a `-thin`/non-`-full` variant if one ever ships, or trimming unused Orthanc plugins post-install, could save some of this but risks removing something in use.
3. **214 MB** — the built OHIF static bundle. Estimated savings: potentially significant (OHIF ships many optional extensions/modes we don't use — e.g., segmentation, TMTV — a custom OHIF build excluding unused extensions could plausibly cut this by 30–50%, but requires an OHIF build-config change and re-validation of the viewer).
4. **208 MB** — the apt install layer (curl, supervisor, nginx, dcmtk, procps, redis-server, PGDG client). Estimated savings: small (~10–20 MB) by dropping `dcmtk`'s full install in favor of only the specific binaries used (`echoscu`/`storescu`/`findscu`/`dcmdump` are test/debug tools, not required at runtime by the app itself — though useful for operators troubleshooting on the server).
5. **127 MB** — the copied Node.js runtime binary + npm. Estimated savings: small (~5–10 MB) by copying only `node` and the specific `npm`/`npx` files actually needed rather than the entire `node_modules/npm` package tree.

Realistic total optimization potential: roughly **300–500 MB** (13–21%),
concentrated in the OHIF bundle and Orthanc's own dependencies — neither
trivial, both deferred per the brief ("report only, don't optimize yet").

### 7. Not done yet / open questions

- Test #11's ~10-second Orthanc-DB-reconnect window after a Postgres
  restart is not a failure, but it's worth deciding whether a slightly
  longer `startsecs`/retry tolerance for Orthanc — or just documenting the
  window in the README's troubleshooting section — is wanted. Not changed
  without direction.
- Image-size optimization itself (Phase 6? or part of Phase 5 docs) is
  explicitly deferred per this phase's instructions — only estimated above,
  nothing changed.
- `deploy/allinone/README.md` has not yet been updated with the Test #11
  Postgres-restart-resilience behavior or the reconnect-window note; can
  fold that in alongside Phase 5 documentation work if wanted.

### 8. Next step / waiting for approval

Stopping here per the brief's instruction. The `rispacs-test` Compose
project has been torn down (`docker compose -p rispacs-test down`); its
`test-data/` folder and test-only `rispacs.ini`/`db_password.txt` files
were deleted. **The dev `pacs-replica` stack was not touched at any point**
— confirmed before, during, and after testing (uptimes continuous
throughout). Waiting for your OK before Phase 5 (documentation).

## 2026-11-18 17:10 IST — Fix 0 + Phase 5 (documentation and release)

### 1. What I did

Fixed the `name:` vs `-p` concern raised before Phase 5 started (restored
`name: rispacs`, verified Compose's precedence rules with `docker compose
-p rispacs-test config` — confirmed `-p` correctly overrides the file-level
`name:`, `COMPOSE_PROJECT_NAME` is next, the file default is last), then
fixed three leftover bare/stale container-name references in the README and
two scripts that no longer matched the restored name. Rewrote
`deploy/allinone/README.md` for hospital IT (added CPU/RAM/disk sizing
guidance, a C-ECHO modality-test walkthrough, a "Known behaviour" section
for the Postgres-restart reconnect window, a CORS troubleshooting entry, a
migration rollback procedure, and a pre-go-live security checklist).
Rewrote `build-release.sh` to also produce a SHA256 checksum and a release
zip bundling the install folder (compose file, example configs, README,
scripts), ran it once for version `1.0.0`, and verified both the zip's
integrity and its checksum. Wrote `deploy/allinone/RELEASE_NOTES.md`
covering what's included, the 7 bugs fixed in Phase 4, and known
limitations. Cleaned up the build artifact (`dist/`) afterward.

### 2. Files changed

- `deploy/allinone/docker-compose.yml` — restored `name: rispacs` (was
  removed in Phase 4 on a mistaken assumption; `-p`/`COMPOSE_PROJECT_NAME`
  already take priority over it, verified below).
- `deploy/allinone/README.md` — restored correct container names
  (`rispacs-rispacs-1`, not bare `rispacs`) in 3 places; added the sizing,
  C-ECHO test, known-behaviour, CORS, rollback, and security-checklist
  content described above.
- `deploy/allinone/scripts/status.sh`, `deploy/allinone/scripts/backup.sh`
  — fixed their default container-name argument (`${1:-rispacs}` →
  `${1:-rispacs-rispacs-1}`) to match the restored naming.
- `deploy/allinone/build-release.sh` — rewrote: added SHA256 checksum
  generation and a release-zip step (bundling `docker-compose.yml`,
  `rispacs.ini.example`, `db_password.txt.example`, `README.md`,
  `RELEASE_NOTES.md`, and `scripts/`); falls back to `7z` if `zip` isn't
  installed (this host has no `zip`; a real Linux hospital server normally
  does).
- `deploy/allinone/RELEASE_NOTES.md` — **NEW**.

### 3. Important / risky changes

None. The `name:` restoration is a correction back to the brief's own
instruction, not a new risk; everything else is additive documentation or
an additive release-packaging step.

### 4. Problems found → cause → fix

| # | Problem | Cause | Fix |
|---|---|---|---|
| 1 | After restoring `name: rispacs`, 3 README lines and 2 scripts' default container-name arguments still read bare `rispacs` or were otherwise stale from the Phase-4-era removal | Those references were updated for the (incorrect) no-`name:` state during Phase 4 and never reverted together with the `name:` removal | Updated all 5 to `rispacs-rispacs-1`, matching the restored `name: rispacs` + service name `rispacs` |
| 2 | `build-release.sh`'s zip step would fail outright on this host | No `zip` binary installed here (Windows/Git Bash) | Added a `7z` fallback (prints a clear message and leaves an unzipped release folder if neither tool exists) |

### 5. Commands run + pass/fail

| Command | Purpose | Result |
|---|---|---|
| `docker compose -p rispacs-test config \| grep '^name:'` | Verify `-p` overrides `name:` | `name: rispacs-test` — ✅ confirmed |
| `COMPOSE_PROJECT_NAME=rispacs-test-env docker compose config \| grep '^name:'` | Verify `COMPOSE_PROJECT_NAME` fallback | `name: rispacs-test-env` — ✅ confirmed |
| `docker compose config \| grep '^name:'` (neither set) | Verify file-level default | `name: rispacs` — ✅ confirmed |
| `bash deploy/allinone/build-release.sh 1.0.0 --release` | Build, tag, save, checksum, bundle, zip | Image built (2.34 GB), `.tar.gz` + `.sha256` + zip all created — ✅ PASS |
| `7z t rispacs-1.0.0-release.zip` | Zip integrity check | "Everything is Ok" — ✅ PASS |
| `sha256sum -c rispacs-1.0.0.tar.gz.sha256` | Checksum verification | "rispacs-1.0.0.tar.gz: OK" — ✅ PASS |
| `docker compose ps` (root project) | Confirm dev stack untouched throughout | All 8 services unchanged/healthy — ✅ confirmed |

### 6. Not done yet / open questions

- Image-size optimization — explicitly out of scope for this task, per the
  brief.
- The release zip/tar/checksum produced during this verification run were
  deleted afterward (`dist/` is a build artifact, not meant to be
  committed) — re-run `build-release.sh 1.0.0 --release` whenever an actual
  distributable is needed.

### 7. Next step / waiting for approval

Stopping here. The dev `pacs-replica` stack was not touched at any point.
Waiting for review of the README changes, `RELEASE_NOTES.md`, and the
release-build output before any further phase.

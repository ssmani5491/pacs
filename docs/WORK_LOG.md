# Work Log — docs/

## 2026-11-18 17:12 IST — DICOM connectivity root cause investigation (GG PACS Replica ↔ Pivotal PACS)

### 1. What I did

Investigated why the app reports "Connection to Old_Pacs failed: unreachable" for
the Pivotal PACS modality. Traced the full source-code path from the frontend
Modalities admin page through two backend endpoints to Orthanc, ran the approved
read-only Orthanc REST checks, inspected Docker networking and logs, checked the
host's subnet configuration, and — with explicit approval obtained mid-investigation
— temporarily registered Pivotal as an Orthanc modality to run one real, live DICOM
C-ECHO test, then deleted the registration immediately afterward. Wrote the findings
to `docs/DICOM_CONNECTIVITY_ROOT_CAUSE_ANALYSIS.md`. No fix was implemented, per the
brief's explicit "investigation only" instruction.

**Headline finding**: the reported symptom has nothing to do with Pivotal, the
network, or any DICOM-level problem — it's a frontend/backend field-name mismatch in
an unfinished (TCP-only, never-actually-DICOM) test stub for the *Modality Devices*
feature, which is the feature `Old_Pacs` happens to be registered under. A live
C-ECHO to Pivotal through Orthanc's real DICOM SCU, run during this investigation,
succeeded immediately with no rejection or timeout. A second, genuinely real bug
(`LocalAet` never sent to Orthanc) was also found, in a different, currently-unused
code path (the reverse-push / PACS Destinations feature).

### 2. Files read

- `backend/src/orthanc/orthanc.service.ts` (full)
- `backend/src/pacs/reverse-push.service.ts` (destination CRUD + `testDestination`,
  lines 1–140)
- `backend/src/pacs/reverse-push.controller.ts` (relevant route)
- `backend/src/modalities/modalities.controller.ts` (full)
- `backend/src/modalities/modalities.service.ts` (`testConnection`, lines 66–80)
- `frontend/src/pages/admin/Modalities.tsx` (`testConnection` handler, lines 70–89)
- `frontend/src/pages/ReversePush.tsx` (`testDest` handler and related, lines 30–54,
  118)
- `backend/src/ops/health.service.ts` (full)
- `backend/prisma/schema.prisma` (`ModalityDevice` model, lines 202–222)

### 3. Commands run + results

All read-only; see the report's §5 for full output. Summary:

| Command | Result |
|---|---|
| `docker network inspect pacs-replica_pacs` | `172.22.0.6` = `pacs-replica-backend-1` |
| `docker compose logs orthanc --since 2m` | Recurring "invalid AET (blank)" rejection from `172.22.0.6`, exactly 60s apart |
| `GET /system` (via `wget` inside `backend`) | `DicomAet: "GGHPACS"`, `DicomPort: 4242`, `Version: "1.13.0"` |
| `GET /modalities?expand` (before test) | One entry, `revpush_b6099c1d`, `"LocalAet": ""` |
| Read-only DB query: `modality_devices` / `pacs_destinations` | Confirmed `Old_Pacs` (Pivotal) is a `ModalityDevice` row, not a `PacsDestination` row |
| **Approved**: `PUT /modalities/investigation_pivotal` → `POST .../echo` → `DELETE` | `PUT 200`, `ECHO 200` (body `{}`, i.e. success), `DELETE 200` — real DICOM C-ECHO to Pivotal succeeded live |
| `docker compose logs orthanc` (post-test window) | No rejection/timeout for the test attempt; only the unrelated recurring health-check noise |
| TCP connect test to `172.16.7.82:11112` from `backend` (Node `net.Socket`) | `TCP connect OK` |
| `Get-NetIPAddress` / `ipconfig /all` (host) | `172.16.4.255`, mask `255.255.252.0` (/22) — a valid host address, not a broadcast address (that would only be true for a /24) |
| `GET /modalities?expand` (after test, verification) | Back to exactly the pre-test single entry — confirmed net-zero change |
| `docker compose ps` (before and after) | All 8 dev-stack services unchanged/healthy throughout |

### 4. Confirmed vs. unconfirmed findings

**Confirmed, with direct evidence:**
- Root cause of the "unreachable" text: `Modalities.tsx:85` reads `res?.ok`/
  `res?.message`, but the backend returns `{ reachable, detail }` — the displayed
  string is a hard-coded fallback, not a real error report.
- `ModalitiesService.testConnection` never performs any DICOM operation (TCP-only;
  the code's own comment confirms this was deliberately left unfinished).
- `OrthancService.putModality` never sends `LocalAet`; a live Orthanc modality entry
  confirms `"LocalAet": ""`; Orthanc's own default `DicomAet` (`GGHPACS`) is used
  instead for every destination registered through the reverse-push feature.
- `OrthancService.req()` discards the HTTP response body on any error, keeping only
  the status code.
- `172.22.0.6` (source of the blank-Calling-AE Orthanc log lines) is the backend
  container, and the specific source is `HealthService`'s scheduled `dicom-cstore`
  TCP probe (`health.service.ts:76-78`), not the Modalities test or the reverse-push
  TCP probe.
- `172.16.4.255` is a valid host address on the host's actual `/22` subnet, not a
  broadcast address.
- A real, live DICOM C-ECHO from this environment to Pivotal PACS succeeds today.

**Unconfirmed / needs the Pivotal side** (see the report's closing "Questions for
the Pivotal side" and §7 row 4):
- Whether Pivotal's acceptance of this test reflects a deliberate allow-all
  configuration, an explicit allowlist entry already covering
  `GGHPACS`/`172.16.4.255`, or no caller restriction at all for C-ECHO specifically
  (as opposed to C-STORE, which some PACS gate more strictly).
- Whether Pivotal's own listener log shows a corresponding inbound association at
  the same timestamp — this report's "works" conclusion rests on Orthanc's own
  report of success only, not independent confirmation from Pivotal's side.

### 5. Questions for me (the user) — repeated from the report for visibility

1. Is Calling AE `GGHPACS`, from IP `172.16.4.255`, registered or allowed in
   Pivotal's accepted-caller configuration?
2. Does Pivotal accept C-ECHO (Verification SOP Class) from callers not
   pre-registered?
3. Please check Pivotal's listener log around **2026-11-18 11:40 UTC** for a
   corresponding inbound association, to corroborate (or contradict) this
   investigation's "the DICOM path currently works" conclusion from the Pivotal
   side.

### 6. Next step / waiting for approval

Investigation complete; report delivered at
`docs/DICOM_CONNECTIVITY_ROOT_CAUSE_ANALYSIS.md`. No fix was implemented, per the
brief. Waiting for: (a) answers to the three questions above, and (b) direction on
whether/which of the five recommended fixes in the report's §8 to proceed with in a
future phase.

**Confirmation**: no source code file, configuration file, database record, DICOM
study, or running service was changed during this investigation. The one Orthanc
modality registration created for the approved live test
(`investigation_pivotal`) was deleted immediately after the test completed, and
`GET /modalities?expand` was used both before and after to confirm Orthanc's state
is byte-for-byte identical to its pre-investigation baseline. All 8 dev-stack
containers' uptimes were unchanged throughout, confirming none were restarted.

## 2026-11-19 10:50 IST — Implement §8 fixes (DICOM connectivity)

### 1. What I did

Also initialized this project as a git repository (it had none before), made
an initial commit of the existing codebase, and pushed it to
`github.com/ssmani5491/pacs` — explicitly confirmed with the user first.
Implemented all four source-code fixes from
`docs/DICOM_CONNECTIVITY_ROOT_CAUSE_ANALYSIS.md` §8, each as its own commit:
(1) real two-step Modality Devices "Test Connection" (TCP + Orthanc C-ECHO)
with correct, specific frontend result display; (2) `LocalAet` now sent to
Orthanc from the destination's configured `callingAet`, for both the
Modality Devices and reverse-push features; (3) Orthanc's HTTP error
response body is now captured and logged instead of discarded; (4) the
reverse-push destination test now always deregisters its temporary Orthanc
modality entry via `try`/`finally`, even on failure. Fixed a pre-existing
unit test that would have broken from the new required constructor
parameter, and added 4 new tests covering the real `testConnection`
behavior. Ran the full backend unit suite and a TypeScript compile check —
both clean. Updated `RELEASE_NOTES.md` to document all of this as version
1.0.1.

**Docker Desktop was not running for a significant part of this session**
(the daemon connection failed partway through, and remained down through
the end of this work session despite checking repeatedly) — this blocked
the live UI/API tests (a)-(e) from the brief and the all-in-one image
rebuild portion of test (f). Everything achievable without a running
container (source changes, 5 commits, unit tests, `tsc --noEmit`) is done
and verified; the Docker-dependent tests are listed as BLOCKED below, not
fabricated.

### 2. Files changed

- `.gitignore` — added `deploy/allinone/db_password.txt`,
  `deploy/allinone/rispacs.ini`, `deploy/allinone/data/`,
  `deploy/allinone/test-data/`, `dist/`.
- `backend/src/orthanc/orthanc.service.ts` — `req()` now captures/logs the
  error response body; `putModality()` accepts an optional `localAet`
  parameter and sends `LocalAet`; `echoModality()` reports elapsed time and
  a classified failure reason.
- `backend/src/modalities/modalities.service.ts` — `testConnection()`
  rewritten: real TCP + Orthanc C-ECHO two-step test, `try`/`finally`
  cleanup, six specific outcome values (new exported
  `ModalityTestResult` interface).
- `backend/src/modalities/modalities.service.spec.ts` — fixed the broken
  2-argument constructor call; added 4 new tests for `testConnection`.
- `backend/src/pacs/reverse-push.service.ts` — both `putModality()` call
  sites now pass `callingAet`/`dest.callingAet`; `testDestination()`'s
  Orthanc calls wrapped in `try`/`finally` for guaranteed cleanup.
- `frontend/src/pages/admin/Modalities.tsx` — `testConnection()` reads the
  backend's actual response shape and displays the real outcome via a new
  `describeTestResult()` helper; removed the outdated "TCP probe; C-ECHO
  arrives in Phase 4" help text.
- `deploy/allinone/RELEASE_NOTES.md` — added version 1.0.1 section.

### 3. Important / risky changes

None of the four fixes change a database schema, delete/rename an existing
API field relied on elsewhere (checked: nothing else referenced the old
`{ reachable, detail }` / `{ ok, message }` shapes), or touch anything
outside the Modality/PACS-destination test paths. The `OrthancService`
method signature changes (`putModality`, `echoModality`) are additive
(new optional trailing parameters / richer return objects) — every existing
caller still compiles and behaves the same when the new parameter is
omitted.

### 4. Problems found → cause → fix

| # | Problem | Cause | Fix |
|---|---|---|---|
| 1 | The existing `modalities.service.spec.ts` would have broken | It constructed `ModalitiesService` with only 2 arguments; the fix added a required 3rd (`OrthancService`) | Updated the test file's constructor call and added an `OrthancService` mock |
| 2 | My first version of a new TCP-failure test asserted the wrong outcome | `192.0.2.1` (TEST-NET-1) silently drops packets rather than actively refusing the connection on this network, so the probe reaches its own timeout (`TCP_TIMEOUT`) rather than an immediate `TCP_UNREACHABLE` — my test's expectation was wrong, not the code | Changed the assertion to accept either specific TCP-failure outcome, since the real thing under test (never calling Orthanc, never showing the old hard-coded string) holds either way |
| 3 | `tsc --noEmit` initially showed 8 errors, all `Property 'backupRun' does not exist on type 'PrismaService'` | Pre-existing, unrelated to this fix series: the host's local `node_modules/@prisma/client` was generated before the `BackupRun` model (added in an earlier, unrelated phase) and was simply stale — confirmed the model exists in `schema.prisma` | Ran `prisma generate` locally (schema-read-only, no database touched) to refresh the host's generated client; `tsc --noEmit` is now fully clean |
| 4 | `npm test`/`npm run test` failed with `'jest' is not recognized`, in both Git Bash and PowerShell | A PATH-resolution quirk between the global `npm`/`node` install and this project's local `node_modules/.bin` on this host — unrelated to the code changes | Invoked `node node_modules/jest/bin/jest.js` directly, bypassing the broken `npm`-script PATH resolution |

### 5. Commands run + pass/fail

| Command | Purpose | Result |
|---|---|---|
| `git init` / `git add -A` / `git commit` (initial) | Create the repo's first commit (explicitly approved by the user) | ✅ `9de97c9` |
| `git remote add origin ...` / `git push -u origin main` | Push to GitHub (explicitly approved by the user) | ✅ pushed |
| 5 × `git commit` (one per fix + the test fix) | Separate commit per fix, as requested | ✅ `62ccf5b`, `2f5dd1b`, `b0ee893`, `8293252`, `580145f` |
| `git push origin main` (×2, after the fix commits and after the release-notes commit) | Push all work | ✅ both succeeded |
| `node node_modules/jest/bin/jest.js modalities.service.spec.ts` | Unit tests for the changed file | ✅ 6/6 passing (after fixing my own flaky assertion) |
| `node node_modules/jest/bin/jest.js` (full suite) | Full backend regression | ✅ 48/48 passing, 11/11 suites |
| `node node_modules/prisma/build/index.js generate` | Refresh stale local Prisma client (schema-read-only) | ✅ succeeded |
| `node node_modules/typescript/bin/tsc --noEmit` | Type-check the backend | ✅ clean, 0 errors |
| ESLint check | brief asked for "lint" | **N/A** — no `.eslintrc`/`eslint.config.*` exists in this project; `tsc --noEmit` is the closest equivalent static check available, and it's clean |
| `docker ps` (checked repeatedly throughout) | Confirm Docker availability for live tests + image rebuild | ❌ Docker Desktop daemon unreachable every time it was checked |
| Tests (a)-(e) from the brief (UI test, fake-destination test, custom-`callingAet` test, leftover-entry check, reverse-push regression) | Live verification against running containers | **BLOCKED** — Docker Desktop was down; not run, not fabricated |
| `docker build -f Dockerfile.allinone -t rispacs:test .` | Confirm the all-in-one image still builds | **BLOCKED** — same reason |

### 6. Not done yet / open questions

- **Tests (a) through (e) and the image-rebuild half of (f) are blocked on
  Docker Desktop being down.** All source-level work (the 4 fixes + their
  unit tests + `tsc --noEmit`) is complete and verified; only the
  live-container verification and the all-in-one rebuild remain.
- Per the brief's own instruction, item 5 (remaining §8 items) was assessed
  and the one candidate found — `HealthService`'s periodic raw-TCP probe to
  Orthanc's DICOM port, the actual source of the recurring "blank Calling
  AE" log lines identified in the investigation — was **deliberately left
  unchanged**. Reasoning: it's a separate, already-functioning system health
  monitor unrelated to the Modality/PACS-destination test paths this brief
  is about, it runs on a 60-second schedule feeding alerting/health-history
  across the whole system, and changing it carries more operational risk
  than the cosmetic log noise it produces currently justifies within the
  scope of this fix series.

### 7. Next step / waiting for approval

**Please start Docker Desktop** so I can run tests (a)-(e) and the
all-in-one image rebuild, and report real results for those. Once Docker is
back: I will (a) start the dev stack, log in, and test the `Old_Pacs`
modality's "Test Connection" button expecting a real C-ECHO success
message with response time; (b) test a fake/unused destination and confirm
a specific, non-"unreachable" failure message; (c) create or use a
`PacsDestination`/`ModalityDevice` test case with a custom `callingAet` and
confirm `GET /modalities?expand` shows it as `LocalAet` during the test,
then confirm cleanup; (d) confirm `/modalities?expand` has no leftover
entries after all tests; (e) confirm the existing reverse-push C-ECHO test
still works; and rebuild `rispacs:test` to confirm the all-in-one image
still builds with these changes. All of the above is otherwise ready to
run — I am only waiting on Docker.

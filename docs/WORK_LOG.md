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

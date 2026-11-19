# DICOM Connectivity Root Cause Analysis — GG PACS Replica ↔ Pivotal PACS

**Status: investigation only. No source code, configuration, database record, DICOM
data, or running service was modified.** One temporary Orthanc modality registration
was created and deleted during testing, as explicitly approved (see §3 and §5) — net
effect is zero persistent change, confirmed by a before/after `/modalities?expand` read.

## 1. Executive summary

**The real DICOM path from this environment to Pivotal PACS currently works.** A live
test — registering Pivotal temporarily in Orthanc and issuing a real C-ECHO through
Orthanc's own DICOM SCU — returned **HTTP 200** with no error, and Orthanc's log shows
no rejection or timeout for that attempt. TCP connectivity, the host subnet, and the
Docker NAT path were all independently confirmed healthy.

**The "Connection to Old_Pacs failed: unreachable" message the user sees comes from a
different, unfinished code path that never talks to Orthanc or performs any DICOM
operation at all.** Pivotal PACS is registered in this application as a
`ModalityDevice` row (name `Old_Pacs`), tested via the **Modalities admin page**,
whose backend endpoint (`ModalitiesController.testConnection` →
`ModalitiesService.testConnection`) is a raw TCP-socket probe — its own code comment
reads `"(DICOM C-ECHO in Phase 4)"`, confirming it was intentionally left as a stub.
That TCP probe's result fields (`reachable`, `detail`) don't match what the frontend
reads (`ok`, `message`), so the frontend's `res?.message ?? 'unreachable'` fallback
fires on every single test, regardless of whether the TCP connection actually
succeeded, timed out, or failed for any other reason. **The displayed text is a
hard-coded frontend default, not a report of a real connectivity failure.**

A second, genuinely real but separate bug was also found and confirmed: Orthanc's
native C-STORE/C-ECHO SCU client (`OrthancService.putModality`) never sends a
`LocalAet`, so every modality registered through the *other* PACS-destination
feature (reverse push) gets an empty `LocalAet` in Orthanc, and Orthanc silently
falls back to its own server-wide `DicomAet` (`GGHPACS`) as the outgoing Calling AE
for every destination — confirmed directly against Orthanc's `/modalities?expand`
output. This does not affect the `Old_Pacs`/Modalities page scenario at all (that
path never reaches Orthanc), but it is a real latent defect in the reverse-push
feature that would prevent per-destination Calling AE customization if a hospital
PACS ever required a specific registered Calling AE different from Orthanc's own
`GGHPACS` default.

## 2. Existing architecture

Two separate, independently-coded "test a remote PACS" features exist in this
application, registering to two different database tables:

| Feature | Admin page | DB table | Controller → Service | How it tests connectivity |
|---|---|---|---|---|
| **Modality Devices** (inbound: scanners sending TO this PACS) | `/admin/modalities` (`frontend/src/pages/admin/Modalities.tsx`) | `modality_devices` | `ModalitiesController.test` → `ModalitiesService.testConnection` | Raw TCP socket connect only — **no DICOM protocol** |
| **PACS Destinations** (outbound: this PACS pushing studies OUT, "reverse push") | `/pacs/operations/reverse-push` (`frontend/src/pages/ReversePush.tsx`) | `pacs_destinations` | `ReversePushController` → `ReversePushService.testDestination` | Real: TCP pre-check, then registers the destination in Orthanc and issues a genuine Orthanc-native DICOM C-ECHO |

`Old_Pacs` (Pivotal PACS) is stored as a **`modality_devices`** row, confirmed by a
direct, read-only database query (§5) — meaning the user's test is going through the
first (TCP-only, non-DICOM) path, not the second (real DICOM) path.

A third, independent raw TCP probe also exists, inside `HealthService`
(`backend/src/ops/health.service.ts`), run automatically every 60 seconds by the
background scheduler as part of general system health monitoring. It probes
`orthanc:4242` directly (Orthanc's own DICOM listening port) with a bare
`net.Socket.connect()` — this is the actual, continuous source of the blank-Calling-AE
association log lines (§5, §6).

## 3. Methodology

- Read every file named in the brief in full: `OrthancService`, `reverse-push.service.ts`,
  `ModalitiesController`/`ModalitiesService`, `Modalities.tsx`, `ReversePush.tsx`,
  `health.service.ts`, the Prisma schema's `ModalityDevice`/`PacsDestination` models.
- Ran the exact read-only Orthanc REST calls specified in the brief
  (`GET /system`, `GET /modalities?expand`, `POST /modalities/<id>/echo`) from inside
  the running `backend` container, using `wget`/Node's built-in `fetch` (already
  present in the image — no tool installation was needed or performed).
- With explicit approval obtained mid-investigation (see §5), temporarily registered
  Pivotal as an Orthanc modality via `PUT /modalities/investigation_pivotal`, issued a
  real `POST .../echo`, captured the full HTTP status and body, then immediately
  `DELETE`d the registration — net effect confirmed zero via a before/after
  `/modalities?expand` comparison.
- Inspected Docker networking (`docker network inspect`), container logs
  (`docker compose logs orthanc`), and the Docker Compose port-publishing
  configuration — all read-only.
- Checked the Windows host's actual IPv4 configuration (`ipconfig /all`,
  `Get-NetIPAddress`) for the subnet-mask / broadcast-address question.
- Ran one read-only database query (`SELECT ... FROM modality_devices` /
  `pacs_destinations`) to confirm which table `Old_Pacs` is stored in — no column
  containing a password, token, or secret was selected.
- No file was edited, no container was restarted, no DICOM study was touched, no
  database record was modified, and the one Orthanc modality registration made for
  testing was deleted immediately after the test, exactly as approved.

## 4. Source-code analysis

### 4.1 The two "Calling AE" code paths

**Modalities page path (what `Old_Pacs` actually uses) — no DICOM at all:**

`backend/src/modalities/modalities.service.ts:66-80`:
```ts
async testConnection(user: AuthUser, id: string): Promise<{ reachable: boolean; detail: string }> {
  const m = await this.get(user, id);
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (reachable: boolean, detail: string) => { socket.destroy(); resolve({ reachable, detail }); };
    socket.setTimeout(3000);
    socket.once('connect', () => done(true, `TCP connect to ${m.host}:${m.port} OK (DICOM C-ECHO in Phase 4)`));
    socket.once('timeout', () => done(false, `Timeout connecting to ${m.host}:${m.port}`));
    socket.once('error', (e) => done(false, `Error: ${e.message}`));
    socket.connect(m.port, m.host);
  });
}
```
This is a bare TCP connect. The comment on the success branch — `"(DICOM C-ECHO in
Phase 4)"` — is the developer's own note that the real DICOM verification was planned
but never implemented here. The method never calls `OrthancService`, never touches
Orthanc, and the `Calling AE`/`Called AE` concept is entirely absent from this code
path — there is no DICOM association, so there is no Calling AE to set at all.

**Frontend field-name mismatch — the exact cause of the "unreachable" text:**

`frontend/src/pages/admin/Modalities.tsx:81-89`:
```tsx
async function testConnection(row: any) {
  setTestingId(row.id);
  try {
    const res = await api.post(`/modalities/${row.id}/test-connection`, {});
    alert(res?.ok ? `Connection to ${row.name} succeeded.` : `Connection to ${row.name} failed: ${res?.message ?? 'unreachable'}`);
  } catch (e: any) {
    alert(`Connection test failed: ${e.message}`);
  } finally { setTestingId(null); }
}
```
The backend returns `{ reachable, detail }` (shown above); the frontend reads
`res?.ok` and `res?.message`. **Neither field exists on the response.**
`res?.ok` is always `undefined` → always falsy → the alert always takes the "failed"
branch, even when `reachable` was `true`. `res?.message` is always `undefined` →
the `?? 'unreachable'` fallback fires unconditionally. **This is the exact file and
line (`Modalities.tsx:85`) where every possible outcome of the backend's TCP probe —
success, timeout, or any other error — collapses into the single, constant string
"unreachable."** The backend's real `detail` text (e.g. "TCP connect to ... OK",
"Timeout connecting to...", "Error: ...") is computed correctly but never reaches the
user.

**Reverse-push / PACS Destinations path — real DICOM, but missing `LocalAet`:**

`backend/src/orthanc/orthanc.service.ts:64-85`:
```ts
async putModality(id: string, aet: string, host: string, port: number): Promise<void> {
  await this.req(`/modalities/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ AET: aet, Host: host, Port: port }),
  });
}

async echoModality(id: string): Promise<{ ok: boolean; detail?: string }> {
  try {
    await this.req(`/modalities/${encodeURIComponent(id)}/echo`, { method: 'POST', body: JSON.stringify({}), headers: { 'Content-Type': 'application/json' } });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, detail: e?.message };
  }
}
```
`putModality`'s signature has no `callingAet`/`LocalAet` parameter at all — only
`AET` (the **remote** AE), `Host`, and `Port` are ever sent to Orthanc's
`PUT /modalities/<id>` body. `backend/src/pacs/reverse-push.service.ts` stores a
`callingAet` field on every `PacsDestination` row (created/updated at lines 83 and
97), but **never passes it through**:
```ts
// reverse-push.service.ts:117 and :321
await this.orthanc.putModality(modId, d.aeTitle, d.host, d.port);
```
`d.callingAet` is read from the database and immediately discarded — it is never
part of the call. Confirmed directly against live Orthanc state in §5: a currently
registered modality (`revpush_b6099c1d`, from earlier reverse-push testing) shows
`"LocalAet": ""` in `/modalities?expand`. An empty `LocalAet` means Orthanc uses its
own server-level `DicomAet` setting (confirmed `"GGHPACS"` via `/system`, §5) as the
Calling AE for every outbound operation through that modality — i.e., **the per-destination
`callingAet` a user configures in the UI is silently ignored; Orthanc's global AE
title goes out instead, always.**

### 4.2 Where errors become "unreachable" — exact locations

| Step | File:line | What happens |
|---|---|---|
| 1 | `modalities.service.ts:66-79` | TCP-only probe; real `detail` text computed correctly here |
| 2 | `modalities.controller.ts:35-37` | Returns the service's `{ reachable, detail }` object unchanged — no transformation, no bug here |
| 3 | `Modalities.tsx:85` | **Reads the wrong field names** (`ok`/`message` instead of `reachable`/`detail`); `?? 'unreachable'` is a hard-coded literal, not derived from any backend value |

For the separate reverse-push path, the error-body-discarding bug (§4.3) is the
analogous "where detail gets lost" location.

### 4.3 Every DICOM library and service in use

- **Orthanc's own built-in DICOM C-STORE/C-ECHO SCU** (native, part of Orthanc core) —
  used by `OrthancService.echoModality`/`storeToModality`, via Orthanc's REST API.
  This is the only component in the codebase that actually performs a DICOM
  association. No separate DICOM library (dcmtk, pynetdicom, etc.) is used for this
  on the backend side.
- **`mwl-scp`** (separate Python service, `pynetdicom`) — DICOM Modality Worklist SCP,
  unrelated to this investigation (handles inbound C-FIND for worklist queries, not
  outbound C-ECHO to a remote PACS).
- **Orthanc's DICOM C-STORE SCP** (port 4242, native) — receives inbound images from
  modalities; also unrelated to this investigation's failure, but is the target of
  `HealthService`'s recurring TCP-only probe (§4.4).
- No DICOM library at all is used by either the `ModalitiesService.testConnection`
  TCP stub or the frontend — those paths are plain Node.js `net.Socket` and browser
  JavaScript respectively.

### 4.4 Source of the blank-Calling-AE associations (finding #8)

`backend/src/ops/health.service.ts:31-42, 76-78`:
```ts
private tcpProbe(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    ...
    sock.connect(port, host);
  });
}
...
case 'dicom-cstore': {
  const ok = await this.tcpProbe('orthanc', 4242); status = ok ? 'HEALTHY' : 'DOWN'; break;
}
```
This is the system health monitor's check for the `dicom-cstore` service, run on a
recurring schedule (confirmed every ~60 seconds from Orthanc's log timestamps, §5).
It opens a raw TCP connection directly to Orthanc's own DICOM port and immediately
closes it without ever sending a DICOM A-ASSOCIATE-RQ. Orthanc correctly logs this as
an invalid/blank-AET association attempt and rejects it — this is expected,
harmless, continuous background noise from the health monitor, not a sign of any
external connectivity problem, and not related to the Pivotal "unreachable" symptom.

## 5. Connectivity findings (exact output)

**Container ↔ network mapping** (`docker network inspect pacs-replica_pacs`):
```
pacs-replica-backend-1: 172.22.0.6/16
pacs-replica-postgres-1: 172.22.0.2/16
pacs-replica-ohif-1: 172.22.0.9/16
pacs-replica-nginx-1: 172.22.0.8/16
pacs-replica-mwl-scp-1: 172.22.0.4/16
pacs-replica-orthanc-1: 172.22.0.5/16
pacs-replica-frontend-1: 172.22.0.7/16
pacs-replica-redis-1: 172.22.0.3/16
```
**172.22.0.6 = `pacs-replica-backend-1`**, confirming finding #8's source container.

**Orthanc log, matching the health-check interval exactly:**
```
E1118 11:40:06.031056 DICOM-SERVER CommandDispatcher.cpp:333] Association Received from an invalid AET (sanitized: ) on IP 172.22.0.6, rejecting the association
E1118 11:41:06.026642 DICOM-SERVER CommandDispatcher.cpp:333] Association Received from an invalid AET (sanitized: ) on IP 172.22.0.6, rejecting the association
```
(Exactly 60 seconds apart — matches `HealthService`'s scheduled interval.)

**`GET /system`** (from inside the `backend` container, via `wget`):
```
"DicomAet" : "GGHPACS",
"DicomPort" : 4242,
"HttpPort" : 8042,
"Version" : "1.13.0"
```

**`GET /modalities?expand`** (before the approved test):
```json
{
   "revpush_b6099c1d" : {
      "AET" : "DESTPACS",
      "Host" : "orthanc-dest",
      "LocalAet" : "",
      "Port" : 4242,
      "Timeout" : 0
   }
}
```
No credential fields exist in this response (Orthanc's modality entries don't store
or return a username/password); `LocalAet: ""` is the key evidence for §4.1/root
cause #3.

**Database query** (read-only, no credential columns selected):
```
modality_devices: id=5f2072be-... name=Old_Pacs aeTitle=PIVOTAL_LISTENER host=172.16.7.82 port=11112
pacs_destinations: 2 rows (Test Dest Orthanc / Bad Dest) — no row named Old_Pacs or Pivotal
```
Confirms Pivotal is registered only as a `ModalityDevice`, never as a `PacsDestination`
— so the real-DICOM reverse-push code path has never been exercised against Pivotal at
all; only the TCP-only Modalities path has.

**Approved live test** (temporary `PUT` → `POST .../echo` → `DELETE`, full output):
```
PUT status: 200
PUT body: (empty)
ECHO status: 200
ECHO body: {}
DELETE status: 200
```
Orthanc's log for this time window shows **no rejection, no timeout, and no error**
for this attempt — only the unrelated, recurring health-check noise shown above. This
is a genuine, successful DICOM C-ECHO to Pivotal PACS (172.16.7.82:11112), issued by
Orthanc's own SCU with Calling AE `GGHPACS` (Orthanc's server default, since the test
registration also did not set `LocalAet`, deliberately mirroring the current
reverse-push code's behavior).

**TCP reachability** (from inside `backend`, Node `net.Socket`):
```
TCP connect OK
```

**Host subnet** (`ipconfig /all`, `Get-NetIPAddress`):
```
IPv4 Address. . . . . . . . . . . : 172.16.4.255(Preferred)
Subnet Mask . . . . . . . . . . . : 255.255.252.0     (i.e. /22)
Default Gateway . . . . . . . . . : 172.16.4.1
Adapter: vEthernet (New Virtual Switch) — Hyper-V Virtual Ethernet Adapter
```
With a `/22` mask, the network is `172.16.4.0/22`, valid host range
`172.16.4.1`–`172.16.7.254`, broadcast address `172.16.7.255`.
**`172.16.4.255` is a valid host address on this subnet, not the broadcast
address** — that conclusion only follows for a `/24` mask, which this is not. Caveat:
this is the Hyper-V/WSL2 virtual switch interface the Docker host network rides on;
if the hospital's physical NIC uses a different mask, that should be independently
confirmed on the actual server hardware, not just this virtualized adapter.

**Docker NAT / outbound source IP**: Orthanc runs on the standard Docker bridge
network (`pacs-replica_pacs`) with no `network_mode: host`. For an outbound
connection Orthanc's container initiates (e.g. the SCU C-ECHO to Pivotal), standard
Docker bridge networking source-NATs the packet to the **Docker host's own outbound
IP** for that route — i.e. Pivotal sees the connection originate from the Docker
host machine (`172.16.4.255` per the above), not from Orthanc's internal container
IP (`172.22.0.5`). This is consistent with, and explains why, the live test
succeeded without any NAT-related rejection.

## 6. Actual error evidence

- The user-visible "Connection to Old_Pacs failed: unreachable" text: confirmed to be
  a **hard-coded frontend fallback string**, not a value ever returned by the
  backend. No backend log, Orthanc log, or network capture can ever explain *why* it
  says "unreachable," because the word is never computed from any real condition —
  it always appears when the (actually successful-or-failed, but always
  field-mismatched) TCP probe result reaches the frontend.
- Why the Orthanc error body is lost for the *separate* reverse-push path (relevant
  to §4.1's `LocalAet` bug, and to the brief's Phase 3 question): `OrthancService`'s
  shared request helper —
  ```ts
  // orthanc.service.ts:18-26
  private async req(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${this.base}${path}`, { ...init, headers: {...} });
    if (!res.ok) throw new Error(`Orthanc ${path} -> ${res.status}`);
    ...
  }
  ```
  On a non-2xx response, this reads only `res.status` into the thrown `Error`'s
  message — **`res.text()`/`res.json()` is never called on the error branch**, so
  whatever diagnostic detail Orthanc's REST API put in the response body (Orthanc
  typically returns a JSON body with an `OrthancError`/`Message`/`HttpError` field
  describing *why* an operation failed, e.g. association rejected vs. timeout vs.
  host unreachable) is discarded before `echoModality`'s `catch` block ever sees it.
  `echoModality` then only has `e.message`, i.e. literally just the HTTP status code
  with no further detail — so even a real Orthanc-reported DICOM-level rejection
  reason is invisible to both logs and the UI for this path today.

## 7. Root cause / confirmed vs. unconfirmed

| # | Hypothesis | Status | Evidence |
|---|---|---|---|
| 1 | Calling AE `GGHPACS` not accepted by Pivotal (association rejected) | **Ruled out** (for this attempt) | Live test with Calling AE `GGHPACS` (Orthanc's default, since `LocalAet` was unset) succeeded: `ECHO status: 200`, no rejection in Orthanc's log |
| 2 | Wrong Called AE | **Ruled out** | Pivotal's AE `PIVOTAL_LISTENER` was used exactly as stored (`modality_devices` query, §5); the live echo test used the same value and succeeded |
| 3 | `LocalAet` not sent, so Orthanc uses its default `DicomAet` | **Confirmed as a real, separate bug** | `putModality()` never sends `LocalAet` (source, §4.1); a live registered modality shows `"LocalAet": ""` (§5); Orthanc's `/system` confirms its own default is `GGHPACS` (§5). **Outgoing AE title is always `GGHPACS`, never the per-destination `callingAet` a user configures.** This did not prevent the live test from succeeding, but it means the feature cannot send a different Calling AE even when a hospital's receiving PACS requires one. |
| 4 | Source IP / NAT mismatch with what Pivotal has registered | **Not confirmable from this side alone; current test did not show evidence of one** | The live echo succeeded, implying Pivotal accepted whatever source IP it saw (Docker NAT → host IP `172.16.4.255`, per §5) for this particular test. Whether Pivotal is configured to generally restrict by source IP is a question for the Pivotal side (§9). |
| 5 | `172.16.4.255` being a broadcast address / wrong subnet | **Ruled out** | Host's actual interface is a `/22` (`255.255.252.0`), not a `/24`; `172.16.4.255` is a valid host address on this mask, confirmed via `ipconfig`/`Get-NetIPAddress` (§5) |
| 6 | Timeout (`DicomScuTimeout`) vs. immediate rejection | **Not applicable to the "unreachable" symptom; ruled out for the live DICOM test** | No `DicomScuTimeout` override configured anywhere in this repo; the live echo completed quickly with no timeout. The "unreachable" message itself has no timing component at all — it is constant text regardless of what actually happened (§4.1, §6). |
| 7 | The backend reporting every Orthanc error as "unreachable" | **Confirmed, but not via the backend — via the frontend, and not specifically for Orthanc errors** | The backend's TCP-probe `detail` text is computed correctly and is specific (TCP OK / timeout / error message); the frontend discards it entirely due to a field-name mismatch (`Modalities.tsx:85`) and always shows the literal string `'unreachable'`. This happens for *every* outcome of that specific test (not just Orthanc errors — this code path never even calls Orthanc), confirmed by direct code read, not inference. |

**Bottom line**: the reported symptom ("Connection to Old_Pacs failed: unreachable")
has a fully source-code-confirmed root cause (#7, via the Modalities page's broken
TCP-stub + frontend field mismatch) that is independent of Pivotal, the network, or
any actual DICOM-level problem. A real, successful DICOM C-ECHO to Pivotal was
demonstrated live during this investigation. The genuinely real `LocalAet` defect
(#3) exists in a different, currently-unused-for-Pivotal code path and should be
fixed on its own merits for the reverse-push feature, not because it explains the
reported symptom.

## 8. Recommended fix (code + config) — NOT IMPLEMENTED, for review only

1. **Frontend field-name fix** (`Modalities.tsx:85`): read `res?.reachable` and
   `res?.detail` (matching the backend's actual response shape), not `res?.ok`/
   `res?.message`. This alone would make the existing TCP-only test report its real,
   already-correct `detail` text instead of the constant "unreachable."
2. **Implement the real DICOM C-ECHO for Modality Devices** (the comment in
   `modalities.service.ts:75` already flags this as planned "Phase 4" work): route
   `ModalitiesService.testConnection` through `OrthancService` the same way
   `ReversePushService.testDestination` already does — register a temporary Orthanc
   modality, call `echoModality`, then deregister — so a `ModalityDevice` test
   actually performs DICOM verification, not just a TCP handshake.
3. **Fix `OrthancService.putModality` to send `LocalAet`**: add a `callingAet`
   parameter to `putModality`'s signature and include `LocalAet: callingAet` in the
   PUT body; update both call sites in `reverse-push.service.ts` (lines 117 and 321)
   to pass `d.callingAet`/`dest.callingAet` through.
4. **Fix `OrthancService.req()` to preserve the response body on error**: read
   `res.text()` (or `res.json()` when the content-type allows) before throwing, and
   include it in the thrown error's message or a structured error object, so
   `echoModality`'s `catch` block — and ultimately the UI — can show Orthanc's actual
   reported reason for a failure instead of just an HTTP status code.
5. **Missing diagnostic logging** (Phase 3 of the brief): neither
   `ModalitiesService.testConnection` nor `OrthancService.echoModality` currently
   logs anything server-side on failure — both only return a value to the caller.
   Adding a `Logger.warn(...)` call with the destination id/host/port and the
   failure detail at the point of failure in each would make future investigations
   faster without needing to reproduce the issue live.

## 9. Safe implementation plan — NOT EXECUTED, for review only

If the above fixes are approved in a future phase:
1. Fix #1 (frontend field names) is the lowest-risk, highest-value first step —
   presentation-only, no backend change, immediately makes the existing (already
   correct) TCP-probe detail visible.
2. Fix #3 (`LocalAet`) and #4 (error-body preservation) are backend changes to a
   shared, already-tested service (`OrthancService`) — would need the existing
   reverse-push Playwright test suite re-run to confirm no regression, plus a new
   test asserting `LocalAet` is sent and a registered modality shows the configured
   `callingAet`.
3. Fix #2 (real DICOM echo for Modality Devices) is the largest change — effectively
   porting `ReversePushService.testDestination`'s pattern into
   `ModalitiesService.testConnection`. Should be scoped and reviewed as its own
   phase, since it changes a currently TCP-only feature into one that depends on
   Orthanc being reachable and correctly configured.
4. None of the above requires a database migration, a Docker Compose change, or
   touching any DICOM data.

## 10. Testing and validation plan — NOT EXECUTED, for review only

- For fix #1: unit/UI test asserting the Modalities test-connection button displays
  the backend's actual `detail` text for a deliberately-failing host (e.g. an
  unreachable IP) and for a deliberately-succeeding one, with no literal
  "unreachable" string appearing for either case.
- For fix #2: an end-to-end test (mirroring the existing `reverse-push.spec.ts`
  pattern) that registers a known-good test Orthanc destination (the existing
  `Test Dest Orthanc` / `orthanc-dest` entry already in `pacs_destinations` is a
  candidate, or a new throwaway one) as a `ModalityDevice` and confirms
  `testConnection` performs and reports a real C-ECHO result.
- For fix #3: a test asserting that after registering a destination with a specific
  `callingAet`, `GET /modalities/<id>` (Orthanc) shows that exact value as
  `LocalAet`, not an empty string.
- For fix #4: a test deliberately causing an Orthanc-side rejection (e.g. echoing an
  intentionally-misconfigured destination) and asserting the surfaced error message
  contains Orthanc's actual reported detail, not just an HTTP status code.
- Before any fix touching the reverse-push path ships, re-run the full existing
  Playwright suite (`reverse-push.spec.ts` and the general regression suite) to
  confirm no existing passing test regresses.

## Questions for the Pivotal side

1. **Is Calling AE `GGHPACS`, from IP `172.16.4.255` (the Docker host's outbound
   NAT address — see §5), registered or allowlisted in Pivotal's accepted-caller
   configuration?** The live test in this investigation succeeded, which suggests
   either Pivotal already accepts it, or Pivotal does not restrict by Calling AE/IP
   at all for Verification (C-ECHO) requests — worth confirming explicitly either
   way, since the reverse-push feature's `LocalAet` bug (§4.1, §7#3) means every
   future echo from this system will also present `GGHPACS`, not any
   per-destination AE a hospital admin might configure in the GG PACS UI, until
   that bug is fixed.
2. **Does Pivotal accept C-ECHO (Verification SOP Class) from callers not
   explicitly pre-registered in its own configuration?** This would explain why the
   live test succeeded even without any prior coordination on Pivotal's side, and
   is useful context before relying on this for production image transfer
   (C-STORE), which some PACS systems gate more strictly than C-ECHO.
3. **Exact timestamp of the live, successful test echo for cross-referencing against
   Pivotal's own listener logs**: approximately **2026-11-18 11:40:XX UTC** (the PUT/
   ECHO/DELETE sequence executed within the same minute as the health-check log
   lines shown in §5, which are timestamped `11:40:06` and `11:41:06` UTC). If
   Pivotal's logs show no corresponding inbound association at all around that
   time, that would be a meaningful finding worth a follow-up investigation
   (possible asymmetric routing, a firewall rule allowing the TCP handshake but
   silently dropping the DICOM payload, or similar) — this report's conclusion
   that "the DICOM path currently works" rests on Orthanc's own report of success
   and should ideally be corroborated from Pivotal's side too.

---

Investigation complete. No fix has been implemented. Awaiting direction on which
(if any) of the recommended fixes in §8 to proceed with, and the answers to the
three questions above.

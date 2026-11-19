# Product Validation — Phase 1C: Remove Unnecessary Direct Orthanc DICOMweb Exposure

**Status: implemented and verified.** One nginx configuration change, applied and validated. No
database record, no DICOM file, no Docker volume, no credential, no backend permission logic, and
no unrelated NGINX route was modified. Only the `nginx` container was restarted; all other 7
services were left untouched and were never restarted.

## 1. Pre-change dependency verification

Performed before any change, per the brief's explicit step 1 instruction.

- **NGINX `/dicom-web/` location**: read directly — a `location /dicom-web/` block proxying
  straight to `http://orthanc:8042`, forwarding whatever `Authorization` header the client sent,
  with no path prefix stripped beyond the DICOMweb plugin's own `/dicom-web/` mount point.
- **Orthanc DICOMweb configuration**: `ORTHANC__DICOM_WEB__ENABLE: "true"` in `docker-compose.yml`
  — confirmed this flag is **Orthanc's own plugin enable switch**, entirely independent of the now-removed
  nginx route to it. This flag was **not** touched, since the backend's `/api/dicom-web/` proxy still
  needs Orthanc's DICOMweb plugin running internally.
- **OHIF configuration**: `ohif/app-config.js` read directly — `wadoUriRoot`, `qidoRoot`, and
  `wadoRoot` are all set to `/api/dicom-web`, never the bare `/dicom-web/` path.
- **Backend DICOMweb integration**: `backend/src/dicomweb/dicomweb.controller.ts` and
  `dicomweb.service.ts` read directly — the backend proxy targets Orthanc's `/dicom-web` endpoint
  **internally**, over the Docker network, independent of nginx's public routing. Removing the
  public nginx route to Orthanc has no effect on this internal backend→Orthanc path.
- **Frontend viewer launch and study handoff**: `frontend/src/lib/viewer.ts` re-read — the viewer
  session flow (`POST /api/viewer/session` → open `/viewer/viewer?StudyInstanceUIDs=...`) never
  references `/dicom-web/` directly; OHIF itself makes the DICOMweb calls per its own config above.
- **All references to `/dicom-web/` across the project**: a scoped search across
  `frontend/src`, `backend/src`, `ohif/`, `tests/`, `scripts/`, and `orthanc/` found **zero**
  references to the bare `/dicom-web/` path anywhere outside `nginx.conf` itself and the backend's
  own internal proxy target string (which is unaffected by this change, since it talks to Orthanc
  directly over the Docker network, not through the public nginx route). Every reference found, in
  every file, uses `/api/dicom-web/` — confirmed exhaustively, not sampled.
- **Existing authentication and authorization mechanisms**: confirmed the backend's
  `/api/dicom-web/` route enforces `@RequirePermissions(PERMISSIONS.STUDY_VIEW)` and writes an
  audit-log entry on access (`dicomweb.controller.ts`) — this enforcement is completely independent
  of, and unaffected by, the nginx change, since it lives entirely in the backend proxy path that
  was not touched.

**Conclusion: no active dependency on the direct `/dicom-web/` nginx route was found anywhere in
the codebase, its tests, or its tooling.** Per the brief's instruction, this result allowed
proceeding directly to implementation without stopping to report a blocking dependency, because
none was found.

## 2. Files changed

- `nginx/nginx.conf` — **the only file modified.**

No other file (frontend, backend, Orthanc config, OHIF config, Docker Compose, or any test file)
was changed.

## 3. Exact route removed or disabled

The following `location` block was **removed** from the `server {}` block in `nginx/nginx.conf`
(not merely commented out, since the brief's goal is removal; the prior configuration is preserved
verbatim below for rollback purposes):

```nginx
# DICOMweb (QIDO/WADO/STOW) -> Orthanc, consumed by OHIF.
# The upstream path must be /dicom-web/ + the part after our /dicom-web/.
location /dicom-web/ {
  set $upstream_orthanc orthanc;
  rewrite ^/dicom-web/(.*)$ /dicom-web/$1 break;
  proxy_pass http://$upstream_orthanc:8042;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header Authorization $http_authorization;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

In its place, an explanatory comment was left (referencing this report) so a future reader
understands why no `location /dicom-web/` block exists, rather than finding a silent gap. No
alternative unauthenticated route was introduced to replace it — the brief's explicit instruction
("Do not expose an alternative unauthenticated DICOMweb route") was followed; nothing now serves
that path except the frontend SPA's own default catch-all (`location /`), which returns the same
generic `index.html` it would for any other undefined path on the site — not Orthanc data, not an
error specific to this path, and not a new attack surface (confirmed in §5).

Every other `location` block (`/healthz`, `/socket.io/`, `/api/dicom-web/`, `/api/`, `/viewer/`,
`/`) is **byte-for-byte unchanged**.

## 4. Security impact

- **Before**: `GET /dicom-web/*` (and any other DICOMweb method) was reachable directly from
  outside the Docker network, gated only by Orthanc's single, shared, static Basic Auth credential —
  with **no per-user `study.view` permission check and no audit log entry**, since Orthanc has no
  concept of the application's users, roles, or organisations.
- **After**: the same path now reaches only the frontend SPA's catch-all route, which returns the
  generic `index.html` shell — no DICOM metadata or pixel data is served there under any
  credential, valid or otherwise. The only way to reach DICOM data through nginx is now
  `/api/dicom-web/`, which enforces `study.view` and writes an audit entry on every access, exactly
  as it already did before this change.
- **Net effect**: closes a real organisation-isolation bypass (anyone holding the shared Orthanc
  credential could previously read any organisation's imaging data with zero audit trail) with zero
  loss of legitimate functionality, since nothing in the application used the removed path.

## 5. DICOM/PACS regression results

All checked directly against the live, already-restarted stack.

| Check | Result |
|---|---|
| Orthanc container status | `Up 3 days (healthy)` — never restarted by this change |
| Orthanc DICOM C-STORE port (4242) | Still bound, `0.0.0.0:4242->4242/tcp` — unchanged |
| MWL SCP container status | `Up 3 days (healthy)` — never restarted |
| MWL port (4243) | Still bound, `0.0.0.0:4243->4243/tcp` — unchanged |
| `GET /dicom-web/studies` (unauthenticated) | Now returns the SPA's `index.html` (`Content-Type: text/html`) — **not** Orthanc/DICOM data, confirmed by inspecting the response body directly |
| `GET /dicom-web/studies` with a guessed/wrong Basic Auth credential | Same result — the SPA fallback, not Orthanc, since the request never reaches Orthanc at all anymore |
| `GET /api/dicom-web/studies` (no token) | **Unchanged**: `401 {"message":"Unauthorized","statusCode":401}` — a structured JSON error from the backend's own guard, proving the authenticated proxy path still correctly reaches the backend/Orthanc layer |
| `viewer.spec.ts` full suite (4 tests, including the real end-to-end "loads OHIF and renders, then MPR works" test) | **4/4 passing** |

No C-STORE transfer was initiated against any modality during this validation, per the brief's
restriction — the above checks are all passive/read-only HTTP requests and existing-suite runs.

## 6. OHIF validation

- `viewer.spec.ts:90` — `worklist Open Study loads OHIF and renders, then MPR works` — **passed**,
  end-to-end: a real study is opened via the Worklist's "Open Study" button, OHIF loads it through
  `/api/dicom-web/` (the only path it has ever used), and the MPR (multi-planar reformation) view
  renders correctly with all orthogonal viewports.
- `viewer.spec.ts:30/36/63` — DICOMweb proxy authentication, organisation isolation, and WADO-RS
  pixel-data streaming — all **passed**, confirming the authenticated proxy path (the only path OHIF
  or any other part of the app has ever used) is completely unaffected by removing the unused direct
  route.

## 7. RBAC validation

- Logged in as the `receptionist` test account (`recept1`): sidebar still shows exactly 7
  permitted links, `/admin/users` still correctly absent — identical result to Phase 8B/8C's own
  verification, confirming this nginx-only change had no effect on frontend RBAC behaviour (as
  expected, since RBAC is entirely a frontend + backend concern, untouched by this change).
- Logged in as `admin`: `/admin/users` and other admin screens load with zero error banners,
  confirming no unrelated regression.

## 8. Existing test results

- **70/70 existing Playwright tests passing**, run fresh after the nginx restart (not reused from a
  prior phase's result).
- `tsc --noEmit`: clean (no frontend file was touched this phase, so this re-confirms no drift,
  rather than testing a new change).
- Production build: clean, identical output hash to Phase 8C's build (`index-C1s7wVQ_.css`,
  `index-DzsIVynW.js`) — confirming zero frontend source change occurred.
- 4 additional throwaway Playwright tests specific to this phase (patient-to-study navigation,
  Report Editor/signed-report access, RBAC link count, admin-screen regression) — **4/4 passing**,
  then deleted per the project's established pattern; no trace remains.

## 9. Rollback procedure

**Exact configuration change**: the `location /dicom-web/ { ... }` block shown verbatim in §3 was
removed from `nginx/nginx.conf`, between the `/api/` location and the `/viewer/` location, and
replaced with an explanatory comment.

**Previous configuration**: reproduced in full in §3 above — sufficient to paste back in verbatim.

**Rollback command/procedure**, if ever needed:
1. Re-insert the `location /dicom-web/ { ... }` block from §3 into `nginx/nginx.conf`, in its
   original position (between `/api/` and `/viewer/`).
2. Validate syntax: `docker run --rm -v "$(pwd)/nginx/nginx.conf:/etc/nginx/nginx.conf:ro"
   nginx:1.27-alpine nginx -t` (the same validation step used before applying this change).
3. Apply: `docker compose restart nginx`.
4. **Validation required after rollback**: confirm `GET /dicom-web/studies` once again returns a
   401 *from Orthanc* (not the SPA's HTML) to prove the route is restored; re-run `viewer.spec.ts`
   to confirm nothing else was disturbed by the rollback itself.

**Rollback was not executed** — it is documented here only as required by the brief, not because it
was needed. All validation in §5–§8 passed on the first attempt.

## 10. Confirmation that unrelated services and clinical data were untouched

- **Unrelated services**: `backend`, `frontend`, `mwl-scp`, `ohif`, `orthanc`, `postgres`, and
  `redis` were never restarted during this phase — confirmed by their unchanged uptimes
  (`Up 3 days`, `Up 2 days`, `Up 4 days` as applicable) and `RestartCount: 0` on every container,
  both before and after this change. Only `nginx` was restarted, exactly once, to apply the
  config change — consistent with "do not restart unrelated services."
- **Clinical data**: no patient, study, order, or report record was created, modified, or deleted.
  No DICOM file was transferred, copied, deleted, or modified. No Orthanc storage path or Orthanc
  credential was touched.
- **Docker Compose**: not modified — only `nginx/nginx.conf`, which is mounted read-only into the
  `nginx` service and does not require any `docker-compose.yml` change to take effect.
- **Backend permissions / authentication**: not modified — `@RequirePermissions`,
  `PermissionsGuard`, `JwtAuthGuard`, and every role/permission definition remain exactly as they
  were.
- **All eight Docker services**: confirmed present and healthy after this change, exactly as before
  it.

---

Stopping here per the stop condition. Backup implementation and the remaining remediation items
from `docs/PRODUCT_VALIDATION_PHASE1B_REMEDIATION_PLAN.md` were not started. Awaiting approval
before any further phase.

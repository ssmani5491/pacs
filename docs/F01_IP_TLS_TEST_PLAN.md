# F-01 IP-Based TLS — Stage 4: Compatibility Test Plan (Not Executed)

**Status: PLAN ONLY.** None of these tests have been run — there is no :443 listener to run them
against yet (Stage 3 is a design, not a deployment). Every test below names the exact command/check
to run once the Stage 3 design is actually implemented and approved.

## 0. Pre-requisite for running this plan for real
All tests assume `https://<SERVER_IP>` exists and :80 still works — i.e. Stage 1's networking gap is
resolved and Stage 3's nginx design has actually been deployed. None of that has happened; this
document prepares the test plan per your Stage 5 instruction, it does not claim any result.

## 1. Login and refresh-token rotation
- **Test:** `POST https://<SERVER_IP>/api/auth/login` with valid credentials over TLS → expect
  `200` + `{accessToken, refreshToken}`, identical shape to the existing :80 behavior.
- **Test:** `POST https://<SERVER_IP>/api/auth/refresh` with the issued refresh token → expect a new
  token pair, and the old refresh token subsequently rejected (same rotation logic as today —
  protocol-agnostic, no code difference expected).
- **Command pattern (reuse existing Playwright suite with an overridden base URL):**
  `BASE_URL=https://<SERVER_IP> ./node_modules/.bin/playwright test` — the suite already reads
  `process.env.BASE_URL`, no new test infra needed.
- **Expected finding:** no behavior change — JWT issuance/verification has no TLS dependency.

## 2. HttpOnly viewer-session cookie
- **Test:** `POST https://<SERVER_IP>/api/viewer/session`, inspect the `Set-Cookie` response header
  for `pacs_viewer=...; HttpOnly; SameSite=Lax; Path=/`. Since `COOKIE_SECURE` stays `false` in this
  stage (Stage 3 explicitly defers it), the cookie should **not** yet carry `Secure` — confirm it
  still works identically over both :80 and :443 for now.
- **Test (negative, documents the deferred step rather than exercising it):** confirm the cookie is
  **not** marked `Secure` yet — this is the expected, correct state for this stage, not a defect to
  fix here.

## 3. OHIF image loading
- **Test:** open `https://<SERVER_IP>/viewer/viewer?StudyInstanceUIDs=<a known test study>` and
  confirm the study renders (reuse the exact reproduction method already used earlier in this
  project's own OHIF diagnostic: check for 0 console errors, confirm `studyToFirstImage` timing log,
  confirm a real pixel-data screenshot).
- **Expected finding:** works identically to :80, since every OHIF DICOMweb root is a relative path
  (`/api/dicom-web`) that inherits whatever protocol the page loaded under — no OHIF-side change
  exists to test for, only that the proxy path still functions over TLS.

## 4. DICOMweb QIDO/WADO
- **Test:** `GET https://<SERVER_IP>/api/dicom-web/studies?StudyInstanceUID=<uid>` (QIDO) and
  `GET https://<SERVER_IP>/api/dicom-web/studies/<uid>/metadata` (WADO metadata) with a valid Bearer
  token → expect `200` + real DICOM JSON, matching the exact response already proven over :80 earlier
  in this project.
- **Test:** repeat as an unauthenticated request → expect `401`, confirming auth enforcement is
  unaffected by protocol.
- **Test:** repeat as a cross-org user → expect `403`/empty result, confirming org isolation is
  unaffected by protocol (same `assertStudyAccess` code path regardless of TLS).

## 5. Socket.IO / WebSocket
- **Test:** connect to `wss://<SERVER_IP>/socket.io/` (the frontend's relative-path client will do
  this automatically once the page itself loads over `https://`) with a valid JWT in the handshake →
  expect a successful connection and room join, then trigger a real event (e.g. an order assignment)
  and confirm the notification arrives over the socket.
- **Expected finding:** no change expected — nginx's `/socket.io/` location already sets the
  `Upgrade`/`Connection` headers correctly and this stage's design copies that location verbatim into
  the new :443 server block.

## 6. Reverse Push
- **Test:** with the application loaded over `https://<SERVER_IP>`, run the existing Reverse Push
  functional test (`POST /api/pacs/reverse-push/jobs` → C-ECHO → C-STORE → job COMPLETED) exactly as
  already proven in Module 1's own test suite, just through the new protocol.
- **Expected finding:** no change — Reverse Push's C-STORE SCU call is a backend-to-Orthanc-to-
  destination operation that never touches the client-facing nginx TLS listener at all.

## 7. Archive operations
- **Test:** `POST /api/pacs/archive/jobs` over `https://<SERVER_IP>` → confirm job progresses to
  `VERIFIED`, SHA-256 matches, exactly as the existing Module 2 test suite already proves over :80.
- **Expected finding:** no change — archive compression/verification is backend-internal, same
  reasoning as Reverse Push above.

## 8. Health checks
- **Test:** `GET https://<SERVER_IP>/healthz` → expect `200 "ok"`, and `GET http://<SERVER_IP>/healthz`
  (still, since :80 is retained) → also `200 "ok"` — confirming the healthz exemption from any future
  redirect is correctly structured in the design, and that it already works on both ports at this
  stage since no redirect exists yet.
- **Test:** the container-internal healthchecks (`backend`, `nginx`, `ohif` — all probe
  `127.0.0.1` over plain HTTP inside the Docker network) are unaffected by anything at the external
  :443 listener; confirm via `docker compose ps` that all remain `healthy` after the nginx config
  change is deployed.

## 9. All eight Docker services
- **Test:** `docker compose ps` immediately after deploying the Stage 3 nginx change → confirm all 8
  services (`postgres`, `redis`, `orthanc`, `backend`, `mwl-scp`, `frontend`, `ohif`, `nginx`) remain
  `healthy`/`Up`, with **no new service added and none removed** — the design in Stage 3 only touches
  the `nginx` service's ports/volumes.
- **Test (dynamic-DNS regression, the standard check used in every prior phase that touched nginx):**
  force the `backend` container to recreate with a new Docker-assigned IP (e.g. via the same method
  used in Phases 5/6/8/9 — pin the old IP with a placeholder container, or simply `docker compose up
  -d --force-recreate backend`), then issue repeated requests through **both** :80 and the new :443 →
  expect zero 502s on either, confirming the dynamic resolver (`resolver 127.0.0.11`) is doing its job
  identically under the new TLS listener.

## 10. Explicitly out of scope / NOT TESTED by this plan
- DICOM TLS on :4242/:4243 — untouched by this entire IP-TLS effort; marked **NOT TESTED** here
  exactly as in the prior general F-01 TLS plan, pending the still-unanswered modality-capability
  question.
- Certificate-trust warnings in the browser — expected and inherent to a self-signed cert until
  manually imported on each client (Stage 2); not a pass/fail test, a known, accepted characteristic
  of the chosen approach.
- Redirect/HSTS/secure-cookie behavior — not applicable yet, since Stage 3 does not enable them.

## Reporting convention for when this plan is actually executed
Consistent with every prior test report in this project: only tests actually run get a PASS/FAIL
result; anything not executed is marked **NOT TESTED**, never assumed to pass.

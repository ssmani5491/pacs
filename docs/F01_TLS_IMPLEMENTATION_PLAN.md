# F-01 TLS/HTTPS — Implementation Plan (Proposal, Not Approved)

**Status: PLAN ONLY. No configuration has been changed. Depends on answers in
`F01_TLS_OPEN_QUESTIONS.md`** — several decisions below are marked accordingly and this plan does not
pick a single certificate strategy for you; it compares the three the brief asked for and states what
each would require.

## 1. Certificate strategy comparison

| | A. Internal hospital CA | B. Public CA | C. Self-signed (fallback only) |
|---|---|---|---|
| **Trust** | Trusted automatically if client machines already trust the internal CA (open question B6) | Trusted by every browser/OS out of the box | Trusted by **nothing** until manually imported on every client |
| **Requires** | An existing internal CA (open question B5) + a request/issuance process | Public DNS resolution + domain validation reachability (open question B7) — the brief says not to assume this is available | Nothing external — can be generated entirely offline |
| **Renewal** | Whatever the internal CA's policy allows (open question C10) | ~398-day cap (current public-CA industry limit), needs automation (e.g. ACME) | Manual, no built-in renewal tooling |
| **Appropriate for** | A hospital's internal clinical network — the common, correct choice when an internal CA exists | Only if this host is genuinely reachable for public validation, which is atypical for an internal PACS | Short-lived testing/validation only, **not** a production end-state |

**Recommendation, conditional on the open questions:** **Option A (internal hospital CA)** is almost
always the right fit for an on-prem hospital RIS/PACS, *if* such a CA exists and client trust is
already distributed (B5/B6). **If no internal CA exists and cannot be stood up in a reasonable
timeframe, Option C (self-signed) is the correct interim step** — explicitly temporary, with every
client needing one manual trust action — while B5/B6 get resolved. **Option B (public CA)** is
recommended against unless A1–A4/B7 establish that this host genuinely has public reachability, which
would be unusual for an internal clinical system and should not be assumed. This recommendation will
be revisited once the open questions are answered; it is not a final decision.

## 2. Proposed traffic architecture

Builds directly on the existing `nginx-tls.conf.example` template (already written, never deployed)
rather than designing a new one — reuse, not replacement:

```
Browser/Modality-admin UI ──HTTPS:443──▶ nginx (TLS terminates here, ONLY here)
                                           │  ssl_certificate / ssl_certificate_key
                                           │  TLSv1.2 + TLSv1.3, HIGH:!aNULL:!MD5 ciphers
                                           │  HSTS header (HTTPS block only)
                                           ├─ same routes as today, UNCHANGED:
                                           │    /            -> frontend (same-origin, inherits wss/https)
                                           │    /api/        -> backend
                                           │    /api/dicom-web/ -> backend (proxy)
                                           │    /socket.io/   -> backend (wss:// upgrade, same headers)
                                           │    /viewer/      -> ohif
                                           │    /dicom-web/    -> orthanc
                                           └─ dynamic-DNS resolver 127.0.0.11 + $upstream_* vars: UNCHANGED

:80 server block ──▶ 301 redirect to https://$host$request_uri for everything EXCEPT /healthz
                      (matches the existing template; /healthz stays 200 on plain HTTP so the
                      container healthcheck, which runs over :80 unauthenticated, is unaffected)
```

All inter-container traffic (nginx→backend, nginx→orthanc, nginx→ohif, nginx→frontend) **stays
plaintext HTTP on the internal Docker network** — that traffic never leaves the host's bridge network,
so TLS there would add complexity without a real exposure to mitigate. TLS terminates once, at the
nginx edge, which is the standard pattern this stack's own unused template already assumes.

## 3. Sequencing (the order matters — do not flip flags out of order)

1. Resolve the open-questions document (hostname, CA, trust distribution).
2. Obtain/issue the certificate + private key for the agreed hostname/SANs (owner process; not
   performed here).
3. Mount the cert/key as a read-only volume into nginx (new volume, additive to `docker-compose.yml`
   — no existing volume touched).
4. Deploy a reviewed version of `nginx-tls.conf.example` as the live `nginx.conf`, add the `443:443`
   port mapping (`NGINX_TLS_PORT` already exists in `.env.example`, just unused today).
5. **Verify HTTPS actually works** end-to-end (frontend loads, API calls succeed, OHIF renders, Socket.IO
   connects) over `wss://`/`https://` — before touching any "secure" flag.
6. **Only after step 5 is confirmed working:** set `HSTS_ENABLED=true` (backend) and `COOKIE_SECURE=true`
   (viewer-session cookie). Flipping either of these before HTTPS is verified would be actively
   harmful — `COOKIE_SECURE=true` on plain HTTP would make the viewer cookie silently stop being sent
   at all, breaking OHIF, and HSTS before HTTPS works could lock users out of ever reaching the plain
   HTTP fallback. This ordering is already called out correctly in the existing code comments
   (`main.ts:12-14`, the TLS template's own header) — this plan just makes the dependency explicit as a
   deployment step, not only a comment.
7. Document `CORS_ORIGINS`, `HSTS_ENABLED`, `COOKIE_SECURE` in `.env.example` with real guidance
   (currently undocumented despite being read by the code — see current-state findings §4).
8. Decide, per open question E16, whether plain HTTP keeps working post-cutover or closes entirely.

## 4. DICOM networking — explicitly separate from the web TLS work

**HTTPS on nginx does nothing for C-STORE (:4242) or MWL (:4243).** These are untouched by this plan's
steps 1–8 and need their own decision track:

- **Network segmentation / firewall**: the most realistic, lowest-risk control for an internal
  clinical network — restrict which hosts/VLANs can reach :4242/:4243 at the network layer, since most
  deployed modalities don't support DICOM TLS at all (open question D14). This does not require any
  change to this project's code or compose file; it's a network-infrastructure decision for the
  hospital's IT/network team.
- **Calling/Called AE restriction**: already partially present — the MWL SCP validates the *called*
  AE and rejects mismatches (Phase 5, existing behavior, unchanged by this plan); neither service
  currently restricts the *calling* AE (documented pre-existing gap, Phase 9 DICOM-SEC-1 /
  independent-audit F-08). Tightening this is a configuration change to Orthanc/`mwl_scp.py`, not a
  TLS change, and is **out of scope for F-01** — noted here only so it isn't confused with TLS coverage.
- **DICOM TLS (encrypted DICOM association)**: only pursue this if open question D14 confirms the
  actual modalities support it; forcing it onto a modality that doesn't would break clinical
  connectivity. If pursued, Orthanc supports DICOM TLS via its own configuration
  (`DicomTlsEnabled`/certificate settings) and would need a **separate** certificate (can be the same
  internal CA, different cert) from the one used for the web-facing nginx listener — DICOM-TLS and
  HTTP-TLS are not interchangeable.
- **Recommendation**: do not block the web-HTTPS rollout (steps 1–8 above) on resolving DICOM-TLS. They
  are independent efforts; the hospital's real risk profile (answered by D13/D14) determines whether
  DICOM-TLS is ever needed at all.

## 5. Compatibility / regression risk review

| Area | Risk under TLS | Mitigation already in place / needed |
|---|---|---|
| JWT auth + refresh tokens | None — token transport is protocol-agnostic | No change needed |
| HttpOnly viewer cookie | **Sequencing risk only** (see §3 step 6) — `secure: true` before HTTPS works would silently break it | Follow the sequencing in §3; code already supports both states via `COOKIE_SECURE` |
| CORS | Allow-list (`CORS_ORIGINS`) must include the real `https://<hostname>` origin once decided | Add the origin to the env var; no code change |
| OHIF image loading | None — all DICOMweb roots are relative paths, inherit the page's protocol | No change needed |
| DICOMweb proxy | None — proxy logic is protocol-agnostic; org isolation unaffected | No change needed |
| Socket.IO | **Gateway CORS is currently `origin: true` (reflects any origin)** — independent pre-existing gap, not caused by TLS but worth tightening in the same pass since it's adjacent | Optional hardening: restrict to the same `CORS_ORIGINS` allow-list as the REST API (separate, small change — flag for approval, not bundled into this plan without a decision) |
| NGINX dynamic DNS resolver | None — the TLS template already preserves `resolver 127.0.0.11` + variable upstreams unchanged | No change needed; verify after deploy exactly as Phase 5/6/8/9 did (backend recreate → new IP → zero 502s) |
| Existing health checks | None — all healthchecks hit internal, unauthenticated HTTP endpoints that never traverse the TLS-terminating listener; `/healthz` stays exempt from the redirect | Confirm `/healthz` exemption is preserved in the final nginx config (it already is, in the template) |
| Reverse Push / Archive operations | None — these are backend-internal (Orthanc SCU calls, worker threads) and don't terminate at the edge nginx listener at all | No change needed |

## 6. Files likely to change (when implementation is approved — not now)
- `nginx/nginx.conf` — replaced with a reviewed version of `nginx-tls.conf.example` (or the example
  promoted directly, after review).
- `docker-compose.yml` — add `"${NGINX_TLS_PORT}:443"` port mapping + a new read-only certificate
  volume mount for the `nginx` service. **No existing volume, port, or service removed.**
- `.env.example` — document `NGINX_TLS_PORT`, `HSTS_ENABLED`, `COOKIE_SECURE`, `CORS_ORIGINS` with
  real guidance (currently silently read by code but undocumented).
- `.env` — set the real values once decided (no secret printed here or at implementation time).
- Optionally, `notifications.gateway.ts` — tighten Socket.IO CORS to match `CORS_ORIGINS` (separate
  decision, not required for TLS itself).
- **No change anticipated** to any DICOM port, Orthanc DICOM config, MWL SCP, backend auth logic,
  frontend code, or OHIF config — all already TLS-ready by design (relative paths, protocol-agnostic
  tokens, env-gated secure flags).

## 7. Deployment and rollback plan (proposal)

**Deployment:**
1. Stage the new `nginx.conf` + cert volume in a copy of the compose file; validate with
   `docker compose config` (no live change).
2. Deploy nginx with the new config + port mapping; verify `:443` responds and `:80` redirects,
   `/healthz` still 200 on both.
3. Run the full existing regression suite against `https://<hostname>` (Playwright `BASE_URL` already
   supports an override — no new test infra needed).
4. Only after step 3 passes: flip `HSTS_ENABLED`/`COOKIE_SECURE`, redeploy backend, re-verify.

**Rollback:** because nginx is a stateless, swappable service with no data of its own, rollback is
reverting `nginx.conf` to the current plain-HTTP version and removing the `443` port mapping — no
database, volume, or other service is touched by this work in either direction, so rollback carries
no data-loss risk. The two env flags (`HSTS_ENABLED`, `COOKIE_SECURE`) should be reverted to `false`
in the same rollback step, in reverse of the order they were enabled.

## 8. Test plan (to run once implementation is approved — none of this was executed now)
- `docker compose config` validates the new compose file.
- `nginx -t` syntax-checks the new config (throwaway container, as done for every prior nginx change
  in this project).
- Full Playwright regression against `BASE_URL=https://<hostname>` — reuses the existing suite.
- Explicit dynamic-DNS regression (same method used in Phases 5/6/8/9): recreate the backend container
  to force a new Docker IP, confirm zero 502s through the new HTTPS listener.
- Manual/automated check that `/healthz` returns 200 on **both** :80 and :443 and is never redirected.
- Confirm OHIF loads and renders a real study over `https://`, including the WADO-RS pixel-frame
  streaming path (repeat of the existing viewer test, just over the new protocol).
- Confirm Socket.IO connects and receives a real notification over `wss://`.
- Confirm the browser-visible cookie is marked `Secure` (DevTools/`document.cookie` won't show it —
  `HttpOnly` — but the `Set-Cookie` response header can be inspected) only after step 6 of the
  sequencing plan, not before.
- Explicitly **mark as NOT TESTED** anything involving DICOM TLS, since whether it's pursued at all
  depends on open questions D13/D14.

---

**No certificate was generated, no configuration was changed, no service was restarted. Awaiting your
answers to `F01_TLS_OPEN_QUESTIONS.md` and your approval before any implementation begins.**

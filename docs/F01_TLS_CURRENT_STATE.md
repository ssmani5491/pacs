# F-01 TLS/HTTPS — Current State (Read-Only Investigation)

**Status: investigation complete. No configuration, code, or service was changed.**

## 1. Current traffic paths (all plaintext HTTP/TCP today)

```
Browser ──HTTP:80──▶ nginx ──┬─ /            ──▶ frontend:80  (static SPA)
  (localhost)                ├─ /api/        ──▶ backend:3000 (REST, JWT Bearer/cookie)
                             ├─ /api/dicom-web/ ─▶ backend:3000 (authenticated DICOMweb proxy)
                             ├─ /socket.io/   ──▶ backend:3000 (Socket.IO, ws:// upgrade)
                             ├─ /viewer/      ──▶ ohif:80      (SPA, cookie-authenticated DICOMweb calls)
                             └─ /dicom-web/   ──▶ orthanc:8042 (Basic-auth header passthrough, used by OHIF directly)

Modalities ──DICOM:4242 (C-STORE)──▶ orthanc (plaintext DICOM association, no TLS)
Modalities ──DICOM:4243 (MWL C-FIND)──▶ mwl-scp (plaintext DICOM association, no TLS)
```

Every one of these paths is **plain HTTP or plain DICOM today** — there is no TLS anywhere in the
running stack.

## 2. NGINX (`nginx/nginx.conf`)
- **Single `server { listen 80; server_name _; }` block.** No `listen 443`, no `ssl_certificate`
  directive, no redirect-to-HTTPS block.
- **Dynamic DNS resolver preserved and load-bearing**: `resolver 127.0.0.11 valid=10s ipv6=off;` +
  per-location `set $upstream_X <service>; proxy_pass http://$upstream_X:<port>$request_uri;` for
  every route (`backend`, `orthanc`, `ohif`, `frontend`). This is the Phase 5 fix that prevents 502s
  after a container recreate; it must survive unchanged under TLS.
- **Security headers already present on the `/` (SPA) block**: `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, a CSP. **No HSTS header anywhere in the live config**
  (correctly absent on plain HTTP).
- **A TLS-ready template already exists**: `nginx/nginx-tls.conf.example` — written in Phase 9, **not
  wired into `docker-compose.yml`**. It already: redirects HTTP→HTTPS, listens on 443 with
  `ssl_certificate`/`ssl_certificate_key`, sets `TLSv1.2`/`TLSv1.3` + a `HIGH:!aNULL:!MD5` cipher
  string, adds HSTS only inside the HTTPS server block, and preserves the same dynamic-DNS
  resolver/upstream pattern. It is a starting point, not a finished, reviewed artifact.

## 3. Docker Compose
- `nginx` service publishes only `"${NGINX_PORT}:80"` — **no 443 mapping exists in the live compose
  file**, even though `.env.example` defines `NGINX_TLS_PORT=443`. The variable is declared but
  **unused** by compose today.
- No certificate volume is mounted anywhere.
- DICOM ports: `"${ORTHANC_DICOM_PORT}:4242"` (C-STORE, Orthanc's own listener) and
  `"${MWL_PORT:-4243}:4243"` (MWL SCP, custom `mwl-scp` Python service) — both published to all host
  interfaces (`0.0.0.0` by default, since no bind address is specified), both plaintext DICOM.
- All 8 services, healthchecks, restart policies, and the `pacs` bridge network are unaffected by
  anything TLS-related — preserving them is purely a question of *adding* a TLS listener, not
  restructuring the compose file.

## 4. `.env.example` / environment variables
- `NGINX_PORT=80`, `NGINX_TLS_PORT=443` (declared, **unused** by the live compose/nginx config).
- **Two environment variables are read by backend code but documented nowhere in `.env.example`:**
  - `HSTS_ENABLED` (`main.ts:18`) — gates helmet's HSTS header. Correctly `false`-by-default.
  - `COOKIE_SECURE` (`dicomweb.controller.ts:51`) — gates the `secure` flag on the OHIF viewer-session
    HttpOnly cookie. Correctly `false`-by-default for plain HTTP.
  - `CORS_ORIGINS` (`main.ts:29-31`) — the REST API's CORS allow-list, defaults to
    `http://localhost,http://localhost:80,http://127.0.0.1`. Also undocumented in `.env.example`.
- I did **not** print the actual values of any secret-bearing variable; the three above are
  non-secret feature flags / allow-lists, and their absence from `.env.example` is a documentation
  gap, not a credential exposure.

## 5. Backend TLS-adjacent configuration (`main.ts`, `dicomweb.controller.ts`)
- **Helmet**: `crossOriginResourcePolicy: { policy: 'same-site' }`, HSTS gated on `HSTS_ENABLED`.
  Already correctly written to "do the right thing" once `HSTS_ENABLED=true` is set — no code change
  needed there, only the env flip (after HTTPS is verified working, per your own stated order).
- **CORS**: an explicit allow-list (not "reflect any origin"), `credentials: true`. Adding an `https://`
  origin for the real deployment hostname will require extending `CORS_ORIGINS` — this is
  configuration, not code.
- **Cookie**: viewer-session cookie already reads `COOKIE_SECURE` to decide its `secure` flag
  (`dicomweb.controller.ts:51-60`), `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`. TLS-ready by
  design; only the env flag needs setting once HTTPS actually terminates at nginx.
- **JWT transport**: `jwt.strategy.ts` accepts the access token via Bearer header **or** the HttpOnly
  viewer cookie (`fromViewerCookie`). Neither mechanism is TLS-specific; both work identically over
  HTTP or HTTPS — the only change HTTPS brings is that the cookie's `secure` flag should then be `true`
  so it's never sent over a plaintext fallback.

## 6. Socket.IO / WebSocket
- Gateway: `@WebSocketGateway({ namespace: '/ws/notifications', cors: { origin: true, credentials: true } })`
  (`notifications.gateway.ts:20`). **This reflects any origin** — looser than the REST API's
  `CORS_ORIGINS` allow-list. This is a pre-existing gap, independent of TLS, worth tightening at the
  same time as this work (not required for TLS itself to function).
- Handshake authenticates via `client.handshake.auth.token` or an `Authorization` header (JWT,
  `jwt.verifyAsync`), rejecting unauthenticated sockets. Protocol-agnostic — works the same under
  `ws://` or `wss://`.
- Frontend client (`frontend/src/lib/notificationsSocket.ts`) connects via the **relative path**
  `io('/ws/notifications', ...)` — no hardcoded `http://`/`ws://` scheme, so it automatically follows
  the page's own protocol (`ws://` on HTTP, `wss://` on HTTPS) with **no code change required**.
- NGINX's `/socket.io/` location already sets `Upgrade`/`Connection` headers correctly
  (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection $connection_upgrade;`,
  `proxy_read_timeout 3600s`) and uses the same dynamic-DNS pattern — this location needs to exist
  unchanged inside whatever `443 ssl` server block is eventually added.

## 7. OHIF viewer (`ohif/app-config.js`, `ohif/ohif-nginx.conf`, `ohif/Dockerfile`)
- All three DICOMweb roots (`wadoUriRoot`/`qidoRoot`/`wadoRoot`) point at the **relative** path
  `/api/dicom-web` — same-origin, so they inherit whatever protocol the page itself loaded under. No
  hardcoded scheme.
- `requestOptions: { withCredentials: true }` — relies on the HttpOnly viewer-session cookie being
  sent automatically; this already works over HTTP and will continue to work over HTTPS once
  `COOKIE_SECURE=true` is set (a cookie marked `secure` is **never** sent over a plaintext fallback, so
  sequencing matters — see §3 of the implementation plan).
- No TLS-specific configuration exists in OHIF's own nginx (`ohif-nginx.conf`) — it only serves the
  built SPA; TLS termination for the whole stack happens at the **outer** `nginx` service, not here.

## 8. Orthanc DICOMweb / REST
- Orthanc (:8042) is **not published to the host** — reached only via the backend's authenticated
  proxy (`dicomweb.service.ts`) or directly by OHIF through nginx's `/dicom-web/` location (Basic-auth
  header passthrough, server-side credential, never exposed to the browser).
- Orthanc's REST/DICOMweb HTTP interface has no TLS of its own configured; it doesn't need one, since
  it's never reached directly from outside the Docker network — TLS termination at the outer nginx
  already protects every path that leaves the host.

## 9. DICOM networking (C-STORE :4242, MWL :4243) — explicitly NOT covered by HTTP/S TLS
- **Confirmed by inspection: no DICOM TLS (TLS-secured DICOM association) is configured anywhere** —
  no `DICOM_TLS`-style environment variable, no certificate reference in `mwl_scp.py`, no Orthanc
  TLS-DICOM setting in `docker-compose.yml`.
- C-STORE is Orthanc's own built-in SCP (`ORTHANC__DICOM_PORT: "4242"`); MWL is the custom
  `mwl-scp` Python/pynetdicom service (`MWL_PORT: "4243"`). Both ports are published with no bind
  address specified (defaults to all host interfaces).
- **HTTPS on the nginx-fronted web traffic does nothing to secure these two ports.** They are a
  separate, unencrypted DICOM-protocol network path and must be addressed separately (see §4 of the
  implementation plan and the open-questions document).

## 10. Health checks and service dependencies
- `backend` healthcheck: `wget ... http://127.0.0.1:3000/api/health` — **internal**, container-to-
  itself over plain HTTP on the Docker network; unaffected by any TLS added at the outer nginx (the
  backend itself never needs to speak TLS to its own healthcheck).
- `nginx` healthcheck: `wget ... http://127.0.0.1/healthz` — also internal/plaintext; if a future nginx
  config *forces* a redirect on every path including `/healthz`, this specific check would break unless
  `/healthz` is explicitly exempted (the existing `nginx-tls.conf.example` already does this correctly
  — `/healthz` is served directly in the `:80` redirect block, not redirected).
- `ohif` healthcheck: `wget ... http://127.0.0.1/viewer/` — internal, unaffected.
- None of the 8 services' healthchecks traverse the outer, publicly-reachable nginx listener, so none
  of them are put at risk by adding TLS there.

## 11. Hostname / DNS — none configured
- `server_name _;` (nginx catch-all) in both the live config and the TLS example.
- No hostname, FQDN, or domain string appears anywhere in `.env.example`, `.env`, or any compose/nginx
  file. The application is accessed as `http://localhost` (or the host's IP) in this environment.
- **This is a genuine gap requiring owner input** (see `F01_TLS_OPEN_QUESTIONS.md`) — I have not
  invented a hostname, certificate issuer, or IP address anywhere in this investigation or the plan
  that follows.

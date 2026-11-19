# F-01 IP-Based TLS — Stage 3: NGINX Design (No Config Changed)

**Status: DESIGN ONLY. `nginx/nginx.conf` has not been edited. No Docker Compose file has been
edited. No service was restarted.** This document specifies the exact changes a future
implementation step would make, building on the existing `nginx/nginx-tls.conf.example` template
(Phase 9) rather than writing a new design from scratch.

## 1. What changes, relative to the live `nginx/nginx.conf`

The live config has one `server { listen 80; server_name _; }` block. The design adds a **second**
`server` block for `443 ssl`, side by side with the existing `:80` block — **both active
simultaneously**, per your instruction to retain HTTP for rollback. No redirect is added from :80 to
:443 (explicitly deferred, per Stage 3's restriction).

```nginx
http {
  # ── everything currently in nginx.conf's http{} block stays IDENTICAL: ──
  include       /etc/nginx/mime.types;
  default_type  application/octet-stream;
  sendfile on;
  client_max_body_size 2g;

  resolver 127.0.0.11 valid=10s ipv6=off;        # UNCHANGED — load-bearing, see §3
  resolver_timeout 5s;
  proxy_connect_timeout 5s;
  proxy_send_timeout    60s;
  proxy_read_timeout    60s;

  map $http_upgrade $connection_upgrade {         # UNCHANGED
    default upgrade;
    ''      close;
  }

  # ── EXISTING block, UNCHANGED, no redirect added ──
  server {
    listen 80;
    server_name _;
    location = /healthz { return 200 "ok\n"; add_header Content-Type text/plain; }
    location /socket.io/ { ... }       # identical to today
    location /api/dicom-web/ { ... }   # identical to today
    location /api/ { ... }             # identical to today
    location /dicom-web/ { ... }       # identical to today
    location /viewer/ { ... }          # identical to today
    location / { ... }                 # identical to today — SPA + existing security headers
  }

  # ── NEW block, added alongside the above, not replacing it ──
  server {
    listen 443 ssl;
    http2 on;
    server_name _;                     # matches the live config's own pattern — IP access, no name

    ssl_certificate     /etc/nginx/certs/server.crt;
    ssl_certificate_key /etc/nginx/certs/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;

    # NO "add_header Strict-Transport-Security ..." line yet — Stage 3 explicitly defers HSTS.

    # Every location block below is a byte-for-byte COPY of the :80 block's locations.
    # This is the key design point: none of them change for TLS — same dynamic-DNS
    # $upstream_* variables, same proxy_set_header lines, same timeouts/buffering flags.
    location = /healthz { return 200 "ok\n"; add_header Content-Type text/plain; }
    location /socket.io/ { ... }       # identical content to the :80 block
    location /api/dicom-web/ { ... }   # identical content to the :80 block
    location /api/ { ... }             # identical content to the :80 block
    location /dicom-web/ { ... }       # identical content to the :80 block
    location /viewer/ { ... }          # identical content to the :80 block
    location / { ... }                 # identical content to the :80 block (existing security headers kept)
  }
}
```

**Why duplicate the location blocks rather than share them via an `include`:** nginx has no native
"shared location set across server blocks" construct without an `include` file; introducing one would
be a structural refactor of a file every prior phase has treated as a single reviewed unit. For this
plan, exact duplication (copy-paste of the proven :80 blocks into the new :443 block) is the lower-risk
choice — it's mechanically verifiable (`diff` the two location sets) rather than relying on an
abstraction that has never been exercised in this project. This can be revisited later as a
pure-refactor, non-functional cleanup, separately from enabling TLS.

## 2. Docker Compose changes required (not applied)

```yaml
# nginx service — additive only, nothing removed:
nginx:
  ports:
    - "${NGINX_PORT}:80"        # UNCHANGED — retained exactly as today
    - "${NGINX_TLS_PORT}:443"   # NEW — NGINX_TLS_PORT already exists in .env.example (=443), just unused
  volumes:
    - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro   # UNCHANGED
    - ./nginx/certs:/etc/nginx/certs:ro               # NEW — read-only mount of the Stage 2 cert/key
                                                         # directory (NOT the user-profile location
                                                         # where the private key itself is generated
                                                         # and ACL-locked — see §3 of the cert plan;
                                                         # only a COPY intended for container use would
                                                         # live under ./nginx/certs, and that directory
                                                         # would itself need .gitignore coverage + host
                                                         # permission review before any real deployment)
```

No other service's compose definition changes. No volume is removed. No port mapping is removed.

## 3. Preserving the dynamic-DNS resolver and upstream pattern

The entire reason the Phase 5 fix exists — `resolver 127.0.0.11 valid=10s ipv6=off;` plus
`set $upstream_X <service>; proxy_pass http://$upstream_X:<port>$request_uri;` in every location — is
to prevent stale-IP 502s after a container recreate. This pattern is **declared once, at the `http{}`
level**, and every location block (in both the :80 and the new :443 server) reads from it identically.
**Nothing about adding a 443 listener changes this**: the new server block's locations use the exact
same `set $upstream_X ...` lines as their :80 counterparts, so TLS termination has zero interaction
with upstream resolution — nginx resolves `backend`/`orthanc`/`ohif`/`frontend` the same way
regardless of which port the client connected to.

## 4. Existing route behavior under :443 — explicitly unchanged in this stage

Per your instruction, this stage does **not** enable:
- **Redirect** from :80 to :443 (no `return 301 https://...` block is added to the :80 server) —
  both ports serve the application independently; a client choosing :80 gets plain HTTP exactly as
  today, a client choosing :443 gets the same application over TLS.
- **HSTS** — no `Strict-Transport-Security` header anywhere, on either port.
- **Secure cookies** — `COOKIE_SECURE` stays `false` (or unset); the OHIF viewer-session cookie's
  `secure` flag is unchanged, so it is sent over both :80 and :443 for now. (The prior F-01 planning
  document already flagged exactly why flipping this prematurely is harmful — same reasoning holds
  here, and this stage is deliberately structured not to need that flip yet.)

This means React/API/OHIF/DICOMweb/Socket.IO all become reachable over **both** protocols
simultaneously once this design is implemented, with no behavioral change to any of them beyond the
transport they're reached over — exactly the "retained for rollback" posture requested.

## 5. Rollback (if this design were implemented and needed to be undone)

Because the :80 block is untouched and no redirect/HSTS/secure-cookie flag is flipped, rollback is
simply: remove the new `server { listen 443 ssl; ... }` block, remove the `"${NGINX_TLS_PORT}:443"`
port mapping and the certs volume mount, and reload/recreate nginx. **No other service, no database,
no cookie, and no client-side state is affected** — nothing on :80 ever changed, so there is nothing
to revert there. This is a materially simpler rollback than the full redirect+HSTS+secure-cookie
end-state the earlier `F01_TLS_IMPLEMENTATION_PLAN.md` describes, precisely because this stage adds a
parallel listener rather than cutting traffic over.

## 6. What this design explicitly does not include (deferred)

- HTTP→HTTPS redirect (Stage 3 restriction).
- HSTS header (Stage 3 restriction).
- `COOKIE_SECURE=true` / `HSTS_ENABLED=true` (Stage 3 restriction; also the correct order per the
  prior planning document — these should only follow full compatibility verification).
- Socket.IO gateway CORS tightening (unrelated pre-existing gap, noted in the prior F-01 planning
  document, not part of this IP-TLS design).
- Any DICOM port (:4242/:4243) change — untouched, as instructed.

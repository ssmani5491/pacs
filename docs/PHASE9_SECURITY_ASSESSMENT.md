# Phase 9 — Security Assessment (2026-11-14)

Defensive assessment (OWASP API Top 10 as reference). Safe payloads only; no destructive testing;
no clinical records modified. Secret VALUES are never printed here.

Severity: CRITICAL / HIGH / MEDIUM / LOW / INFORMATIONAL.

## Summary
| ID | Severity | Component | Status |
|---|---|---|---|
| SEC-1 | — (not a finding) | DICOMweb proxy path handling | CONFIRMED SAFE on retest |
| SEC-2 | MEDIUM | Backend CORS | **FIXED + retested** |
| SEC-3 | LOW | HSTS on plain HTTP | **FIXED + retested** |
| SEC-4 | LOW | SPA missing security headers | **FIXED + retested** |
| SEC-5 | INFORMATIONAL | Service port exposure | Reviewed — correct (internal-only) |
| SEC-6 | LOW | DICOM ports bound to 0.0.0.0 | Documented (deployment hardening) |
| SEC-7/8/9 | — | Secrets exposure | No exposure found (PASS) |

No CRITICAL or HIGH findings. Several defense-in-depth improvements made and retested.

---

## A. Authentication security — PASS
| Check | Result | Evidence |
|---|---|---|
| Refresh-token rotation | PASS | refresh returns a new RT that differs from the old |
| Reuse-after-rotation | PASS | reusing the old refresh token after rotation → **401** |
| Logout revocation | PASS | refresh after logout → **401** |
| Account lockout | PASS | 5 failed logins → "Account temporarily locked" (15 min); correct password rejected while locked |
| Missing / malformed / garbage token | PASS | all → **401** |
| Wrong token type (refresh used as access) | PASS | → **401** (`type !== 'access'` enforced) |
| Password hashing | PASS | argon2id + pepper (Phase 1); login ~180 ms by design |
| JWT TTLs | PASS | access 900 s (15 min), refresh 604800 s (7 days) — sensible |

Refresh tokens are tracked/revoked in Redis; rotation invalidates the prior token. No replay.

## B. Authorization / RBAC / object-level (BOLA) — PASS
- **Cross-org object access blocked** (rad_tcl → GGH objects by ID):
  patient **404**, order **403**, report **403**, report-by-study **403**, versions **403**, PDF **403**.
- **Permission enforcement**: receptionist → report.create/audit.view/system.dashboard/org.manage all
  **403**; radiologist → audit.export/user.manage/system.jobs all **403**.
- **Mass assignment**: recept1 (GGH) tried to create a patient with injected `organizationId=TCL` →
  server **forced the patient into recept1's own GGH org** (injection ignored). No privilege escalation.
- Org isolation verified across patients, orders, studies, reports, notifications, DICOMweb (Phase 6–8
  tests still pass).

## C. OWASP API — injection / traversal / CORS / validation
| Check | Result | Evidence |
|---|---|---|
| SQL injection | SAFE | `' OR '1'='1`, `';DROP TABLE patients;--` in search params → treated as literal strings (200); patients table intact (1005 rows). Prisma parameterizes. |
| Input validation / mass-assignment | SAFE | unknown/`__proto__` fields → rejected (ValidationPipe `forbidNonWhitelisted`) |
| Excessive data exposure | SAFE | login returns only tokens; `/auth/me` has no password/secret/hash; passwordHash never serialized |
| Error leakage | SAFE | malformed JSON → clean 400 message, no stack trace |
| Rate limiting | PARTIAL | login has account lockout (5/15min); no global IP rate-limit on other endpoints — documented below |

### SEC-1 (not a finding) — DICOMweb proxy path traversal — CONFIRMED SAFE
- **Tested**: `/api/dicom-web/..%2f..%2fsystem`, `..%2f..%2fstatistics`, `..%2f..%2fpatients`.
- **Result**: all returned the **frontend SPA HTML** (200), NOT Orthanc data. The encoded traversal
  resolves to a path nginx routes to the SPA catch-all; it never reaches Orthanc's admin API. The
  backend proxy only forwards `/dicom-web`-prefixed paths with server-side credentials; Orthanc's
  HTTP admin (8042) is not published and not reachable from the browser. **No traversal to Orthanc
  admin is possible.** Retest = SAFE.

### SEC-2 (MEDIUM) — CORS reflected any origin with credentials — FIXED + RETESTED
- **Evidence (before)**: `Origin: http://evil.example` → `Access-Control-Allow-Origin: http://evil.example`
  with `Access-Control-Allow-Credentials: true` (`enableCors({ origin: true, credentials: true })`).
- **Risk**: a credentialed cross-origin request could be permitted from any site. Partly mitigated
  because the API uses Bearer tokens (not cookies) for normal calls and the viewer cookie is
  HttpOnly+SameSite=Lax, but reflect-any-origin is still a misconfiguration.
- **Fix**: `backend/src/main.ts` — CORS restricted to a configurable allow-list (`CORS_ORIGINS`,
  default `http://localhost,http://localhost:80,http://127.0.0.1`); no-Origin (same-origin/curl)
  allowed; unknown origins get no CORS headers.
- **Retest**: evil origin → **no ACAO header** (blocked); `http://localhost` → ACAO `http://localhost`;
  app works same-origin (health 200, login 200). No functional regression.

### SEC-3 (LOW) — HSTS sent over plain HTTP — FIXED + RETESTED
- **Evidence**: `Strict-Transport-Security: max-age=15552000` on `http://` responses (helmet default).
  The brief forbids HSTS in local HTTP mode.
- **Fix**: helmet `hsts` disabled unless `HSTS_ENABLED=true` (set only when TLS terminates). See
  `nginx/nginx-tls.conf.example` which adds HSTS correctly in the HTTPS server block.
- **Retest**: HSTS header **absent** on HTTP responses. App unaffected.

### SEC-4 (LOW) — SPA served without security headers — FIXED + RETESTED
- **Evidence**: `GET /` (frontend) had no X-Frame-Options / X-Content-Type-Options / Referrer-Policy /
  CSP (only the API, via helmet, had them).
- **Fix**: nginx `/` location now adds X-Frame-Options SAMEORIGIN, X-Content-Type-Options nosniff,
  Referrer-Policy no-referrer, and a SPA CSP. OHIF (`/viewer/`, separate location) is intentionally
  unconstrained.
- **Retest**: all four headers present on `/`; SPA still loads (200, assets resolve); viewer still
  loads (200). No regression.

### Rate limiting (LOW, documented)
- Login is protected by account lockout. Other endpoints have no global per-IP rate limit. For a
  single-institution local deployment behind the hospital network this is acceptable; a production
  deployment should add an nginx `limit_req` zone on `/api/`. Documented, not applied (avoids changing
  request behavior under the brief's "do not change required connectivity without documenting" rule).

## D. Secrets management — PASS
- Secret **values** (POSTGRES_PASSWORD, JWT_ACCESS_SECRET, ORTHANC_PASSWORD) **NOT FOUND** in the
  frontend bundle (`/usr/share/nginx/html`). The only "password" string in the bundle is UI field text.
- Login response = tokens only; `/auth/me` exposes no secret/hash; Orthanc basic-auth not leaked in
  proxy response headers.
- Not a git repo locally → nothing committed to source control; `.env` is already in `.gitignore`.
- Orthanc/PG/Redis credentials remain server-side (env, Docker network only).

## E. Network security — reviewed
- **Internal-only (no host binding)**: backend 3000, frontend 80, ohif 80, **orthanc HTTP admin 8042
  (NOT published)**, **postgres 5432**, **redis 6379**. Correct — not reachable from the host/LAN.
- **Published to host**: nginx :80 (required), DICOM C-STORE :4242, MWL SCP :4243.

### SEC-6 (LOW) — DICOM ports bound to 0.0.0.0 — documented (not changed)
- `4242`/`4243` publish to `0.0.0.0` (all host interfaces). Required so real modalities on the LAN can
  reach C-STORE/MWL. Narrowing to a specific modality interface/VLAN or `127.0.0.1` would break real
  DICOM connectivity, so **not changed** per the brief. Production hardening recommendation: bind to
  the modality VLAN interface and/or add AE-title allow-listing at the SCP (MWL SCP already validates
  the called-AE; C-STORE currently accepts any calling AE — see DICOM security doc).

## F. Security headers & TLS — addressed
- API headers (helmet): CSP, Referrer-Policy, X-Content-Type-Options, X-Frame-Options present; HSTS now
  gated behind HTTPS (SEC-3). SPA headers added (SEC-4).
- **TLS-ready config prepared**: `nginx/nginx-tls.conf.example` (HTTP→HTTPS redirect, TLS1.2/1.3, HSTS
  in the HTTPS block only, same dynamic-DNS upstreams). Not wired into compose (local is HTTP).
- Viewer cookie: HttpOnly + SameSite=Lax + path-scoped + 30-min maxAge; `secure` flag via `COOKIE_SECURE`
  env for HTTPS.

## Remaining risks (documented, not fixed)
- No global per-IP rate limiting (login lockout only). LOW for local deployment; add nginx `limit_req`
  in production.
- C-STORE SCP accepts any calling AE title (see PHASE9 DICOM security). MWL SCP validates called-AE.
- Redis `maxmemory=0` (no eviction) — intentionally unbounded to protect auth state; production should
  bound with `noeviction` (see PHASE9_PERFORMANCE.md REL-2).

## G. DICOM security (Stage 5) — tested with synthetic data
All tests used synthetic studies (MRN SECTEST001 / DUPTEST001); no existing clinical study was
modified or deleted.

| # | Test | Result | Evidence |
|---|---|---|---|
| DICOM-1 | Unauthorized AE title (MWL C-FIND, called-AE `BADAE`) | PASS | association **REJECTED**; correct `GGHMWL` establishes |
| DICOM-2 | DICOMweb proxy — missing / invalid / valid JWT | PASS | 401 / 401 / 200 |
| DICOM-3 | Expired JWT (valid signature, past exp) | PASS | **401** |
| DICOM-4 | Forged JWT (wrong secret, claims isSuperAdmin) | PASS | **401** — signature check holds, admin cannot be forged |
| DICOM-5 | Cross-org study access via proxy (rad_tcl → GGH study) | PASS | **403** |
| DICOM-6 | Authorized C-STORE (synthetic 6-instance study) | PASS | association established, 6/6 stored |
| DICOM-7 | Duplicate instance handling (3 identical SOP UIDs sent twice) | PASS | Orthanc added **3 net instances, not 6** (dedup by SOP Instance UID); both associations ack'd |
| DICOM-8 | Unmatched study handling | PASS | study ingested as **ORPHAN** (reception log ORPHAN, isReconciled=false), queued for reconciliation, **ORPHAN_STUDY notification generated** |
| — | Orthanc HTTP admin requires auth | PASS | unauthenticated `/system` → 401 |
| — | Orthanc admin port (8042) not host-exposed | PASS | `localhost:8042` → connection refused |

**DICOM security findings**
- **DICOM-SEC-1 (LOW, documented)**: the **C-STORE SCP (Orthanc, 4242) accepts any calling AE title** —
  there is no AE allow-list. In a hospital this is often acceptable behind a modality VLAN, but a
  production hardening step is to enable Orthanc `DicomModalities` + `DicomCheckCalledAet` / an AE
  allow-list so only known modalities can push. The **MWL SCP already validates the called-AE**. Not
  changed here to avoid breaking existing synthetic/modality connectivity; documented for production.
- DICOMweb proxy authorization, org isolation, expired/forged-token rejection, duplicate dedup, and
  orphan/reconciliation flow are all enforced.

**Not production-ready on tests alone**: these improvements raise the security posture, but a formal
pentest, TLS enablement, and infra hardening remain before any real-patient production use.

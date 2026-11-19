# Independent RIS/PACS — Technical Audit

**Scope:** Phases 1–9 + PACS Operations Modules 1–5. **Method:** independent, read-only inspection of
source code, Prisma schema + migrations 0001–0010, `docker-compose.yml`, `nginx/nginx.conf`, API
controllers/services, frontend routes, RBAC definitions, and live DB/Orthanc state. Prior test reports
and PROGRESS.md were treated as **claims to verify**, not evidence.

**Restrictions honored:** no code/config/schema/data modified; no migration applied; no container reset;
no DICOM/archive/report/signature altered; no destructive command; no user/test-data created; no secret
values reproduced.

Findings are in `INDEPENDENT_RIS_PACS_FINDINGS_REGISTER.md` (IDs F-01…F-16). This document gives the
per-area assessment and the executive summary.

---

## Area 1 — Architecture
**Assessment: Solid for a dev/on-prem single-host deployment; not hardened for production scale/HA.**
Verified: 8 Docker services (postgres, redis, orthanc, backend, mwl-scp, frontend, ohif, nginx), named
volumes (`pg_data`, `redis_data`, `orthanc_storage`, `app_logs`, `pacs_archive`), `restart:
unless-stopped`, log rotation (10m×5), healthchecks on every service with a healthcheck, **no hardcoded
container IPs**, NGINX **dynamic DNS `resolver 127.0.0.11`** + variable upstreams (confirmed in config
and live container). Orthanc :8042 is **not** published to the host (reached via the authenticated
backend proxy). Background work runs in-process (`@nestjs/schedule` + Redis locks) — no 9th service.
Gaps: **no container resource limits (F-06)**; single-host = inherent SPOF for each service (no HA/replication);
DICOM ports on 0.0.0.0 (F-08).

## Area 2 — Authentication & Authorization
**Assessment: Strong application-layer auth; two deployment-level credential/transport gaps.**
Verified sound: argon2id+pepper, 5/15-min lockout, refresh rotation + revocation, logout revoke-all,
password-change forces re-login, JWT `active`-check + token-type enforcement, RBAC AND-gate with
super_admin bypass, OR-gate correctly pushed into the service for Module 4/5. Routes without a
permission decorator still require authentication (global `JwtAuthGuard`). No BOLA/mass-assignment was
observed in the sensitive endpoints reviewed (org/ownership checks via `assertOrg`). **Gaps:** default
super-admin credential active (**F-02**); no API rate limiting incl. `/auth/login` (**F-07**); plaintext
transport (**F-01**). `logout` uses `redis.keys` (**F-10**, minor).

## Area 3 — Organization Isolation
**Assessment: Consistent in code; not empirically proven across two populated orgs.**
`orgScope`/`assertOrg` applied across patients/orders/worklist/studies/reports/reverse-push/archive/
storage/history; DICOMweb enforces per-study + allowed-study filtering; Module 5 study aggregate returns
**404 (not 403)** for a cross-org/NULL-org study (no existence leak — a good design choice). NULL-org
orphan studies are invisible to org-scoped users by design. **Limitation (F-14):** only one populated
org exists, so cross-org leakage between two real orgs is reviewed-but-not-demonstrated.

## Area 4 — DICOM & Orthanc Security
**Assessment: Functionally correct; network-exposure and calling-AE controls are deployment decisions.**
DICOMweb through the backend is authenticated + org-isolated, Orthanc creds server-side. MWL SCP
validates the **called** AE (rejects wrong AE) but accepts any **calling** AE. C-STORE is Orthanc's own
listener, which **accepts any calling AE** by default. Reverse-push SSRF guard exists but is a
**denylist without DNS resolution / private-range blocking (F-03)**. DICOM ports bound 0.0.0.0 (**F-08**).
UID validation present in the Module 5 study aggregate (numeric, ≤64, malformed→400). Not tested
(read-only): malformed-dataset handling, duplicate/conflicting UID behavior under live C-STORE.

## Area 5 — Clinical Data Integrity
**Assessment: Strong.** Locked/FINAL reports are immutable (`ConflictException` on edit/re-sign/delete);
addenda are separate linked rows (original preserved); signatures carry a SHA-256 over content+signer+
version; audit logging is append-only via `AuditService`; study↔order↔patient relationships maintained
on ingest; duplicate ingestion handled (Phase 4 orphan/reconcile path). No route was found that mutates
a signed report in place. (Not destructively tested — no signed record was touched.)

## Area 6 — PACS Operations Modules 1–5
- **M1 Reverse Push:** destination CRUD, real C-ECHO/C-STORE via Orthanc SCU, per-instance tracking,
  retry/cancel/pause/resume, restart recovery, org isolation present. SSRF denylist weakness (F-03).
- **M2 Archive:** Orthanc ZIP + gzip, SHA-256 + gunzip + entry-count verify, verified-overwrite
  protection, interrupted-job recovery, copy-only (originals untouched). Sound.
- **M3 Storage:** real Orthanc `/statistics` + per-study DiskSize + `statfs` disk usage + archive walk;
  linear growth/forecast; threshold alerts reuse Phase 8. Values reflect the real filesystem/Orthanc
  (verified against live numbers). Read-only over the data plane.
- **M4 History:** unified read-only union with per-source RBAC OR-gate, org isolation, patient
  redaction, server-side pagination/sort/filter, formula-injection-safe CSV, non-mutating re-verify.
  Minor null-sort nuance (F-15).
- **M5 Integration:** Command Centre (permission-gated tiles; totals reconciled to M4), per-study
  aggregate (404-no-leak, patient-gated, source-RBAC), Exceptions Console (CONFIRMED/HEURISTIC/
  INFRASTRUCTURE; recovery via **existing** endpoints only; interrupted heuristic **non-mutating**),
  integrity-failure notification (deduped, HIGH, org-scoped, success emits none). Verified the heuristic
  does not mutate jobs and is not presented as a confirmed failure. **Test-data contamination of the
  Command Centre (F-04).**

## Area 7 — Database & Migrations
**Assessment: Clean, additive, consistent.** 10 migrations (0001–0010), ordered, additive; the recurring
`search_tsv` drop was permanently neutralized (declared `Unsupported("tsvector")` + GIN, Phase 4) — **no
DROP of `studies_search_tsv_idx` in any migration**, index present in the live DB. FKs, unique
constraints, and indexes on hot columns (status, org+createdAt, studyInstanceUid) present. **Scale
(analytical, NOT load-tested at volume):** worklist/history use indexed pagination and are sub-50ms at
~5k studies; at 100k/500k/1M studies the main risks are (a) count(*) over large filtered sets for
pagination totals, (b) the in-memory per-source merge in Module 4/5 unified lists (bounded by
`page·pageSize` fetch per source), and (c) CSV export capped at 10k rows. These are design-bounded but
unproven at 1M rows (**F-13**).

## Area 8 — Application Security
**Assessment: Good app-layer hygiene; transport + edge controls missing.**
helmet enabled (CORP same-site for DICOMweb), CORS restricted to a configurable allow-list, HSTS gated
on HTTPS, SPA CSP + X-Frame-Options/nosniff/Referrer-Policy in nginx. CSV exports are
formula-injection-safe. Prisma parameterizes queries (no string-built SQL observed). **Missing:** TLS
(F-01), rate limiting (F-07); SSRF denylist weak (F-03). Secrets are placeholder-only in
`.env.example`; `.env` gitignored. No secret values are exposed by the reviewed error handlers (generic
messages).

## Area 9 — Performance & Reliability
**Assessment: Reasonable at current scale; HA and limits absent; stress NOT TESTED.**
Prisma connection pooling via the client; indexed reads; OHIF progressive load (Phase 6, ~1.6s first
image at 2000 slices); Redis locks for scheduler serialization; restart-recovery for both transfer and
archive jobs. **Absent:** container resource limits (F-06), Redis maxmemory policy (F-12). **NOT TESTED**
(read-only): 6,600-instance study, concurrent C-STORE/MWL, simultaneous archive/reverse-push jobs,
Redis/Postgres outage, disk-full, OOM, full Orthanc restore (F-13).

## Area 10 — Backup & Disaster Recovery
**Assessment: Incomplete — the most material operational gap (F-05).** Only ad-hoc RIS Postgres `.sql.gz`
dumps exist; **no automated/scheduled backup**, and **no backup of the Orthanc index DB, the
orthanc_storage DICOM volume, or the pacs_archive volume**. A restore runbook is documented
(`PHASE9_BACKUP_RESTORE.md`) and an isolated RIS restore was previously exercised, but off-host/offsite
storage and full-asset coverage are absent. A volume loss would be unrecoverable for imaging data.

## Area 11 — Code & Test Quality
**Assessment: Clean, consistent code; test tiers should be labeled and fixtures isolated.** Naming and
module boundaries are consistent; error handling uses typed Nest exceptions; the notification path is
deliberately non-throwing. **Findings:** backend Jest is **mock-based unit testing** (F-09) — real
integration coverage is the Playwright suite (which does exercise live services); **synthetic test
records persist in operational tables and contaminate dashboards** (F-04). Tests are repeatable
(idempotent seeds) and include negative security cases (403/404/redaction/injection) at the Playwright
tier.

---

# Executive Summary

1. **Architecture:** Sound single-host, 8-service design with correct dynamic-DNS proxying and volume
   layout; lacks resource limits and HA. Appropriate for on-prem dev/pilot, not yet for resilient
   production.
2. **Security:** Strong application-layer auth and RBAC; **blocked by two deployment issues — no TLS
   (F-01) and an active default admin credential (F-02)** — plus no rate limiting (F-07) and a weak SSRF
   denylist (F-03).
3. **Clinical data integrity:** Strong — signed-report immutability, addenda, append-only audit, and
   consistent relationships all verified in code.
4. **DICOM/PACS:** Functionally correct and org-isolated through the backend; **network exposure and
   any-calling-AE acceptance are production decisions (F-08)**; SSRF guard needs strengthening (F-03).
5. **Database:** Clean, additive, consistent migrations; GIN index preserved; scale beyond ~5k studies
   is analytically bounded but **not load-tested to 1M (F-13)**.
6. **Performance/reliability:** Adequate now; **resource limits and Redis policy missing (F-06/F-12)**;
   high-volume and fault scenarios **NOT TESTED**.
7. **Backup/DR:** **Incomplete and the top operational risk — imaging/archive volumes are unprotected
   (F-05).**
8. **Production blockers:** F-01 (TLS), F-02 (default admin credential), F-05 (DICOM/archive backups),
   and — depending on the deployment network — F-08 (DICOM exposure / any calling AE).
9. **Recommended remediation order:**
   1. F-02 (rotate/force-change the default admin; remove the default from non-dev).
   2. F-01 (enable TLS + HSTS).
   3. F-05 (automated off-host backups for all five assets + tested restore).
   4. F-08 (bind DICOM ports to the trusted interface; Orthanc/MWL calling-AE allow-list).
   5. F-07 (rate limiting on `/auth/*` and the API), F-03 (SSRF allow-list / private-range block).
   6. F-06 + F-12 (resource limits; Redis maxmemory policy).
   7. F-04 (isolate/purge synthetic test records so dashboards are trustworthy).
   8. F-13/F-14 (run load/fault scenarios; validate with two populated orgs).
10. **Final deployment recommendation:** **NOT production-ready as-is.** The implementation is
    functionally complete and internally well-engineered across all phases/modules, and the development
    test suites pass — but passing dev tests does **not** establish production readiness. Clear the
    production blockers (F-01, F-02, F-05, and F-08 per network), then address the high/medium hardening
    items and run the untested scale/fault/multi-org scenarios in a disposable environment before any
    clinical use. Suitable now for **internal dev / isolated pilot** on a trusted network.

---

## Verification confidence & limits
- **VERIFIED** findings were observed directly in source/config or the live DB during this audit.
- **NOT TESTED** items (F-13, parts of F-12) require stress/fault injection that is out of scope for a
  read-only audit and would risk the running system.
- **F-14** (multi-org) is code-reviewed as consistent but cannot be empirically proven with a single
  populated organization; this is stated rather than assumed resolved.
- No prior test report was taken at face value: the 44/44 unit and 70/70 Playwright claims were
  cross-checked by inspecting the test tier (mock vs real) and are characterized accordingly (F-09),
  not restated as proof of production readiness.

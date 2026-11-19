# F-01 TLS/HTTPS — Open Questions Requiring Owner Input

None of these were assumed or invented during the investigation. The implementation plan cannot be
finalized, and no certificate work should start, until these are answered.

## A. Hostname and DNS
1. What hostname(s) will hospital staff actually type or be redirected to (e.g.
   `pacs.hospital.local`, `ris.hospital.internal`, an IP address, or something else)? **Nothing in the
   current configuration specifies one** — every nginx block uses `server_name _;` and the app is
   reached as `http://localhost` today.
2. Is there an internal DNS zone that already resolves that hostname to this host, or would DNS
   records need to be created as part of this rollout?
3. Will any client ever reach the application by **raw IP address** (not hostname)? If so, the
   certificate must include that IP as a Subject Alternative Name (SANs cannot assume DNS-only
   access).
4. Is there more than one hostname/IP this needs to work under (e.g. a different name for internal
   vs. VPN access)? Each one needs to be a certificate SAN.

## B. Certificate authority and trust
5. Does the hospital already operate an internal Certificate Authority (e.g. Active Directory
   Certificate Services, a dedicated internal CA appliance)? If yes, who administers it and what is
   the request process?
6. If an internal CA exists, are the hospital's Windows client machines already configured (via Group
   Policy or manual trust store installation) to trust it? If not, deploying a cert signed by it will
   still show "untrusted" warnings in browsers until that trust is distributed.
7. Is a **public** CA certificate realistic for this hostname? That requires the hostname to be
   publicly resolvable and reachable for domain validation (HTTP-01/DNS-01) — confirm whether this
   server has any public internet exposure at all, or is purely internal/air-gapped. (The brief says
   not to assume Let's Encrypt availability; this question exists specifically to find out, not to
   assume it either way.)
8. If neither an internal CA nor a public CA is viable right now, is a **self-signed certificate** (as
   a controlled, temporary fallback) acceptable, understanding every client will need to manually
   trust it and see a one-time warning otherwise?

## C. Certificate lifecycle
9. Who is responsible for certificate renewal once issued — an IT team process, an automated tool, or
   manual action by whoever runs this stack?
10. What is the organization's expected certificate validity period (public CAs now cap at ~398 days;
    an internal CA may allow longer) — does this match an existing internal policy?
11. Is there an existing monitoring/alerting system that should be told about certificate expiry, or
    does one need to be set up as part of this work?

## D. Network and client environment
12. Are hospital client machines joined to a domain where group policy can push trust-store changes
    centrally, or are they unmanaged/standalone machines?
13. Will the modalities (CT/MR/US scanners etc.) performing C-STORE/MWL ever need to traverse a
    network boundary that would benefit from DICOM TLS, or are they on an isolated, trusted clinical
    VLAN with no untrusted hop between modality and this server? This determines whether DICOM-TLS
    work (§4 of the implementation plan) is urgent, optional, or out of scope entirely.
14. Do any of the actual modalities in use support DICOM TLS (many legacy modalities do not, and
    forcing it can break connectivity)? This cannot be answered from the codebase — it depends on the
    real hardware deployed, which this investigation has no visibility into.

## E. Deployment process
15. Is there a maintenance window process for this application, or can a TLS cutover happen at any
    time? This affects how the rollback plan should be sequenced.
16. Should HTTP continue to work at all after HTTPS is enabled (e.g. for internal health-check
    tooling that isn't TLS-aware), or should it redirect/close entirely? The existing
    `nginx-tls.conf.example` template redirects all HTTP to HTTPS except `/healthz` — confirm this
    matches what's wanted.

---

**Until A1–A4, B5–B8, and C9–C11 are answered, the implementation plan cannot recommend a specific
certificate strategy with confidence** — it can only lay out the three options (A/B/C) and what each
would require, which is what `F01_TLS_IMPLEMENTATION_PLAN.md` does.

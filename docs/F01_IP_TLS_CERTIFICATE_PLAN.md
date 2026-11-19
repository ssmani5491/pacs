# F-01 IP-Based TLS — Stage 2: Certificate Plan (No Certificate Generated)

**Status: PLAN ONLY.** No certificate, key, or CA material was generated. Everywhere this plan needs
"the server's static IP," it is written as a placeholder `<SERVER_IP>` to be substituted once Stage 1's
finding is resolved (see `F01_IP_TLS_NETWORK_VERIFICATION.md` — no real, routable IP exists on this
host today).

## 1. Certificate subject design — IP SAN, not a hostname

Per your decision (no hostname, direct IP access), the certificate must **not** rely on a
`CN=`/hostname SAN at all for TLS validation — modern clients (and OpenSSL ≥ 1.1.1 / all current
browsers) require the IP to appear as an explicit **`IP Address` Subject Alternative Name**, not just
in the Common Name field (CN-only matching for IPs has been deprecated/ignored by browsers for years).

```
Subject:            CN=<SERVER_IP> (informational only; browsers ignore CN for validation)
Subject Alt Names:  IP Address: <SERVER_IP>
                     (optionally also: IP Address: 127.0.0.1, DNS: localhost — see §4)
Key type:           RSA 2048-bit minimum, or ECDSA P-256 (either matches the existing
                     nginx-tls.conf.example's `ssl_ciphers HIGH:!aNULL:!MD5` + TLSv1.2/1.3 config)
Validity:           Operator-controlled since this is self-signed (see §5 for the recommended period)
```

## 2. Certificate authority / trust approach

Per your decision this is a **controlled self-signed certificate** — consistent with the prior F-01
TLS planning document's Option C (self-signed, as a controlled, explicitly temporary approach, used
here because there is no hospital internal CA established and no public-CA reachability for an
internal PACS). Concretely:

- Generate **one self-signed root** (acts as its own CA for this purpose) with the IP SAN above —
  simplest approach, matches "controlled self-signed" exactly as stated.
- **Trust distribution is a hospital-IT action, not a technical step this plan can perform**: every
  client workstation that will access `https://<SERVER_IP>` needs this certificate imported into its
  trusted root store (Windows: Certificate Manager, or pushed via Group Policy if domain-joined — see
  the open question in the original F01_TLS_OPEN_QUESTIONS.md about domain management, still
  unanswered and still relevant here). Until that import happens, every browser will show an
  "untrusted certificate" warning — expected and inherent to self-signed certs, not a misconfiguration.
- If the hospital later stands up an internal CA (Stage 1's unresolved open question B5/B6 from the
  prior planning round), the same IP-SAN design carries over unchanged — only the signer changes from
  "self" to "the internal CA." This plan does not need to be redone, only re-issued.

## 3. Private key protection (outside the repository, restrictive permissions)

Directly reusing the pattern already established and verified working in this project's F-02 work
(the test-credentials file move + `icacls` lockdown):

- **Location**: `C:\Users\<operator>\pacs-tls\` (or an equivalent path **outside**
  `D:\GG Project\Pacs_13-11\`) — never under the project tree, for the same reason the F-02 credential
  file was moved: the project directory inherits broader NTFS ACLs than a user-profile-scoped
  location.
- **Files**: `server.key` (private key, never leaves this location), `server.crt` (certificate, safe
  to be world-readable since it's public by nature), `server.csr` (if a CSR step is used, not strictly
  needed for self-signed).
- **NTFS permissions on `server.key`** (same `icacls` pattern as the F-02 remediation):
  ```
  icacls server.key /inheritance:r
  icacls server.key /grant:r "<operator-account>:(R)"
  icacls server.key /grant:r "SYSTEM:(F)"
  icacls server.key /grant:r "Administrators:(F)"
  ```
  Result: no `BUILTIN\Users`, no `Authenticated Users` — exactly the gap closed for the credentials
  file is closed here too, before this key is ever created.
- **Mounted into the nginx container read-only** (`:ro` bind mount in `docker-compose.yml`, additive —
  see the nginx implementation document) so the container itself never needs write access, and the
  key is never copied into the image or committed to source.
- **`.gitignore` coverage**: add the key/cert directory pattern now, in advance of generation (the
  project already has this habit from the credential-file remediation) — even though this project has
  no `.git` repository today, the pattern should exist so it's correct the moment one is initialized.

## 4. SAN scope — exactly one IP, plus optional local-access entries

- **Required**: `IP Address: <SERVER_IP>` — the actual static IP, once assigned (Stage 1).
- **Recommended additions, if this host is ever accessed by either path**:
  - `IP Address: 127.0.0.1` and `DNS: localhost` — so local/diagnostic access (exactly what this
    session's own testing has used throughout, `http://localhost`) continues to work without a
    certificate mismatch warning during development/verification.
  - If a **second** NIC/IP is ever added (e.g. a management interface), each additional IP needing
    browser access must be its own SAN entry — SAN lists do not support CIDR ranges or wildcards for
    IP addresses.
- **Not recommended**: do not add a hostname SAN speculatively "just in case" — per your decision
  there is no hostname, and an unused SAN for a name that doesn't resolve adds no value and slightly
  widens what the certificate claims to cover.

## 5. Expiry and renewal procedure

- **Recommended validity: 397 days** (one year plus a short buffer) — long enough to avoid frequent
  manual reissuance for a self-signed internal cert (no public-CA 398-day cap applies here, but
  matching that convention keeps the renewal cadence familiar and is a reasonable default absent a
  stated hospital policy).
- **Renewal procedure** (manual, since this is self-signed with no ACME/automated issuance):
  1. Regenerate the key + self-signed cert with the same IP SAN, well before expiry (recommended: a
     30-day-out calendar reminder, not an automated system, since none exists for this yet).
  2. Replace `server.crt`/`server.key` at the same protected path.
  3. Reload nginx (`nginx -s reload` inside the container, or a container recreate) — **no other
     service is affected**, consistent with nginx being stateless here.
  4. Re-verify the full compatibility test suite (Stage 4 document) after every renewal, not just the
     first issuance.
- **Expiry monitoring**: no automated monitoring exists today (same gap noted generally in the
  independent security audit's backup/DR section). Recommend, as a follow-up decision — not performed
  now — either a simple scheduled check (`openssl x509 -enddate -noout -in server.crt`) wired into the
  existing Phase 8 alerting system, or a calendar-based manual process if that's disproportionate for
  a single internal server.

## 6. What this plan deliberately does NOT do

- Does not generate any certificate, key, or CSR — confirmed zero cryptographic material created.
- Does not assume the server IP — every concrete value above is `<SERVER_IP>`, pending Stage 1's
  resolution.
- Does not touch DICOM TLS (C-STORE/MWL certificates) — out of scope here exactly as in the prior F-01
  planning round; DICOM-TLS, if ever pursued, would use a **separate** certificate under this same
  protected-key pattern, not this one.

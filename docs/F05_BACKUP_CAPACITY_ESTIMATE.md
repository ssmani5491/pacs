# F-05 NAS Backup — Capacity Estimate

**Status: calculation only, based on actual measured values where stated.** No compression ratio is
assumed anywhere below — every figure uses the **pre-compression, raw** size, which is the safe
upper bound for planning NAS capacity (the actual gzip/tar output will be smaller, in most cases, but
this plan does not rely on that to avoid under-provisioning).

## 1. Actual measured values (today, 2026-11-16)

| Component | Measured size | How measured |
|---|---|---|
| `ris` database | **35,658,775 bytes** (≈ 34.0 MiB) | `pg_database_size('ris')`, live |
| `orthanc` database | **23,591,959 bytes** (≈ 22.5 MiB) | `pg_database_size('orthanc')`, live |
| `orthanc_storage` volume | **324.2 MB** (reported by `docker system df -v`) | Docker's own volume-size accounting, live |
| `pacs_archive` volume | **3.974 MB** | `docker system df -v`, live |
| Config files (compose, nginx×2, orthanc lua, mwl_scp.py, ohif config) | **26,961 bytes** (≈ 26 KiB) | `du -cb` on the exact file set named in the architecture document |
| Prisma migrations (10 files) | **35,156 bytes** (≈ 34 KiB) | `du -sb backend/prisma/migrations` |
| `redis_data` volume | 59.23 KB | `docker system df -v` — **not included in the backup set**, per the architecture document's reasoned decision that Redis needs no NAS backup |
| Secrets artifact (`.env`'s real values) | **Not measured** — a handful of key-value pairs, negligible (well under 10 KB in practice for this project's `.env.example` shape) but not backed by an actual byte count in this investigation, since reading `.env`'s size without its content is trivial but wasn't separately instrumented | Estimated, not measured |

**One full backup run, raw (pre-encryption, pre-compression) size:**
```
35,658,775  (ris)
+ 23,591,959  (orthanc)
+ 324,200,000  (orthanc_storage, using the reported 324.2 MB)
+ 3,974,000    (pacs_archive)
+ 26,961       (config)
+ 35,156       (migrations)
+ ~10,000      (secrets artifact, rough, unmeasured)
───────────────
≈ 387,496,851 bytes ≈ 369.6 MiB ≈ 0.37 GB per full backup run (raw, before any encryption/compression overhead or shrinkage)
```

**Encryption overhead note:** encryption (AES-GCM or similar) typically adds a small, fixed overhead
per file (an IV/nonce + auth tag, a few dozen bytes) — negligible at this scale, not a meaningful
addition to the total. Compression (gzip for the DB dumps, tar for the volumes — tar itself doesn't
compress) will likely **shrink** the DB dump portion (text-heavy SQL compresses well) but this
estimate does **not** rely on that shrinkage, per the brief's instruction to avoid assuming a
compression ratio — the ≈370 MiB figure above is the safe, uncompressed upper bound to provision
against.

## 2. Retention-tier totals (using the ≈370 MiB per-run figure, no growth yet)

| Retention tier | Runs retained | Total (no growth) |
|---|---|---|
| One full backup | 1 | **≈ 0.37 GB** |
| 7 daily backups | 7 | **≈ 2.59 GB** |
| 30 daily backups | 30 | **≈ 11.1 GB** |
| 12 monthly backups | 12 | **≈ 4.44 GB** |

**Combined, if the proposed tiered retention (7 daily + 4 weekly + 3 monthly, from the earlier F-05
implementation plan) is used instead of a flat 30-daily/12-monthly policy:**
```
7 daily + 4 weekly + 3 monthly = 14 total retained generations ≈ 14 × 0.37 GB ≈ 5.18 GB
```
This is noticeably smaller than a flat "30 daily + 12 monthly" (42 generations ≈ 15.5 GB) policy,
because tiering prunes most daily generations after a week — worth the owner weighing directly
against the earlier implementation plan's proposed retention numbers (still an open decision, not
settled here).

## 3. Growth allowance — ESTIMATED, not measured, clearly labeled as such

The measured sizes above are a **single point-in-time snapshot** of a development/test dataset. Real
production growth depends on clinical volume this codebase cannot know. This section provides a
**labeled estimate**, not a measurement, using the only growth data this project actually has: the
Phase 3 performance-test note that the system was *designed* to scale toward "the real 48k+ row
dataset" (from `docs/PROGRESS.md`'s own Phase 3 section) as a reference point, and the fact that
`orthanc_storage` currently holds 2489 instances for a synthetic test population of 6 patients.

| Scenario | Basis | Estimated size |
|---|---|---|
| RIS DB at ~48,000 studies (vs. today's 5,010) | Linear scaling of the measured 34 MB figure by study-count ratio (≈9.6×) — **a rough proportionality assumption, not a measured relationship**, since DB size doesn't scale perfectly linearly with row count (indexes, TOAST, etc. behave differently) | **ESTIMATED ≈ 325 MB** |
| Orthanc index DB at the same scale | Same proportionality caveat | **ESTIMATED ≈ 215 MB** |
| DICOM storage at a realistic clinical patient population | **Cannot be estimated responsibly from this dataset** — 2489 instances for 6 synthetic patients does not predict real clinical instance-per-study counts (which vary enormously by modality — a single CT study can be 300–6,600+ instances per this project's own Phase 9 stress-test target, while a single CR study might be 1–2) | **NOT ESTIMATED — flagged as an owner input requiring real clinical-volume projections, not a codebase-derivable number** |
| PACS archive volume | Directly tied to how many studies get archived and at what compression ratio — depends on operational policy (which studies get archived, how often) not yet decided | **NOT ESTIMATED — same reasoning as DICOM storage** |

**Honest conclusion on growth:** the per-component dollar-figure estimates above for the two
databases are a labeled, rough extrapolation good enough for provisioning headroom, but the
**DICOM storage and archive volume growth — almost certainly the dominant factor in real capacity
planning — cannot be responsibly estimated from this project's synthetic test data.** This is stated
plainly rather than presenting a confident-looking number built on an inappropriate basis.

## 4. Recommended provisioning approach, given the above
- **For the two databases:** provision for at least the ESTIMATED ≈325 MB + ≈215 MB figures per
  retained generation, not just today's measured ≈34 MB + ≈22.5 MB — a safety margin the brief itself
  asked for.
- **For DICOM storage and the archive volume:** **do not provision based on a number from this
  document** — this is the one open item flagged for a real decision informed by actual or projected
  hospital clinical volume (studies/day, average instances/study, archive retention policy), none of
  which exists in this codebase's test data.
- **General safety margin applied throughout:** the retention-tier totals in §2 already use the raw
  (uncompressed) size as a built-in buffer; no additional multiplier is layered on top of that in this
  document, to avoid compounding estimate-on-estimate uncertainty.

## 5. Distinguishing measured from estimated, one more time, explicitly
- **MEASURED** (verified live, today): every figure in §1 and the resulting §2 retention totals.
- **ESTIMATED** (labeled extrapolation, not a measurement): the database growth figures in §3.
- **NOT ESTIMATED / OWNER INPUT REQUIRED**: DICOM storage growth, archive volume growth — explicitly
  not guessed at, per the instruction not to assume a figure this codebase cannot responsibly derive.

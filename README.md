# RIS + PACS Replica

A clean-room, self-hosted enterprise **RIS + PACS** (radiology information system +
picture archiving and communication system). Rebuilds the *functionality and workflow*
of a licensed vendor system using original code and open-source medical-imaging
infrastructure. No vendor code, assets or branding. Synthetic patient data only.

> Not a demo or static frontend — real DICOM infrastructure (Orthanc), a real web viewer
> (OHIF/Cornerstone3D), and a real radiology reporting workflow.

## Stack

- **Frontend:** React + TypeScript + Vite + Tailwind; OHIF viewer
- **Backend:** NestJS (Node 24), REST + WebSockets, JWT + refresh, RBAC
- **Database:** PostgreSQL 16 + Prisma (UUID PKs, org/department isolation)
- **DICOM:** Orthanc (C-STORE SCP, DICOMweb QIDO/WADO/STOW, MWL)
- **Infra:** Docker Compose, NGINX, Redis — fully offline/on-prem

## Quick start

```bash
cp .env.example .env     # then edit every secret
docker compose up -d --build
```

Services come up with health checks: `postgres`, `redis`, `orthanc`, `backend`,
`frontend`, `nginx`. Open http://localhost — the shell shows backend/db health.

Default super admin is seeded from `.env` (`SEED_ADMIN_*`). **Change the password
on first login.**

## Project layout

```
backend/    NestJS API + Prisma schema/migrations/seed
frontend/   React/Vite enterprise shell (+ OHIF, later phases)
orthanc/    Orthanc config, MWL worklists, on-stored hook
nginx/      reverse proxy (/, /api, /dicom-web)
scripts/    db init
docs/       architecture, recon, roadmap, progress, guides
seed/       synthetic patients + DICOM test sets (later phases)
tests/      e2e + DICOM client scripts (later phases)
```

## Documentation

See [docs/](docs/): `ARCHITECTURE.md`, `RECON_SUMMARY.md`, `ROADMAP.md`,
`PROGRESS.md`. Per-module guides (DICOM config, OHIF, deployment, user/admin,
security, testing) are produced as their phases land.

## Status

Built in 10 phases (see `docs/ROADMAP.md`). **Phase 1 (foundation) is complete:**
monorepo, Docker stack, database schema + migrations, JWT auth with refresh-token
rotation and lockout, RBAC, audit logging, health checks. Phases 2–10 in progress.

## Scope & ethics

Clean-room rebuild of functionality only. Does not copy the vendor's source code,
proprietary assets, logos or branding. Uses **synthetic** patient data; does not
import or migrate real patient records without explicit written authorisation.
Provides security controls but makes no regulatory-compliance claim without a formal
assessment.

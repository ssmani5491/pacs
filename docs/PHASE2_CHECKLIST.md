# Phase 2 Checklist — Administrative Modules  ✅ COMPLETE (2026-11-13)

Legend: [x] done

## Shared foundation
- [x] Pagination/sort/search query DTO + response envelope (`common/pagination.ts`)
- [x] Tenant scoping helper (org isolation) (`common/tenant.ts`)
- [x] Global JWT guard + `@Public()` + global RBAC guard (fixed guard ordering bug)
- [x] `/auth/me` endpoint for UI identity + permissions
- [x] Frontend API client (token mgmt, auto-refresh, errors) (`lib/api.ts`)
- [x] Auth context + protected routes (`lib/auth.tsx`)
- [x] App shell: sidebar, top bar, light/dark theme, login page
- [x] Reusable DataTable, Modal, useList hook, generic CrudPage

## 1. Organization Management
- [x] API: list (paginated/search/sort), get, create, update, activate/deactivate
- [x] RBAC `org.manage`; org self-scope; audit ORG_CREATE/UPDATE/STATUS; validation (code unique)
- [x] Frontend CRUD screen · [x] Tests (unit + live e2e)

## 2. Department Management
- [x] API CRUD + activate/deactivate, org-scoped; cross-org write blocked
- [x] RBAC `dept.manage`; audit; validation (code unique per org)
- [x] Frontend CRUD (org dropdown) · [x] Tests

## 3. Doctor Management
- [x] API CRUD + activate/deactivate (canReport flag); org-scoped
- [x] RBAC `doctor.manage`; audit; validation
- [x] Frontend CRUD · [x] Tests (via live e2e)

## 4. User Management  (fields FLEXIBLE — pending Admin→User screenshot)
- [x] API CRUD + role assignment + activate/deactivate + password reset (argon2id reuse)
- [x] passwordHash never returned; self-deactivation blocked; audit; validation
- [x] Frontend CRUD + role picker (live /roles) · [x] Tests
- [x] UI note shown: "field set flexible — pending screenshot"

## 5. Modality Management  (fields FLEXIBLE — pending New Modality screenshot)
- [x] API CRUD + activate/deactivate + test-connection (TCP probe; C-ECHO deferred to Phase 4)
- [x] RBAC `modality.manage`; audit; validation (AE title unique)
- [x] Frontend CRUD · [x] Tests · [x] UI note shown

## 6. Administration Dashboard (proposed enhancement)
- [x] API counts from real DB (orgs/depts/doctors/users/modalities), org-scoped
- [x] Frontend dashboard cards · verified live (1 org, 2 users)

## Verification
- [x] All 6 services remained healthy; Phase 1 auth untouched (login/refresh/logout still pass)
- [x] Backend unit tests: 17/17 pass
- [x] Live e2e API test (real DB): 19/19 pass
- [x] Browser integration verified (login → dashboard → admin screens → create modal)
- [x] UI screenshots captured in docs/screenshots/
- [x] docs/PROGRESS.md updated

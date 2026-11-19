# Phase 8C — Study Details Topbar Title Correction

**Status: implemented and verified.** A single one-line, frontend-only fix. No backend, database,
Docker, NGINX, or OHIF file was touched.

## 1. Root cause

`Layout.tsx`'s `pageTitle(pathname)` resolves the topbar title in two steps: first it looks for a
matching entry in the sidebar's own `NAV` array (nothing matches, since `/studies/:id` is a
drill-down page with no sidebar link — by design), then it checks the `EXTRA_TITLES` list, a small
set of regex→title pairs for exactly this kind of non-sidebar detail route. `EXTRA_TITLES` had
entries for `/patients/:id` and the two `/reports/...` report-editor paths, but **no entry for
`/studies/:id`** (the Study Details page added in Phase 6B) — so the lookup fell through both
steps and returned the generic fallback `'RIS · PACS'`. This matches exactly what the Phase 7 audit
found and what Phase 8A/8B's own regression runs continued to show unaffected, since neither of
those phases touched `EXTRA_TITLES`.

## 2. Files changed

- `frontend/src/components/Layout.tsx` — one line added to `EXTRA_TITLES`:
  `[/^\/studies\/[^/]+$/, 'Study Details']`.
- No other file was modified. The Study Details page itself
  (`frontend/src/pages/StudyDetails.tsx`) was not touched — its own `<h1>Study Details</h1>` was
  already correct; only the topbar label (driven entirely by `Layout.tsx`) was wrong.

## 3. Fix implemented

Added one regex/title pair, in the same position and style as the existing `/patients/:id` entry
immediately above it, so `/studies/:id` now resolves the same way every other non-sidebar detail
route already does — no new mechanism, no special-casing.

## 4. Test results

- **A valid `/studies/:id` route now displays "Study Details"** — verified by navigating to it via
  the Worklist's existing "Details" button and reading the topbar text directly.
- **Other dynamic routes retain their correct titles** — verified for `/patients/:id` ("Patient
  Details") and `/reports/study/:id` ("Radiology Report"), both unaffected by the new entry.
- **Sidebar active-route highlighting remains correct** — confirmed no sidebar link is spuriously
  marked active while on `/studies/:id` (there never was one gaining `.active` here before or after
  this fix, since no `NAV` item targets that path).
- **Desktop, tablet, and mobile layouts unaffected** — confirmed the corrected title renders
  correctly at all three widths, and mobile shows the expected **zero horizontal overflow**
  (Phase 8A's fix, re-confirmed as still in effect) on this route both before and after reload.
- **Light and dark themes both show the corrected title** — confirmed via the real theme toggle.
- **Phase 8B RBAC nav filtering still works correctly alongside this fix** — re-verified with the
  `receptionist` test account: still exactly 7 visible links, `/admin/users` still absent.
- `tsc --noEmit`: clean, zero errors.
- Production build: clean — `index-C1s7wVQ_.css` (21.43 kB, unchanged — no CSS was touched),
  `index-DzsIVynW.js` (421.74 kB).
- **70/70 existing Playwright tests passing** (full official regression suite, re-run fresh).
- 6 additional throwaway verification tests covering every item in this report's test list, all
  passing, then deleted per the project's established pattern (no leftover temporary spec files).

## 5. Confirmation that unrelated functionality remains unchanged

- **Backend / database**: no file under `backend/` was read for writing or modified; no migration
  run; no record changed.
- **Clinical data**: untouched — this fix affects only a UI label string.
- **Docker**: no `docker-compose.yml` change, no volume reset. All 8 services (`backend`,
  `frontend`, `mwl-scp`, `nginx`, `ohif`, `orthanc`, `postgres`, `redis`) confirmed present and
  healthy after the frontend container was rebuilt and redeployed — the only container touched.
- **NGINX / OHIF**: untouched.
- **Phase 8A (responsive sidebar/drawer) and Phase 8B (RBAC nav visibility)**: both re-verified as
  still fully functional in this phase's own test pass — the fix did not alter `NAV`, `visibleTo()`,
  the collapse/drawer state, or any CSS.
- **Study Details page itself**: unchanged — only the surrounding `Layout.tsx` title resolution was
  touched, per the explicit instruction not to modify the page.

---

Stopping here per the stop condition. Awaiting review.

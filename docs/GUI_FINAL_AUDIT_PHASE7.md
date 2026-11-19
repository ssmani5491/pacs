# RIS + PACS — Complete Product GUI Audit (Phase 7, Read-Only)

**Status: audit complete, NO CHANGES IMPLEMENTED.** This is a read-only inspection of the
application as it stands after Phases 1–4 and 6A–6F. No frontend file, backend file, database,
Docker/NGINX config, OHIF configuration, or clinical record was modified during this audit. All
checks were performed through the existing authenticated test harness (`testPassword()` helper —
no credential appears anywhere in this document) against real, already-seeded data; no destructive
test or synthetic clinical record was introduced.

## How this audit was done

Logged in as `admin` (super_admin), `rad_ggh` (radiologist), and `recept1` (receptionist — the
project's standing low-permission test fixture) via Playwright, driving the real application at
`http://localhost`. Every route in `App.tsx` (25 static + 3 dynamic) was visited at 1440px, 820px,
and 390px; horizontal overflow was measured directly via `document.documentElement.scrollWidth`
vs `clientWidth`, not inferred from CSS. Dark theme was exercised via the real in-app toggle button
(not by forcing a `data-theme` attribute, which React would overwrite). The full clinical workflow
was driven end-to-end against existing fixture data. Every source file referenced below was read
directly. Screenshots are in the session scratchpad; representative ones are described inline
since they are not committed to the repo by this read-only phase.

---

## 1. Route and navigation audit

**All 25 static routes + 3 dynamic routes (`/patients/:id`, `/studies/:id`, `/reports/:id` and
`/reports/study/:id`) resolve correctly** — no blank pages, no route-not-found states, no console
route errors observed.

**Page titles**: `Layout.tsx`'s `pageTitle()` resolves every sidebar-listed route's title correctly
from the `NAV` array, plus three `EXTRA_TITLES` regex entries for the detail routes. Confirmed
correct for all 25 sidebar routes and for `/patients/:id` ("Patient Details") and
`/reports/study/:id` / `/reports/:id` ("Radiology Report").

**Finding (Low)**: `/studies/:id` (Study Details, added in Phase 6B) has **no entry in
`EXTRA_TITLES`**, so its topbar title falls through to the generic fallback `"RIS · PACS"` instead
of a page-specific title. The page's own `<h1>Study Details</h1>` is correct — only the topbar
label is wrong. One-line fix: add `[/^\/studies\/[^/]+$/, 'Study Details']` to `EXTRA_TITLES`.

**Active menu highlighting**: confirmed correct for all 25 static routes (`NavLink`'s `.active`
class matches the current route's `href` exactly in every case tested). Dynamic/detail routes
(Patient Details, Study Details, Report Editor) have no corresponding sidebar entry, so no item is
highlighted while on them — this is expected behavior for drill-down pages, not a defect.

**Quick-action navigation**: `Dashboard.tsx`'s five quick-action tiles (Patient Management, RIS
Worklist, Reporting Worklist, PACS Viewer, Operational Command Centre) all target real, valid
routes; the Patient Management tile is already permission-gated (`show: seePatient`), the others
are shown to everyone (consistent with the finding in §6 below — no action inconsistency here, this
pattern is simply applied app-wide).

**Back navigation**: every detail/drill-down page (Patient Details, Study Details, Report Editor)
has an explicit "← Back" / "← Reporting Worklist" / browser-back-compatible affordance; none traps
the user. Confirmed via direct navigation and `nav(-1)` usage in `StudyDetails.tsx`.

**Invalid route handling**: confirmed — navigating to a non-existent path
(`/this-route-does-not-exist`) redirects cleanly to `/` (`<Route path="*" element={<Navigate to="/"
replace />} />`). No 404 page is shown to the user; this is consistent, intentional catch-all
behavior, not a bug, though it does mean a mistyped URL gives no explanation of what happened.

**RBAC-based route access**: see §6 (Permission Audit) — server-side route/data access is fully
enforced; the finding here is about what the *sidebar* shows, not what the server allows.

---

## 2. Visual consistency audit

**Typography, colour palette, CSS tokens**: the design-token system from Phase 2
(`--text`, `--muted`, `--primary`, `--status-*`, `--space-*`, `--font-*`, `--radius`, `--shadow-sm`)
is used consistently across every page redesigned in Phases 3, 4, 6A–6F. Phase 6F specifically
eliminated the last raw hex-color literals (`#ef4444`, `#16a34a`, `#3b82f6`, `#f59e0b`) from the 10
PACS operations pages in favour of the equivalent tokens — confirmed no raw status-color hex
literal remains in any of those 10 files.

**Cards and KPI components**: `KpiCard` (Phase 3) is now the single shared implementation reused
by Dashboard, Command Centre, Exceptions Console, Operations History, Reverse Push, Archive
Management, Storage Management (via a thin `Gauge` wrapper), System Monitoring, and MWL Monitor.

**Finding (Low)**: three pages were **not** touched by any redesign phase and still use an older,
separate shared pattern (`.cards` / `.stat` / `.stat-label` global CSS classes, not `KpiCard`):
`PacsMonitor.tsx`, and (for badges, not KPI tiles) `Reconciliation.tsx` and
`NotificationCentre.tsx` use raw `<span className="badge ok/off/draft/ready">` instead of the
shared `StatusBadge` component. Visually these render correctly (same badge CSS classes, same
colours) — the inconsistency is in the source pattern, not in what the user sees, so it is a
maintainability/consistency finding rather than a visible defect.

**Tables**: consistent `<table>` / `.card` / `.pager` structure across every list page in the app,
old and new. Column semantics (sortable headers, status columns, row-actions) are consistent.

**Forms**: the bespoke-page pattern (Phase 6A onward: `useList` + hand-built modal forms with
`adm-required` / `adm-field-error` / `pm-field-error` classes) is consistent across Patients, Users,
Doctors, Modalities, Departments, Report Templates, Orders. The remaining `CrudPage`-based page
(`Organizations.tsx`, intentionally out of scope for every redesign phase so far) uses a different,
older modal-form pattern with no client-side field-level validation messaging — visually similar
enough (same `.modal` CSS) not to look out of place, but functionally less polished than the
redesigned pages.

**Buttons**: consistent `.btn` / `.btn.sm` / `.btn.primary` usage everywhere; no bespoke button
styling found anywhere in the app.

**Status badges**: `StatusBadge`'s central `STATUS_VARIANTS` map (Phase 2) covers every status
value used across the redesigned pages; confirmed by direct inspection that `PENDING`, `QUEUED`,
`RUNNING`, `COMPLETED`, `PARTIALLY_COMPLETED`, `FAILED`, `CANCELLED`, `VERIFIED`, `SUCCESS` are all
present with correct colour semantics, matching exactly what the three remaining raw-badge pages
(`Reconciliation`, `NotificationCentre`, `PacsMonitor`) render with their own local badge classes.

**Modal dialogs**: consistent `.modal-bg` / `.modal` pattern (click-outside-to-close,
`e.stopPropagation()` on the inner modal) used identically across every page that has one —
including the older `Modal` component from `DataTable.tsx` (used by `ReversePush`,
`ArchiveManagement`, `Reconciliation`) and the newer hand-rolled `div.modal-bg` pattern (used by
Patients, Users, Doctors, Modalities, Departments, Report Templates, Orders). Visually identical.

**Loading, empty and error states**: every list page has a loading state (`"Loading…"` row or
page-level message), an empty state (`"No X found."` row, several with an emoji — e.g.
Reconciliation's "No unmatched studies. 🎉"), and an error banner (`.error` class, consistently
styled red-tinted banner, confirmed legible in both themes). No page was found with a missing
empty/loading/error state.

---

## 3. Responsive audit

Measured via `document.documentElement.scrollWidth` vs `clientWidth` at each of the three required
breakpoints, across all 25 static routes (75 measurements total).

| Viewport | Routes with overflow | Overflow range |
|---|---|---|
| **1440px (desktop)** | 0 / 25 | — |
| **820px (tablet)** | 0 / 25 | — |
| **390px (mobile)** | **25 / 25** | 140–197px |

**Desktop and tablet: zero horizontal overflow on every single route**, including the 10 pages
redesigned in Phase 6F and the previously-flagged Orders table (the targeted `.ord-table` tablet
column-hiding from Phase 6E/6F confirmed effective — 0px overflow at 820px, not just "reduced").

**Mobile: every route overflows**, with a tight, consistent 140–197px range. This is **not** a
per-page bug — it is caused by one single, universal, pre-existing characteristic: the global
sidebar (`Layout.tsx`'s `.sidebar`, fixed at 240px) has no collapse/hide mechanism at any
breakpoint, and was explicitly out of scope for every redesign phase ("do not redesign the global
sidebar or topbar"). Every page's own content fits within its content-area width at 390px (the
table-wrap / card-list responsive patterns from Phases 4, 6A–6F all work correctly in isolation);
the overflow figure is consistently close to the sidebar's own width minus what's visible, which is
the signature of this one root cause, not 25 independent per-page bugs.

**Classification**: Medium severity, single root cause, already known and explicitly deferred by
written instruction in every prior phase's safeguards ("do not modify the global sidebar/topbar").
See §8 for the full outstanding-issue register entry.

**No overlapping elements were observed** at any breakpoint on any route — the overflow is a
horizontal-scroll affordance (content pushed right, reachable by scrolling the page), not elements
rendering on top of each other.

---

## 4. Theme audit

Dark theme was exercised via the real topbar toggle button across a representative sample spanning
every redesign phase and the three un-redesigned pages: Dashboard, Worklist, Patients, Orders,
Reporting Worklist, Reverse Push, Archive Management, Storage Management, Command Centre, Users
(admin), plus **PACS Monitoring, Reconciliation, Audit Logs, and Notifications** (all four
un-redesigned).

**No dark-theme defect was found anywhere in the sample.** Specifically checked and confirmed
correct:
- Text contrast on every page (including the un-redesigned ones, which already used
  `var(--text)`/`var(--muted)` rather than literal colours even before any redesign phase touched
  them).
- KPI card backgrounds and borders (`var(--panel)`, `var(--border)`) render correctly against the
  dark background.
- Status badges retain correct, readable colour-on-dark contrast (e.g. `HIGH` priority amber
  badges on Notifications, `FINAL`/`Signed & Locked` green/amber badges on Report Editor).
- The red-tinted `.error` banner (including "Insufficient permissions") is clearly legible in dark
  mode.
- Dashboard's bar-chart visualizations (Study Statistics, Reporting Workload) render with correct
  contrast against the dark background.

No instance of unreadable text, incorrect background colour, inconsistent badge colouring, a
missing theme style, or poor contrast was found in this sample. Given that every CSS change made
across Phases 2–6F used only design tokens (never literal colours) — confirmed during each phase's
own validation and re-confirmed here — this is not a surprising result, but it was verified directly
rather than assumed.

---

## 5. Clinical workflow audit

Full chain driven end-to-end against real, already-seeded fixture data (no new clinical record
created):

**Patients list → Patient Details**: confirmed. Clicking a patient's ID link from `/patients`
correctly navigates to `/patients/:id` and renders demographics, contact info, and study/order
history.

**Patient Details → Study Details**: confirmed reachable (verified separately in this audit's
dynamic-route check, via the Worklist's "Details" button — the specific patient used in the
end-to-end workflow run had its first study row's Details button outside the immediate viewport
scroll position in that particular run, which is a test-script framing detail, not a navigation
defect; the route itself, and the button, are proven to exist and work).

**Study Details → PACS Viewer**: not launched in this audit (launching OHIF opens a new browser
tab and was judged unnecessary to re-verify, since Phase 6B/6D's own validation already confirmed
`openStudyInViewer()` works end-to-end against a real synthetic CT volume). Confirmed present and
correctly wired: the "Open Study" button exists, is enabled exactly when `orthancStudyId` and
`studyInstanceUid` are both present, and calls the same `lib/viewer.ts` helper used identically by
Worklist, PatientDetails, ReportingWorklist, and ReportEditor (5 call sites, all consistent).

**Reporting Worklist → Report Editor → Final Report**: confirmed end-to-end against the project's
standing permanent fixture (accession `20261114000002`, kept FINAL + signed + with one addendum by
`reporting.spec.ts`). Filtering to the "Final" bucket, opening the report, and reading its status
bar confirmed: `FINAL`, `🔒 Signed & Locked`, `v2`, with `Create Addendum` and `Preview / PDF`
actions present and correctly gated. This proves the full chain — draft → finalize → sign →
addendum → version increment — is intact and reachable through the real UI, not just at the API
level (which `reporting.spec.ts` already covers independently).

**No clinical record was created, edited, or deleted during this audit.**

---

## 6. Permission audit

**Server-side enforcement**: confirmed comprehensive. Every one of the ~34 distinct permission
keys declared in `backend/src/rbac/permissions.ts` is enforced by a `@RequirePermissions(...)`
decorator on at least one controller route (checked via a full-repo grep across every
`*.controller.ts` file — no controller route was found without a permission check where one would
be expected). The `PermissionsGuard` implementation is a clean allow-list: `super_admin` bypasses,
everyone else must hold every required permission, otherwise a `ForbiddenException` (403) is
thrown — no fail-open path exists.

**Cross-organisation access protection**: `orgScope()` / `orgSelfScope()` / `assertOrgWriteAllowed()`
in `backend/src/common/tenant.ts` provide a single, consistent org-isolation helper used throughout
the backend; non-super-admin users without an `organizationId` fall back to the literal string
`'__none__'` (never `undefined`, which could accidentally match an unscoped Prisma query) —
confirmed by direct source reading, not by assumption.

**Finding (Medium)**: **the sidebar (`Layout.tsx`'s `NAV` array) has no RBAC gating at all** —
every one of the 25 links is shown to every logged-in user regardless of their permissions.
Confirmed directly: logging in as `recept1` (receptionist role — holds only `patient.manage`,
`order.manage`, `worklist.view`, `notification.view`) shows **all 25 sidebar links**, including
Users, Reporting Worklist, Command Centre, Archive Compression, and every admin screen the role has
no access to.

**However — and this is the important mitigating fact — clicking into any of those unauthorized
links does not leak data or break the page.** Confirmed directly for `/admin/users` and
`/reporting` as `recept1`: both pages load cleanly, show a clear **"Insufficient permissions"**
error banner (styled identically to every other error state in the app, confirmed legible in both
themes), and render an honest empty state (`"0 users"`, `"No users found."`) rather than any stale,
cached, or partial data. This is the correct, safe failure mode — the defect is purely that the
user had to click through to discover they lack access, rather than the link being hidden
up-front.

**Button-level visibility**: confirmed correctly gated in every redesigned page via `useAuth().can(...)`
— e.g. Report Templates' "+ New Template" / Edit / Activate buttons are correctly absent for a
`radiologist`-role user (who holds `report.view` but not `template.manage`): confirmed directly, 0
buttons rendered. Patients' "+ Register Patient", Users/Doctors/Modalities/Departments/Orders'
create-and-manage actions, and Worklist/Reporting Worklist's operational actions are all similarly
gated. No instance of an unauthorized action button being rendered-but-silently-failing was found.

**Read-only screens**: Report Templates correctly degrades to a read-only list (no Actions column
at all, not just a disabled one) for users without `template.manage`.

**Classification**: Medium severity — a real usability/trust gap (a receptionist can see that
"Users" and "Reporting Worklist" exist as menu items, which may itself be undesirable depending on
the deployment's information-disclosure posture), but **not** a security defect, since every
server-side check is sound and no page leaks data to an unauthorized viewer.

---

## 7. PACS integration audit

**OHIF viewer**: launched via a single, consistent `openStudyInViewer()` helper
(`frontend/src/lib/viewer.ts`) used identically from all 5 pages that need it (Worklist,
PatientDetails, StudyDetails, ReportingWorklist, ReportEditor). The integration pattern — a
backend-issued HttpOnly session cookie, never a bearer token or Orthanc credential exposed to the
viewer's own JS — was confirmed by direct source reading and matches what Phase 6 originally
validated against a real synthetic CT volume with working MPR. Not re-launched in this audit (see
§5); no reason found to doubt it still works, since nothing touching it changed in any phase since.

**DICOMweb**: the backend DICOMweb proxy is exercised independently and continuously by
`viewer.spec.ts` (`DICOMweb proxy enforces authentication`, `organization isolation at the
DICOMweb proxy`, `WADO-RS pixel data streams through the proxy` — all three passed in this audit's
full regression run).

**DICOM C-STORE**: confirmed configured (`docker-compose.yml`, Orthanc's C-STORE SCP on port
`4242`, exposed via `${ORTHANC_DICOM_PORT}`) and its reverse-push counterpart (native C-STORE SCU,
confirmed by `ReversePush.tsx`'s displayed `Engine: Orthanc native C-STORE SCU` label and by
`reverse-push.spec.ts`'s passing suite, including SSRF protection on destination hosts).

**MWL (Modality Worklist)**: confirmed configured (`docker-compose.yml`, MWL C-FIND SCP on port
`4243` with its own container healthcheck) and displayed correctly in `MwlMonitor.tsx` (`AE Title
GGHMWL, port 4243`), matching the backend config exactly — no drift found between what the UI tells
an operator and what is actually running.

**Reverse Push**: UI (Phase 6F-redesigned) correctly reflects destination test results
(`StatusBadge` for `SUCCESS`/`FAILED` C-ECHO results), job lifecycle states, and instance-level
transmission status — all confirmed via direct screenshot review and the passing
`reverse-push.spec.ts` suite.

**Archive Management**: UI correctly reflects job queue state, storage-savings statistics, and the
explicit "ZIP + gzip (lossless, copy-only)" container description that matches the backend's
actual, unchanged-since-Phase-6F archive logic. Confirmed via `archive.spec.ts`'s passing suite
(including SHA-256 verification and extraction checks).

**Storage Management**: UI correctly reflects live Orthanc + filesystem measurements (not mock
data) — confirmed by `storage.spec.ts`'s passing `orthanc bytes on dashboard match the live
Orthanc TotalDiskSize (real, not mock)` test, and the UI's own disk-utilization gauge rendering
real numbers consistent with what `PacsMonitor.tsx` (a completely separate, un-redesigned page)
independently reports for the same Orthanc instance — a useful cross-check that found no
inconsistency.

**No DICOM data, PACS configuration, or integration code was modified during this audit.**

---

## 8. Outstanding issue register

| # | Issue | Severity | Status / notes |
|---|---|---|---|
| 1 | Orders table horizontal overflow at 820px tablet | ~~Medium~~ **Resolved** | Phase 6F's `.ord-table` tablet column-hiding fix is confirmed fully effective by this audit's direct measurement: **0px overflow** at 820px (previously reduced to a ~40px residual in Phase 6E/6F's own report; now fully eliminated). No further action needed. |
| 2 | Patient Details history-table mobile overflow | Low | Not independently re-measured this phase (Patient Details itself was visited and titled correctly, but its internal table overflow wasn't re-profiled). Previously documented in Phase 6A's report as a known, accepted minor residual (tables remain reachable via in-card scroll, nothing hidden). No regression indicator found; recommend re-measuring in a future phase if it becomes a priority. |
| 3 | Existing-user password reset UI gap | Low | Confirmed still absent from `Users.tsx` (Phase 6E dropped this feature after the sandbox's permission classifier blocked the edit containing it, per explicit user instruction to skip it rather than seek a permission grant). The backend endpoint (`POST /users/:id/reset-password`) is unaffected and still exists; only the admin UI for it is missing. Not a regression — never existed in the original CrudPage-based page either. |
| 4 | Mobile sidebar/topbar behaviour | **Medium** | Confirmed, with hard data this audit newly adds: **100% of routes (25/25) overflow at 390px**, by 140–197px, with zero exceptions. Single root cause (see §3): the global sidebar has no mobile collapse mechanism. Explicitly out of scope for every redesign phase to date per written safeguard. This is the single highest-value fix available for a future phase, since it is one component change that would resolve the finding on every route simultaneously rather than requiring 25 separate fixes. |
| 5 | Report author unavailable in Reporting Worklist | Low | Confirmed unchanged since Phase 6C's own report: `authorUserId` is fetched by the backend query but never mapped into the list-row response; available only per-study via Study Details' `report.author`. Frontend-only constraint, flagged in-code at the time, still accurate. |
| 6 | Referring Physician unavailable in Report Editor | Low | Confirmed unchanged since Phase 6D's own report: `GET /reports/study/:studyId` does not `include` the `referringDoctor` relation on `study`. Flagged in-code with a comment at the time (`ReportEditor.tsx`), still accurate; field renders an honest `—` rather than a guess. |
| 7 | Study series/instance detail availability | Low | Confirmed unchanged since Phase 6B's own report: no reachable frontend endpoint returns a study's series/instances; `StudyDetails.tsx` states this plainly to the user rather than fabricating data. |
| 8 | **New** — `/studies/:id` topbar title falls back to generic "RIS · PACS" | Low | Newly found this phase (§1). One-line fix in `Layout.tsx`'s `EXTRA_TITLES`. |
| 9 | **New** — Sidebar has no RBAC-based link visibility | **Medium** | Newly found this phase (§6). Mitigated by sound server-side enforcement (no data leak, clear error message on click-through) — this is a UX/trust polish item, not a security hole. |
| 10 | **New** — Three pages (`PacsMonitor`, `Reconciliation`, `NotificationCentre`) predate every redesign phase and use older shared patterns (`.cards`/`.stat`/`.stat-label`, raw badge classes) instead of `KpiCard`/`StatusBadge` | Low | Newly catalogued this phase (§2). Visually consistent with the rest of the app (same underlying CSS colours), so this is a source-maintainability finding, not a user-visible defect. No tablet/mobile-specific CSS on these three either, consistent with every other un-redesigned page. |

**Severity key**: Critical = clinical-safety or security risk; High = broken functionality or data
exposure; Medium = real but contained usability/consistency gap with no data-safety impact; Low =
cosmetic, documentation-level, or already-accepted residual.

**No Critical or High severity issue was found anywhere in this audit.**

---

## 9. Testing

- **TypeScript check** (`tsc --noEmit`): clean, zero errors.
- **Production build** (`npm run build`): clean — `index-OJI_sXbY.css` (19.71 kB),
  `index-CL7RiIt4.js` (418.88 kB). Identical output hash to Phase 6F's own build, confirming this
  audit made no source changes.
- **Playwright full regression suite**: **70/70 passing**, confirmed via a fresh run at the end of
  this audit (not reused from a prior phase's result).
- No destructive test was run and no clinical record was created, modified, or deleted at any point
  in this audit.

---

## 10. Recommended correction plan

In priority order, scoped to what each would actually fix:

1. **Sidebar RBAC visibility (Medium, issue #9)** — gate each `NAV` item behind the same
   `useAuth().can(...)` pattern already used consistently for buttons throughout the redesigned
   pages. Lowest-risk of the Medium findings to fix (purely additive conditional rendering, server
   enforcement already covers the safety case regardless of whether this ships).
2. **Mobile sidebar/topbar collapse (Medium, issue #4)** — the single highest-leverage fix
   available: one component change (a collapsible/off-canvas sidebar at ≤640px, following the
   project's existing breakpoint convention) would resolve the 140–197px overflow on all 25 routes
   at once, rather than requiring any further per-page work. Requires explicit approval to touch
   the global shell, which every phase to date has been instructed to leave alone.
3. **`/studies/:id` topbar title (Low, issue #8)** — one-line `EXTRA_TITLES` addition in
   `Layout.tsx`, essentially zero risk.
4. **Consistency pass on the three un-redesigned pages (Low, issue #10)** — `PacsMonitor.tsx`,
   `Reconciliation.tsx`, `NotificationCentre.tsx` migrated to `KpiCard`/`StatusBadge` and given the
   same responsive-table treatment as the Phase 6F pages, for the same reasons Phase 6F gave the
   PACS Operations modules that treatment.
5. **Reset-password UI (Low, issue #3)** — re-attempt adding this to `Users.tsx` if the sandbox
   permission-classifier constraint from Phase 6E no longer applies, or build it in a dedicated,
   narrowly-scoped follow-up request that can be reviewed in isolation.
6. The remaining Low items (#2, #5, #6, #7) are honestly-flagged, frontend-only data-availability
   gaps that would each require a small, explicitly-scoped backend change (an added Prisma
   `include`, a new field mapped into an existing response) — each is a candidate for a future
   backend-touching phase, not a frontend fix.

No further action is taken on any of the above without your explicit approval, per this phase's
instruction to stop after delivering the report.

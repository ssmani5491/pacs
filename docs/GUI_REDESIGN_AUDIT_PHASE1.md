# RIS + PACS — GUI Redesign Audit (Phase 1, Read-Only)

**Status: audit complete, NO CHANGES IMPLEMENTED.** This is Phase 1 only — inspection, screenshots,
findings, and a proposed design direction for approval. No frontend file was modified. No backend
API, database schema, or clinical workflow was touched. Screenshots are in
`docs/screenshots/gui-audit-2026-11-16/` (30 images — every screen, a patient-details drill-down, the
report editor, and three responsive breakpoints).

## How this audit was done
Logged in as `admin` (super_admin, full visibility) via the existing authenticated test harness
(`testPassword()` helper — no credential appears anywhere in this document or its production). Visited
every route in `App.tsx`, captured a full-page screenshot of each, then re-captured the dashboard and
worklist at a 390px mobile width and the dashboard at an 820px tablet width to assess responsive
behavior for real, not by inspecting CSS alone. Read every source file referenced below directly.

---

## 1. Current application layout and navigation

**Structure** (`Layout.tsx`): a CSS Grid shell — `240px` fixed sidebar + `56px` topbar + content area.
Sidebar is a flat, un-nested list of 7 sections (Overview, Radiology, PACS, PACS Operations,
Reporting, Operations, Administration) totaling 25 links, all plain text, **no icons anywhere in the
navigation**. The sidebar has **no collapse mechanism at all** — no toggle, no hamburger, no
breakpoint logic. Topbar shows a hardcoded `<strong>Administration</strong>` label on every single
page (confirmed by screenshot: identical on the Dashboard, Worklist, Command Centre, and every other
page) — this is a real bug, not a design choice; it should reflect the current section/page.

**Design problem**: 25 flat links with no icons and no visual grouping beyond a small uppercase
section label is dense and hard to scan, especially as more PACS Operations modules have been added
over time (6 items already in that one section alone).

## 2. All existing RIS screens and modules (confirmed by route table + screenshots)

| # | Screen | Route | Screenshot |
|---|---|---|---|
| 1 | Dashboard | `/` | 01 |
| 2 | RIS Worklist | `/worklist` | 02 |
| 3 | Patients (list) | `/patients` | 03 |
| 4 | Patient Details | `/patients/:id` | 26 |
| 5 | Examination Orders | `/orders` | 04 |
| 6 | PACS Monitoring | `/pacs/monitor` | 05 |
| 7 | Reception Logs | `/pacs/reception-logs` | 06 |
| 8 | Reconciliation | `/pacs/reconciliation` | 07 |
| 9 | Modality Worklist (MWL) | `/pacs/mwl` | 08 |
| 10 | Reporting Worklist | `/reporting` | 09 |
| 11 | Report Editor | `/reports/:id` | 27 |
| 12 | Notification Centre | `/notifications` | 10 |
| 13 | Audit Logs | `/ops/audit` | 11 |
| 14 | System Monitoring | `/ops/monitoring` | 12 |
| 15 | Alert Management | `/ops/alerts` | 13 |
| 16 | Reverse Push Monitor | `/pacs/reverse-push` | 14 |
| 17 | Archive Compression | `/pacs/archive` | 15 |
| 18 | Storage Management | `/pacs/storage` | 16 |
| 19 | Operations Command Centre | `/pacs/operations/command-centre` | 17 |
| 20 | Operations Exceptions | `/pacs/operations/exceptions` | 18 |
| 21 | Transfer & Archive History | `/pacs/operations/history` | 19 |
| 22 | Organizations (admin) | `/admin/organizations` | 20 |
| 23 | Departments (admin) | `/admin/departments` | 21 |
| 24 | Doctors (admin) | `/admin/doctors` | 22 |
| 25 | Users (admin) | `/admin/users` | 23 |
| 26 | Modalities (admin) | `/admin/modalities` | 24 |
| 27 | Report Templates (admin) | `/admin/report-templates` | 25 |
| — | OHIF Viewer (separate app, `/viewer/`) | not in React Router — separate nginx location | not captured here (see §8) |

**27 React-routed screens, plus the separately-served OHIF viewer.** This is a large, mature
application — the redesign must be scoped as an incremental visual system applied consistently across
all 27, not a rewrite.

## 3. Dashboard design and available data (screenshot 01)

Six plain white KPI cards in a flat grid under three section headings (Clinical, Reporting,
Modality-wise Studies), each just a big number + a muted label — no icons, no trend indicators, no
color-coding by severity (a "0 Today's Examinations" card looks identical to "5010 Total Studies").
**Real, live operational data** (confirmed numbers match `/api/admin/dashboard`) — no mock data risk
here, which is good; the redesign only needs to re-skin the presentation. Compare to the much more
sophisticated **Operations Command Centre** (screenshot 17), built later (Module 5), which already
uses colored numbers (green/red/amber), small status dots for service health, and tightly-grouped
KPI rows — **this is the best existing reference point for the new main Dashboard's visual language.**

## 4. Patient management screens (screenshots 03, 26)

Patients list uses the shared `CrudPage`/`DataTable` components (confirmed by code: `grep` shows
`CrudPage` used in 8 pages, `DataTable` in 3) — standard search + paginated table + row actions. Patient
Details is a simple two-column info panel. Functionally complete; visually identical to every other
admin list screen (flat table, no avatar/photo placeholder, no visual patient-identity anchor beyond
text).

## 5. Radiology worklist (screenshot 02, 29-mobile) — the single most important screen for the brief's area B

**Confirmed functionality**: Patient ID/Name/Accession search, date range, 9 modality checkboxes,
6 status-count tabs (ALL/READY/DRAFT/PRELIMINARY/FINAL/CANCELLED/PENDING with live counts), a
13-column table (Sl, Patient ID, Patient Name, Accession, Study Date, Time, Modality, Description,
Ref Doctor, Assigned, Status, Images, Actions), row actions (Open Study, Report, conditionally
Operations). **No study thumbnail preview anywhere** — the brief's "study thumbnail previews where
available" is not implemented today; the row only shows an image **count**, not a preview.

**Design problem, confirmed by screenshot**: the 13-column table **overflows the viewport
horizontally at 1280px** — the screenshot is cut off mid-table with more columns beyond the visible
edge, meaning a real user must scroll horizontally to see Actions. At the 390px mobile breakpoint
this is far worse — the sidebar doesn't collapse, squeezing the entire worklist (filters, tabs, and
table) into roughly 220px of usable width.

**Status badges**: `STATUS_CLASS` map (`ready`/`draft`/`prelim`/`final`/`off`) exists and renders as a
colored pill — this part already works reasonably and is salvageable.

## 6. Study details and study management

Covered by the Worklist's row actions (Open Study → OHIF in a new tab; Report → Report Editor) and the
Study Operations drawer (`StudyOperationsDrawer.tsx`, opened from the worklist for users with PACS
Operations permissions) — there is no dedicated "Study Details" page separate from these two
entry points. This is a reasonable existing pattern, not a gap — the redesign should keep both
entry points, just restyle them.

## 7. Reporting interface (screenshots 09, 27)

Reporting Worklist is a bucketed list (similar shape to the RIS worklist). Report Editor
(screenshot 27) is currently **extremely sparse visually** — a two-column patient/study info card, a
single "No report yet" message, and a bare `<select>` + button for template selection. For a study
*with* an existing report, the editor has substantially more UI (10 sections, lifecycle buttons, sign
dialog — confirmed in code from this session's earlier Phase 7 work) that wasn't captured in this
screenshot pass because the test study had no report yet. **A second screenshot pass of an in-progress
report would be valuable before finalizing the reporting-screen redesign** — flagged as a gap in this
audit's own screenshot coverage, not a product gap.

## 8. PACS viewer integration (brief's area C)

**Not a React-routed page** — OHIF is a separately-built, separately-served SPA at `/viewer/`,
launched via `window.open()` from the Worklist/Report Editor (`lib/viewer.ts`). This session's earlier
F-01 investigation already confirmed, with a real screenshot, that OHIF renders correctly: dark theme,
left series-thumbnail panel, central viewport, top toolbar, patient info panel — **this already
matches the brief's area C description closely**, because it's stock OHIF v3.13.14's own default
`longitudinal` mode (confirmed zero custom OHIF extensions exist in this project — `ohif/` holds only
`Dockerfile`, `ohif-nginx.conf`, `app-config.js`). **The redesign brief's safeguard "do not replace
OHIF" is correctly aligned with reality**: OHIF's own interface should not be redesigned here at all
— it is a separate, working, pre-styled product. The only "PACS viewer" surface this redesign can
touch is the **launch experience** (the Worklist's "Open Study" button, the viewer-session handoff) —
not OHIF's own screens.

## 9. Administration screens (screenshots 20-25)

Six CRUD screens (Organizations, Departments, Doctors, Users, Modalities, Report Templates), all built
on the shared `CrudPage`/`DataTable` pattern — consistent with each other today, which is good. **One
concrete defect found**: the Users screen (screenshot 23) displays a leftover development note
directly in the production UI: *"Field set is standard and flexible — pending the Admin → User
screenshot."* This is placeholder text that should never have shipped to an end user and must be
removed regardless of the redesign (a content fix, not a visual one — flagged here because it's a
genuine, user-visible defect this audit found).

## 10. Operational modules — archive, storage, transfer history (screenshots 14-19)

These are the **newest** pages (PACS Operations Modules 1–5, built across this project's recent
sessions) and are **visually the most advanced screens in the entire application** — Command Centre
and Exceptions Console (screenshots 17-18) already use colored status dots, classification badges
(CONFIRMED/HEURISTIC/INFRASTRUCTURE in red/amber/indigo), grouped KPI tiles, and a clean filter-toolbar
pattern. **This is the strongest existing foundation for the redesign's visual language** — the
proposed design system below leans on these pages' conventions rather than inventing new ones,
consistent with reusing what already works.

## 11. Existing reusable components and CSS/design system

- **The entire CSS footprint is one file**: `frontend/src/styles.css`, 75 lines. CSS custom
  properties for light/dark theming (`:root` / `[data-theme="dark"]`), plain global classes
  (`.btn`, `.card`, `.badge`, `.table`, `.modal`, etc.) — **no component library** (no MUI/Ant/Tailwind/
  Chakra), no CSS-in-JS. Every page composes these same class names directly.
- **Genuinely shared React components**: `CrudPage.tsx` (used by 8 pages), `DataTable.tsx` (3 pages),
  `useList.ts` (a data-fetching hook), `Layout.tsx`, `NotificationBell.tsx`, `StudyOperationsDrawer.tsx`.
  This is real, working shared infrastructure for the admin CRUD screens — **keep and extend it**, do
  not replace it.
- **Duplicated, not shared, across pages**: a local `Badge`/status-color component is independently
  redefined in at least `OperationsHistory.tsx`, `OperationalCommandCentre.tsx`,
  `OperationsExceptions.tsx` (confirmed by `grep`), and (from direct reading earlier this session)
  `ArchiveManagement.tsx`, `ReversePush.tsx`, `StorageManagement.tsx`. **This is the single clearest
  "extract to a shared component" opportunity** — a `<StatusBadge>` and a shared `STATUS_COLOR` map
  belong in `components/`, used everywhere instead of six near-identical copies.
- **No existing breakpoint/responsive system at all** — zero `@media` queries anywhere in the
  stylesheet, confirmed by reading the complete file.

## 12. Responsive behaviour and usability issues (confirmed by actual screenshots, not inspection alone)

- **390px (mobile)**: sidebar stays fixed at 240px, squeezing content into ~150px of usable width;
  every table and form overflows horizontally; the topbar's user info wraps awkwardly into the
  sidebar's visual space. **The application is not usable on a phone-sized viewport today.**
- **820px (tablet)**: better than mobile but the sidebar still consumes a disproportionate share of
  the width, and the Dashboard's KPI grid drops to 2 columns per row (acceptable) while other pages
  with wider tables (Worklist, admin lists) would overflow similarly to the mobile case — not
  separately screenshotted at tablet width in this pass, but the same fixed-sidebar mechanism applies
  identically.
- **Desktop (1280px, this project's standard test viewport)**: the Worklist's 13-column table already
  overflows horizontally at this width — a wide-table problem independent of responsive design,
  caused simply by having too many always-visible columns.
- **Topbar label bug**: "Administration" shown unconditionally on every page (§1) — a real,
  user-visible defect.
- **Stray placeholder text**: the Users page's development note (§9) — a real, user-visible defect.
- **No loading/empty-state visual consistency reviewed in depth in this pass** — the Notification
  Centre's "No notifications." empty state is plain text with a large empty area beneath it; other
  pages' loading states (`"Loading…"` text) were not individually screenshotted mid-load since data
  loaded faster than the capture script's wait — flagged as a gap in this audit's coverage.

---

## Proposed design direction

### What must be preserved (non-negotiable, per the brief's own safeguards and this audit's findings)
- OHIF's own interface — untouched (§8).
- Every existing route, every existing API call, every existing RBAC/permission gate.
- The `CrudPage`/`DataTable`/`useList` shared infrastructure — extended, not replaced.
- All real, live data bindings — no screen in this redesign should introduce mock data.
- Existing worklist functionality (filters, status tabs, row actions) — restyled, not removed.

### A. Main RIS application — proposed direction
- **Keep the light theme as the default** (already exists, already used); the existing dark-mode
  toggle (`[data-theme="dark"]`) is kept and extended with the new palette's dark variants.
- **Make the sidebar collapsible** (a new, small feature — a toggle button + a CSS width transition +
  a responsive breakpoint that auto-collapses under ~900px) — this directly closes the §12 mobile/
  tablet usability gap without removing any navigation item.
- **Add icons to the nav** — a small icon per top-level section/item (the existing `react-icons` or a
  lightweight icon set — to be selected in Phase 2, not decided here) to improve scannability of the
  now-25-item list.
- **Fix the topbar to show the current page's actual title**, derived from the route, replacing the
  hardcoded "Administration" string.
- **Rebuild the Dashboard's KPI tiles** following the **Command Centre's already-proven pattern**
  (colored numbers by severity, small icons, tighter grouping) rather than inventing a new tile style.

### B. Radiology worklist — proposed direction
- **Reduce visible columns by default**, moving lower-priority columns (e.g. Ref Doctor) behind a
  "more" affordance or a column-visibility toggle, to eliminate the confirmed horizontal overflow —
  preserving every column's data, just not all visible simultaneously at once on a standard screen.
- **Add a thumbnail preview** where `hasImages` is true — a small, real preview pulled from the
  existing authenticated DICOMweb proxy (reusing the same auth/org-isolation this project already
  built for OHIF, not a new image-serving path) — this is new functionality the brief specifically
  asked for and the current app doesn't have; flagged as a **Phase 2+ build item requiring its own
  small design decision** (thumbnail size, loading strategy), not decided unilaterally here.
- **Keep the status-tab + badge pattern** (`STATUS_CLASS`) — it already works; just restyle the pill
  to the new design system's badge component.

### C. PACS viewer — proposed direction
- **No change to OHIF itself.** The only in-scope surface is the **launch experience**: the
  Worklist's "Open Study" button and the brief post-viewer-session handoff — restyled consistent with
  the new button/icon system, functionally unchanged.

### Proposed navigation structure (restyled, not restructured)
The existing 7 sections and 25 items are preserved as-is in this phase — reorganizing section grouping
is a content-architecture decision, not a visual-design one, and the brief did not ask this audit to
re-architect navigation, only to propose a visual system for it. One structural fix proposed: making
PACS Operations' 6 items (already the largest section) collapsible/expandable within the sidebar, to
reduce default visual weight without removing any link.

### Proposed design system — colours, typography, spacing, buttons, cards, tables, forms, badges
Builds directly on the **existing CSS variables already in `styles.css`**, extended rather than
replaced (reuse, per the brief's safeguards):

| Token category | Current value | Proposed direction |
|---|---|---|
| Primary color | `#2563eb` (blue-600) | **Keep** — already a sound, accessible choice; used consistently today |
| Background | `#f4f6f9` light / `#0f172a` dark | **Keep both** |
| Status colors | `--ok` green `#16a34a`, `--danger` red `#dc2626`, `--warn` amber `#d97706` | **Keep**, and **formalize** into one shared `<StatusBadge>` component (closing the §11 duplication finding) instead of six independent local copies |
| Typography | System font stack, 14px base, no defined type scale beyond `h1`/`h3` ad hoc sizes | **Add a small, explicit type scale** (e.g. 12/13/14/16/20/24px) replacing today's per-page ad hoc `fontSize` inline styles (confirmed widespread — nearly every page sets `style={{ fontSize: ... }}` inline rather than a class) |
| Spacing | No spacing scale; ad hoc `gap`/`padding` values throughout (8, 10, 12, 14, 16, 18, 20, 24 all appear) | **Add a 4px-based spacing scale** (4/8/12/16/24/32), migrating the most common ad hoc values first |
| Buttons | `.btn`, `.btn.primary`, `.btn.danger`, `.btn.sm` | **Keep the API**, add a `.btn.secondary` variant and consistent icon-plus-label spacing |
| Cards | `.card` (white panel, border, shadow, 20px padding) | **Keep**, add a `.card.kpi` variant matching the Command Centre's tighter tile pattern for dashboard-style number displays |
| Tables | Plain `<table>`, hover row highlight, uppercase muted headers | **Keep the pattern**; add a column-visibility/responsive-collapse mechanism (the Worklist's core need) |
| Forms | Plain `<input>`/`<select>`/`<label>`, no validation-state styling visible in any screenshot | **Add** a visible error/invalid state to inputs (not present anywhere today) |
| Badges | `.badge.ok`/`.badge.off` only (2 variants) plus per-page local color maps | **Consolidate** into one shared component with the full existing status-color palette already proven in the Exceptions Console (red/amber/indigo/green/gray) |

### Components that can be reused as-is
`CrudPage.tsx`, `DataTable.tsx`, `useList.ts`, `Layout.tsx`'s grid structure, `NotificationBell.tsx`,
`StudyOperationsDrawer.tsx`, the existing CSS variable set (colors), the `.btn`/`.card`/`.modal` class
API (restyled in place, not replaced).

### Components that need redesign or extraction
A shared `<StatusBadge>` (replacing ~6 duplicated local implementations), a shared `<KpiTile>`
(generalizing the Command Centre's tile pattern for the main Dashboard), a collapsible sidebar
mechanism (new), a page-title-aware topbar (fixing the hardcoded label bug), a responsive table/column
strategy for the Worklist specifically.

### Recommended implementation order
1. **Design-system foundation first**: extend `styles.css` with the formalized type scale, spacing
   scale, and the shared `<StatusBadge>`/`<KpiTile>` components — zero visible change yet, pure
   refactor, lowest risk, immediately removes the duplication finding from §11.
2. **Fix the two concrete defects found in this audit** (hardcoded topbar label, the Users-page
   placeholder text) — small, safe, high-value fixes independent of the broader redesign.
3. **Sidebar collapse + responsive breakpoint** — directly closes the §12 mobile/tablet findings,
   touches only `Layout.tsx` + CSS.
4. **Dashboard restyle**, using the now-shared `<KpiTile>` — lowest-risk page to restyle first since
   it's purely presentational (no complex interaction state).
5. **Worklist restyle + column strategy + (separately scoped) thumbnail preview** — highest-value,
   highest-complexity screen; do last among the "core" screens so the design system is proven
   elsewhere first.
6. **Remaining pages** (admin CRUD, operations modules, reporting) restyled using the now-proven
   system — largely mechanical once steps 1–5 are in place, since most already use shared
   `CrudPage`/`DataTable` infrastructure.
7. **PACS viewer launch experience** (the "Open Study" button and surrounding chrome only) — last,
   smallest surface, and explicitly not touching OHIF itself.

---

## Honest limitations of this audit
- The Report Editor's **in-progress** (non-empty) state was not screenshotted — the test study used
  had no existing report. A follow-up screenshot pass against a study with a draft/preliminary report
  would strengthen the Reporting-interface findings before implementation begins there.
- Loading and error states were not individually captured for every page — data loaded faster than
  the capture script's fixed wait in every case tested; this is a coverage gap in the audit, not
  evidence those states don't exist or work correctly.
- Real hospital-network responsive testing (an actual tablet/phone device on the real network) was not
  performed — the 390px/820px figures are Playwright viewport emulation, a reasonable proxy but not a
  physical-device test.

**Awaiting approval before any implementation begins**, per the brief's explicit Phase 1 scope.

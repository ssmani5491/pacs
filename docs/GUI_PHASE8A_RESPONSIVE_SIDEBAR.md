# Phase 8A — Responsive Sidebar & Mobile Navigation

**Status: implemented and verified.** Frontend-only change. No backend file, database, Docker
volume, NGINX config, OHIF config, or clinical record was touched.

## 1. Root cause addressed

`docs/GUI_FINAL_AUDIT_PHASE7.md` (§3) measured zero horizontal overflow at 1440px and 820px on
every one of the 25 routes, but **100% overflow at 390px (140–197px on every route)**, with a
single identified cause: `frontend/src/styles.css`'s `.app` grid declared
`grid-template-columns: 240px 1fr` with **no media query overriding it at any breakpoint** — the
sidebar column was reserved at a fixed 240px regardless of viewport width, which is exactly why
every page's content area was squeezed and pushed into horizontal overflow at mobile width.
Confirmed by direct source reading before any change was made, per the mandatory first step.

**Inspection findings before implementation:**
- `Layout.tsx` renders one `NAV` array (7 sections, 25 items) into a single `<nav className="nav">`
  inside `<aside className="sidebar">`; active-route highlighting is handled entirely by
  `react-router-dom`'s `NavLink`, which applies an `.active` class matched by CSS
  (`.nav a.active { background: var(--panel-2); color: var(--primary); }`) — no manual
  path-comparison logic exists.
- The topbar's page title (`pageTitle()`) resolves from the same `NAV` array plus a small
  `EXTRA_TITLES` regex list for drill-down routes — confirmed this stays correct with no change
  needed for this phase.
- **No existing collapse, drawer, or hamburger component existed anywhere in the codebase.** The
  only other "drawer"-named component (`StudyOperationsDrawer.tsx`) is an unrelated
  study-operations side panel built on the `.modal-bg` overlay pattern, not a navigation drawer —
  read directly, confirmed not reusable as-is, but its `.modal-bg` click-outside-to-close
  convention informed the new `.drawer-backdrop` styling for consistency with the rest of the app.
- **The `NAV` data had no icons at all** (confirmed in both `Layout.tsx` and the Phase 1 audit,
  which flagged this). Since the brief explicitly requires icon-only collapsed navigation with
  tooltips, icons were added to every nav item as part of this phase — reusing the app's existing
  emoji-icon convention (already used identically by `Dashboard.tsx`'s quick-action tiles) rather
  than introducing a new icon system or library.

## 2. Files changed

- `frontend/src/components/Layout.tsx` — added an `icon` field to every `NAV` item; extracted the
  nav-link list into a shared `NavLinks` component (one definition, used by both the desktop
  sidebar and the mobile drawer, so there is exactly one place that defines what the navigation
  contains); added `collapsed` and `drawerOpen` state, a collapse toggle button, a mobile
  hamburger button, and the drawer itself (with `role="dialog"`, `aria-modal`, Escape-key
  handling, body-scroll lock, backdrop-click-to-close, explicit close button, and
  link-click-closes-drawer).
- `frontend/src/styles.css` — added `.app.sidebar-collapsed` (desktop icon-only variant),
  `.sidebar-collapse-btn`, `.hamburger-btn`, `.drawer-backdrop`/`.drawer`/`.drawer-close-btn`, and
  the `@media (max-width: 640px)` rule that removes the sidebar column from `.app`'s grid entirely
  at mobile width — this last rule is the actual fix for the root cause; everything else is the
  added convenience layered on top of it.
- No other file was modified.

## 3. Desktop behaviour (1440px)

- Existing sidebar design and navigation fully retained — same sections, same labels, same routes,
  same active-highlight colour.
- New: a collapse button at the bottom of the sidebar (`« Collapse` / `»`) toggles between the
  existing full-width (240px) sidebar and a new icon-only 64px variant.
- Collapsed state: section headers hidden, link labels hidden, only the emoji icon remains,
  centred; each link carries a native `title` attribute (browser tooltip) with its full label,
  and an `aria-label` for assistive technology.
- Collapse state persists across reload via `localStorage` (same pattern already used for the
  theme toggle), so it is a standing layout preference, not a per-session UI quirk.
- Active-route highlighting is unchanged and confirmed working in both expanded and collapsed
  states (same `NavLink`/`.active` mechanism, now shared by one `NavLinks` component instead of
  duplicated).
- Main content area uses `grid-template-columns: Npx 1fr`, so it automatically gains the freed
  width when collapsed — no separate resize logic needed, confirmed by screenshot (Command Centre's
  KPI cards visibly reflow wider when collapsed).
- Zero horizontal overflow, confirmed by direct measurement (see §7).

## 4. Tablet behaviour (820px)

- No drawer, no hamburger, no collapse button at this breakpoint — the full sidebar remains
  visible and usable exactly as before, since Phase 7's audit already found **zero overflow at
  820px on every route** (the fixed 240px sidebar was never the problem at this width; only mobile
  was). This phase intentionally did not add tablet-specific navigation changes beyond what was
  already working, per the brief's "ensure the topbar and page content remain usable" requirement
  — re-verified, not re-engineered.
- Confirmed via a dedicated test and direct measurement: hamburger button is hidden, zero overflow.

## 5. Mobile behaviour (390px)

- Sidebar is hidden by default (`display: none` inside the `@media (max-width: 640px)` block) and
  removed from the grid entirely — this is what eliminates the 240px-always-reserved overflow.
- A hamburger button (☰) appears in the topbar, to the left of the page title.
- Tapping it opens an off-canvas drawer: a 260px-wide (85vw max) panel sliding in from the left
  over a semi-transparent backdrop, containing the exact same navigation as the desktop sidebar
  (via the shared `NavLinks` component, uncollapsed).
- The drawer has an explicit close button (✕) in its header.
- Clicking the backdrop (outside the drawer panel) closes it.
- Selecting any navigation link closes the drawer and navigates (confirmed via a route-change
  effect that closes the drawer on every `location.pathname` change, so this holds even for a
  link added outside `NavLinks` in the future).
- Escape key closes the drawer.
- Background page scroll is locked (`document.body.style.overflow = 'hidden'`) while the drawer is
  open, and restored on close.
- The drawer does not create any additional horizontal overflow, whether open or closed — measured
  directly, not assumed (see §7).
- Page content is full-width when the drawer is closed (no permanently reserved horizontal space).

## 6. Light and dark theme

No new colour was hardcoded anywhere — every new rule uses existing tokens
(`var(--panel)`, `var(--border)`, `var(--text)`, `var(--muted)`, `var(--primary)`,
`var(--shadow-sm)`). Verified directly via screenshot in both themes: desktop expanded (dark),
desktop collapsed (light), and mobile drawer open (both light and dark) — all render with correct
contrast, no unreadable text, no incorrect background, consistent with every other themed element
in the app.

## 7. Responsive verification — all 25 routes × 3 viewports

Measured via Playwright, directly reading `document.documentElement.scrollWidth` vs
`clientWidth` (not visual inspection), exactly as the brief required.

| Viewport | Routes checked | Routes with overflow | Result |
|---|---|---|---|
| Desktop (1440px) | 25 | 0 | **0px overflow on every route** |
| Tablet (820px) | 25 | 0 | **0px overflow on every route** |
| Mobile (390px), drawer closed | 25 | 0 | **0px overflow on every route** (was 140–197px before this phase) |
| Mobile (390px), drawer open | 5 (sample: Dashboard, Worklist, Command Centre, Users, Reporting Worklist) | 0 | **0px overflow with the drawer open, on every sampled route** |

**75/75 route×viewport combinations measured zero overflow.** The Phase 7 finding is resolved.

## 8. Sidebar interaction test results

11 new Playwright tests, all passing:

1. Desktop collapse/expand toggles icon-only mode and preserves active-route highlighting — pass.
2. Desktop collapse state persists across a page reload — pass.
3. Mobile: drawer closed by default; hamburger opens it; clicking a link closes it and navigates —
   pass.
4. Mobile: backdrop click closes the drawer — pass.
5. Mobile: Escape key closes the drawer — pass.
6. Mobile: explicit close button closes the drawer — pass.
7. Mobile: background scroll is locked while the drawer is open, restored on close — pass.
8. Mobile: drawer introduces zero horizontal overflow, both open and closed — pass.
9. Tablet: no drawer, no collapse button, zero overflow — pass.
10. A route change via the sidebar is a client-side navigation, not a full page reload (confirmed
    by a `window` marker surviving the navigation) — pass.
11. Dark theme: both the collapsed desktop sidebar and the mobile drawer render correctly — pass.

## 9. TypeScript and build results

- `tsc --noEmit`: clean, zero errors.
- Production build: clean — `index-C1s7wVQ_.css` (21.43 kB, up from 19.71 kB — the added
  collapse/drawer CSS), `index-DL8tGRVf.js` (420.81 kB).

## 10. Playwright test results

**70/70 existing tests passing** (full official regression suite, re-run fresh after this phase's
changes — not reused from an earlier phase), plus the 11 new sidebar/drawer interaction tests
reported separately above (11/11 passing), for **81/81 total**.

## 11. Remaining issues

None found in this phase's own scope. Two items carried forward from Phase 7's audit, unaffected
by this change and explicitly out of scope here (Phase 8B is RBAC menu visibility, intentionally
not touched in this phase per instruction):

- The sidebar still shows every navigation item to every logged-in user regardless of their
  permissions (Phase 7 audit, §6/§8 issue #9) — this is Phase 8B's scope, not this phase's.
- `/studies/:id`'s topbar title (Phase 7 audit, §8 issue #8) is unrelated to navigation layout and
  was left untouched.

No new issue was introduced by this phase's changes — confirmed by the 70/70 regression pass and
the 75/75 zero-overflow measurement.

## 12. Confirmation of scope boundaries

- **Backend**: no file under `backend/` was read for writing or modified. Confirmed via the diff
  being entirely within `frontend/src/components/Layout.tsx` and `frontend/src/styles.css`.
- **Database / clinical data**: no migration was run, no Prisma schema file was touched, no
  patient/study/report record was created, edited, or deleted.
- **Docker**: no `docker-compose.yml` change, no volume reset, no `docker compose down -v` was
  run. All 8 services (`backend`, `frontend`, `mwl-scp`, `nginx`, `ohif`, `orthanc`, `postgres`,
  `redis`) confirmed still present and healthy after the frontend container was rebuilt and
  redeployed (the only container touched, as expected for a frontend-only change).
- **NGINX**: no config file under any NGINX directory was modified.
- **OHIF**: no OHIF configuration or integration code was touched; `openStudyInViewer()` and its
  5 call sites are unchanged.
- **API contracts**: no backend route, DTO, or permission check was added, removed, or modified.
- **Authentication / RBAC enforcement**: unchanged — this phase explicitly did not implement menu
  visibility gating (Phase 8B's scope), and no `RequirePermissions` decorator or `PermissionsGuard`
  logic was touched.

---

Stopping here per the stop condition. Phase 8B and Phase 8C were not started. Awaiting review and
approval before any further phase.

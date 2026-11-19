import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { NotificationBell } from './NotificationBell';
import { ChangePasswordModal } from './ChangePasswordModal';

/**
 * Phase 8B — permission-to-navigation mapping. Every `perm` / `permAny` value
 * below is copied verbatim from the backend: either the exact string passed
 * to that route's `@RequirePermissions(...)` decorator, or — for the two
 * controllers that use OR semantics instead (`operational-integration.
 * controller.ts` / `operations-history.controller.ts`, both documented
 * in-source as "No @RequirePermissions at the route level... needs ANY ONE
 * of several view permissions") — the exact permission list named in that
 * service's own `ForbiddenException` message. No permission here was
 * invented or assumed; each was found by reading the controller (or, for the
 * two OR-gated ones, the service) that backs the route.
 *
 * - `perm`: a single required permission (AND — in practice just one here).
 * - `permAny`: the route is visible if the user holds ANY ONE of these.
 * - neither: no backend permission check exists for this route (confirmed by
 *   reading `admin.controller.ts` — Dashboard has only `JwtAuthGuard`, no
 *   `@RequirePermissions` at all) — visible to every authenticated user.
 */
const NAV = [
  { section: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: '📊' }] },
  {
    section: 'Radiology',
    items: [
      { to: '/worklist', label: 'Worklist', icon: '🗒️', perm: 'worklist.view' },
      { to: '/patients', label: 'Patients', icon: '🧑‍⚕️', perm: 'patient.view' },
      { to: '/orders', label: 'Examination Orders', icon: '🗓️', perm: 'order.manage' },
    ],
  },
  {
    section: 'PACS',
    items: [
      { to: '/pacs/monitor', label: 'PACS Monitoring', icon: '🖥️', perm: 'worklist.view' },
      { to: '/pacs/reception-logs', label: 'Reception Logs', icon: '📥', perm: 'worklist.view' },
      { to: '/pacs/reconciliation', label: 'Reconciliation', icon: '🔗', perm: 'study.view' },
      { to: '/pacs/mwl', label: 'Modality Worklist', icon: '📋', perm: 'worklist.view' },
    ],
  },
  {
    section: 'PACS Operations',
    items: [
      { to: '/pacs/operations/command-centre', label: 'Command Centre', icon: '📡',
        permAny: ['pacs.reverse-push.view', 'pacs.archive.view', 'pacs.storage.view', 'system.health.view', 'system.alert.view'] },
      { to: '/pacs/operations/exceptions', label: 'Exceptions Console', icon: '⚠️',
        permAny: ['pacs.reverse-push.view', 'pacs.archive.view', 'pacs.storage.view', 'system.health.view', 'system.alert.view'] },
      { to: '/pacs/reverse-push', label: 'Reverse Push Monitor', icon: '📤', perm: 'pacs.reverse-push.view' },
      { to: '/pacs/archive', label: 'Archive Compression', icon: '🗜️', perm: 'pacs.archive.view' },
      { to: '/pacs/storage', label: 'Storage Management', icon: '💾', perm: 'pacs.storage.view' },
      { to: '/pacs/operations/history', label: 'Transfer & Archive History', icon: '🕓',
        permAny: ['pacs.reverse-push.view', 'pacs.archive.view'] },
    ],
  },
  {
    section: 'Reporting',
    items: [
      { to: '/reporting', label: 'Reporting Worklist', icon: '📝', perm: 'report.view' },
    ],
  },
  {
    section: 'Operations',
    items: [
      { to: '/notifications', label: 'Notifications', icon: '🔔', perm: 'notification.view' },
      { to: '/ops/monitoring', label: 'System Monitoring', icon: '📈', perm: 'system.dashboard.view' },
      { to: '/ops/alerts', label: 'Alert Management', icon: '🚨', perm: 'system.alert.view' },
      { to: '/ops/audit', label: 'Audit Logs', icon: '🧾', perm: 'audit.view' },
    ],
  },
  {
    section: 'Administration',
    items: [
      { to: '/admin/organizations', label: 'Organizations', icon: '🏢', perm: 'org.manage' },
      { to: '/admin/departments', label: 'Departments', icon: '🏷️', perm: 'dept.manage' },
      { to: '/admin/doctors', label: 'Doctors', icon: '🩺', perm: 'doctor.manage' },
      { to: '/admin/users', label: 'Users', icon: '👤', perm: 'user.manage' },
      { to: '/admin/modalities', label: 'Modalities', icon: '🖥️', perm: 'modality.manage' },
      // Report Templates' list/GET is gated on report.view (any reporting user can see
      // the list to pick a template); mutation requires template.manage separately —
      // confirmed in templates.controller.ts and already enforced inside ReportTemplates.tsx.
      { to: '/admin/report-templates', label: 'Report Templates', icon: '📄', perm: 'report.view' },
    ],
  },
];

// Routes not represented in the sidebar (detail/drill-down pages) get an
// explicit title here; everything else is resolved from NAV itself below, so
// the topbar can never drift out of sync with the sidebar's own labels.
const EXTRA_TITLES: Array<[RegExp, string]> = [
  [/^\/patients\/[^/]+$/, 'Patient Details'],
  [/^\/studies\/[^/]+$/, 'Study Details'],
  [/^\/reports\/study\/[^/]+$/, 'Radiology Report'],
  [/^\/reports\/[^/]+$/, 'Radiology Report'],
];

function pageTitle(pathname: string): string {
  for (const g of NAV) {
    const hit = g.items.find((it) => it.to === pathname);
    if (hit) return hit.label;
  }
  for (const [pattern, title] of EXTRA_TITLES) {
    if (pattern.test(pathname)) return title;
  }
  return 'RIS · PACS';
}

/** Phase 8B: true if the current user may see this nav item. A route with
 * neither `perm` nor `permAny` (currently only Dashboard) has no backend
 * permission check and is visible to every authenticated user. `can()`
 * already handles the `isSuperAdmin` bypass (see lib/auth.tsx), so that is
 * not duplicated here. */
function visibleTo(it: { perm?: string; permAny?: string[]; [k: string]: any }, can: (p: string) => boolean): boolean {
  if (it.permAny) return it.permAny.some((p) => can(p));
  if (it.perm) return can(it.perm);
  return true;
}

/** The nav link list shared by the desktop sidebar and the mobile drawer —
 * same markup, same active-route highlighting, so there is exactly one place
 * that defines "what the navigation looks like". `collapsed` renders
 * icon-only links with a title tooltip; `onNavigate` lets the mobile drawer
 * close itself when a link is clicked. Each item is filtered by `visibleTo`
 * before rendering; a section with zero visible items renders nothing (no
 * empty section header left dangling). */
function NavLinks({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { can } = useAuth();
  return (
    <nav className="nav">
      {NAV.map((g) => {
        const items = g.items.filter((it) => visibleTo(it, can));
        if (items.length === 0) return null;
        return (
          <div key={g.section}>
            {!collapsed && <div className="nav-section">{g.section}</div>}
            {items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === '/'}
                onClick={onNavigate}
                title={collapsed ? it.label : undefined}
                aria-label={it.label}
              >
                <span className="nav-icon" aria-hidden="true">{it.icon}</span>
                {!collapsed && <span className="nav-label">{it.label}</span>}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useState(localStorage.getItem('theme') ?? 'light');
  // Desktop icon-only collapse — persisted like theme, since it's a standing
  // layout preference rather than per-session state.
  const [collapsed, setCollapsed] = useState(localStorage.getItem('sidebarCollapsed') === 'true');
  // Mobile off-canvas drawer — intentionally NOT persisted; every fresh page
  // load starts with the drawer closed.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [changePwOpen, setChangePwOpen] = useState(false);

  const toggleTheme = () => {
    const t = theme === 'light' ? 'dark' : 'light';
    setTheme(t);
    localStorage.setItem('theme', t);
    document.documentElement.setAttribute('data-theme', t);
  };
  const toggleCollapsed = () => {
    const c = !collapsed;
    setCollapsed(c);
    localStorage.setItem('sidebarCollapsed', String(c));
  };

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Drawer: close on Escape, lock background scroll while open.
  React.useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen]);

  // A route change (link click, back/forward, programmatic nav) always closes
  // the drawer — covers "selecting a link closes the drawer" even for links
  // that don't go through NavLinks' own onNavigate (e.g. none today, but this
  // keeps the drawer honest if one is ever added outside the sidebar).
  React.useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  return (
    <div className={`app${collapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span>🩻 {!collapsed && 'RIS·PACS'}</span>
          {!collapsed && <small>Enterprise Edition</small>}
        </div>
        <NavLinks collapsed={collapsed} />
        <button
          className="sidebar-collapse-btn"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '»' : '« Collapse'}
        </button>
      </aside>

      {drawerOpen && (
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <div
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="brand">
              <span>🩻 RIS·PACS</span>
              <small>Enterprise Edition</small>
              <button className="drawer-close-btn" onClick={() => setDrawerOpen(false)} aria-label="Close navigation menu">✕</button>
            </div>
            <NavLinks collapsed={false} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="hamburger-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
          >
            ☰
          </button>
          <strong>{pageTitle(location.pathname)}</strong>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <NotificationBell />
          <button className="btn sm" onClick={toggleTheme}>{theme === 'light' ? '🌙' : '☀️'}</button>
          <span className="muted">{me?.username} {me?.isSuperAdmin ? '(super admin)' : ''}</span>
          <button className="btn sm" onClick={() => setChangePwOpen(true)}>Change Password</button>
          <button className="btn sm" onClick={async () => { await logout(); nav('/login'); }}>Logout</button>
        </div>
      </header>
      <main className="main">{children}</main>
      {changePwOpen && <ChangePasswordModal onClose={() => setChangePwOpen(false)} />}
    </div>
  );
}

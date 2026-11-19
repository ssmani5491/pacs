import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { KpiCard } from '../components/KpiCard';

const MODALITY_COLORS = ['#3b82f6', '#16a34a', '#f59e0b', '#6366f1', '#0ea5e9', '#ef4444', '#b45309', '#6b7280'];

const fmtDate = (s: any) => (s ? new Date(s).toLocaleString() : '—');
const fmtDay = (s: any) => (s ? new Date(s).toLocaleDateString(undefined, { weekday: 'short' }) : '—');

export function Dashboard() {
  const nav = useNavigate();
  const { can } = useAuth();
  const seePatient = can('patient.view');

  const [admin, setAdmin] = useState<any>(null);
  const [sysDash, setSysDash] = useState<any>(null);
  const [alerts, setAlerts] = useState<any>(null);
  const [pendingAssignment, setPendingAssignment] = useState<number | null>(null);
  const [worklistCounts, setWorklistCounts] = useState<any>(null);
  const [reportingCounts, setReportingCounts] = useState<any>(null);
  const [recentFinal, setRecentFinal] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    const results = await Promise.allSettled([
      api.get('/admin/dashboard'),
      api.get('/system/dashboard'),
      api.get('/system/alerts/summary'),
      api.get('/worklist/pending-assignment' + qs({ pageSize: 1 })),
      api.get('/worklist/counts'),
      api.get('/reporting-worklist/counts'),
      api.get('/reporting-worklist' + qs({ bucket: 'FINAL', pageSize: 5 })),
      api.get('/notifications' + qs({ pageSize: 6 })),
    ]);
    const [a, sd, al, pa, wc, rc, rf, na] = results;
    if (a.status === 'fulfilled') setAdmin(a.value); else setErr((e) => e || a.reason?.message);
    if (sd.status === 'fulfilled') setSysDash(sd.value);
    if (al.status === 'fulfilled') setAlerts(al.value);
    if (pa.status === 'fulfilled') setPendingAssignment(pa.value?.total ?? null);
    if (wc.status === 'fulfilled') setWorklistCounts(wc.value);
    if (rc.status === 'fulfilled') setReportingCounts(rc.value);
    if (rf.status === 'fulfilled') setRecentFinal(rf.value?.data ?? []);
    if (na.status === 'fulfilled') setRecentActivity(na.value?.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const modalityStats: any[] = admin?.modalityStats ?? [];
  const maxModalityCount = Math.max(1, ...modalityStats.map((m) => m.count ?? 0));

  const statusDist = [
    { key: 'READY', label: 'Ready', count: worklistCounts?.READY, color: 'var(--status-info)' },
    { key: 'DRAFT', label: 'Draft', count: worklistCounts?.DRAFT, color: 'var(--status-neutral)' },
    { key: 'PRELIMINARY', label: 'Preliminary', count: worklistCounts?.PRELIMINARY, color: 'var(--status-warning)' },
    { key: 'FINAL', label: 'Final', count: worklistCounts?.FINAL, color: 'var(--status-success)' },
    { key: 'CANCELLED', label: 'Cancelled', count: worklistCounts?.CANCELLED, color: 'var(--status-danger)' },
  ];
  const maxStatusCount = Math.max(1, ...statusDist.map((s) => s.count ?? 0));

  const quickActions = [
    { label: 'Patient Management', sub: 'Search and manage patients', icon: '🧑‍⚕️', to: '/patients', show: seePatient },
    { label: 'RIS Worklist', sub: 'Study worklist & filters', icon: '🗒️', to: '/worklist', show: true },
    { label: 'Reporting Worklist', sub: 'Draft, sign & finalize reports', icon: '📝', to: '/reporting', show: true },
    { label: 'PACS Viewer', sub: 'PACS monitoring & study access', icon: '🖥️', to: '/pacs/monitor', show: true },
    { label: 'Operational Command Centre', sub: 'Transfers, archive & storage', icon: '📡', to: '/pacs/operations/command-centre', show: true },
  ].filter((a) => a.show);

  return (
    <div>
      <div className="page-head">
        <h1>Dashboard</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {admin?.generatedAt && <span className="muted" style={{ fontSize: 12 }}>as of {fmtDate(admin.generatedAt)}</span>}
          <button className="btn sm" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      {err && <div className="error">Could not load dashboard: {err}</div>}
      {loading && !admin && <div className="card muted" style={{ padding: 20 }}>Loading dashboard…</div>}

      {/* KPI cards */}
      <div className="kpi-grid">
        <KpiCard label="Total Patients" icon="🧑‍⚕️" value={admin ? admin.patients ?? 0 : '—'} sub={admin ? `${admin.patientsToday ?? 0} registered today` : undefined} />
        <KpiCard label="Today's Studies" icon="🩻" value={sysDash ? sysDash.studiesToday ?? 0 : (admin ? '—' : '—')} sub={sysDash ? `${sysDash.studiesMonth ?? 0} this month` : undefined} />
        <KpiCard label="Pending Reports" icon="⏳" value={reportingCounts ? (reportingCounts.UNREPORTED ?? 0) + (reportingCounts.DRAFT ?? 0) : (admin ? admin.pendingStudies ?? 0 : '—')}
          color="var(--status-warning)" sub="Unreported + draft" />
        <KpiCard label="Reports Completed" icon="✅" value={admin ? admin.reports?.final ?? 0 : '—'} color="var(--status-success)" sub="Finalized reports (all time)" />
        <KpiCard label="Needs Attention" icon="⚠️" value={alerts ? alerts.open ?? 0 : '—'} color={alerts?.critical ? 'var(--status-danger)' : 'var(--status-warning)'}
          sub={alerts ? `${alerts.critical ?? 0} critical operational alert${alerts.critical === 1 ? '' : 's'}` : 'Open operational alerts'} />
        <KpiCard label="Studies Awaiting Assignment" icon="📋" value={pendingAssignment ?? (admin ? admin.pendingStudies ?? 0 : '—')} />
      </div>

      {/* Study statistics + operational summary */}
      <div className="dash-columns">
        <div>
          <div className="dash-section">
            <div className="dash-section-head"><h2>Study Statistics</h2></div>
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ marginTop: 0, fontSize: 'var(--font-base)' }}>Studies by Modality</h3>
              {modalityStats.length ? (
                <div className="bar-chart">
                  {modalityStats.map((m, i) => (
                    <div className="bar-chart-row" key={m.modality}>
                      <span>{m.modality}</span>
                      <div className="bar-chart-track">
                        <div className="bar-chart-fill" style={{ width: `${(m.count / maxModalityCount) * 100}%`, background: MODALITY_COLORS[i % MODALITY_COLORS.length] }} />
                      </div>
                      <span className="muted" style={{ textAlign: 'right' }}>{m.count}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="mini-list-empty">No studies yet.</div>}

              <h3 style={{ fontSize: 'var(--font-base)' }}>Study Status Distribution</h3>
              {worklistCounts ? (
                <div className="bar-chart">
                  {statusDist.map((s) => (
                    <div className="bar-chart-row" key={s.key}>
                      <span>{s.label}</span>
                      <div className="bar-chart-track">
                        <div className="bar-chart-fill" style={{ width: `${((s.count ?? 0) / maxStatusCount) * 100}%`, background: s.color }} />
                      </div>
                      <span className="muted" style={{ textAlign: 'right' }}>{s.count ?? 0}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="mini-list-empty">No worklist data.</div>}

              <h3 style={{ fontSize: 'var(--font-base)' }}>Reporting Workload</h3>
              {reportingCounts ? (
                <div className="bar-chart">
                  {['UNREPORTED', 'DRAFT', 'PRELIMINARY', 'FINAL', 'ADDENDUM'].map((k) => (
                    <div className="bar-chart-row" key={k}>
                      <span>{k}</span>
                      <div className="bar-chart-track">
                        <div className="bar-chart-fill" style={{ width: `${((reportingCounts[k] ?? 0) / Math.max(1, reportingCounts.ALL ?? 1)) * 100}%`, background: 'var(--primary)' }} />
                      </div>
                      <span className="muted" style={{ textAlign: 'right' }}>{reportingCounts[k] ?? 0}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="mini-list-empty">No reporting data.</div>}
            </div>
          </div>
        </div>

        <div>
          <div className="dash-section">
            <div className="dash-section-head"><h2>Operational Summary</h2></div>

            <div className="card" style={{ padding: 16, marginBottom: 'var(--space-4)' }}>
              <h3 style={{ marginTop: 0, fontSize: 'var(--font-base)' }}>Recent Completed Reports</h3>
              <div className="mini-list">
                {recentFinal.length ? recentFinal.map((r: any) => (
                  <div className="mini-list-row" key={r.studyId}>
                    <span>{seePatient ? r.patientName : r.accessionNumber} · {r.modality}</span>
                    <button className="btn sm" onClick={() => nav(`/reports/study/${r.studyId}`)}>Open</button>
                  </div>
                )) : <div className="mini-list-empty">No completed reports yet.</div>}
              </div>
            </div>

            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ marginTop: 0, fontSize: 'var(--font-base)' }}>Recent System Activity</h3>
              <div className="mini-list">
                {recentActivity.length ? recentActivity.map((n: any) => (
                  <div className="mini-list-row" key={n.id}>
                    <span>{n.title ?? n.message ?? n.category}</span>
                    <span className="muted" style={{ fontSize: 'var(--font-xs)' }}>{fmtDay(n.createdAt)}</span>
                  </div>
                )) : <div className="mini-list-empty">No recent activity.</div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="dash-section">
        <div className="dash-section-head"><h2>Quick Actions</h2></div>
        <div className="quick-actions">
          {quickActions.map((a) => (
            <button key={a.to} className="quick-action" onClick={() => nav(a.to)}>
              <span className="quick-action-icon">{a.icon}</span>
              <span className="quick-action-label">{a.label}</span>
              <span className="quick-action-sub">{a.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="muted" style={{ marginTop: 'var(--space-6)', fontSize: 'var(--font-xs)' }}>All metrics are live from the database.</p>
    </div>
  );
}

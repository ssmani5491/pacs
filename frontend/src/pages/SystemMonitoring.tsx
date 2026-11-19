import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { StatusDot } from '../components/StatusBadge';
import { KpiCard } from '../components/KpiCard';

export function SystemMonitoring() {
  const [health, setHealth] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [alerts, setAlerts] = useState<{ open: number; critical: number }>({ open: 0, critical: 0 });
  const [backups, setBackups] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (fresh = false) => {
    setRefreshing(true); setErr('');
    try {
      const [h, m, a, b] = await Promise.all([
        api.get('/system/health-status' + (fresh ? '?fresh=true' : '')),
        api.get('/system/dashboard'),
        api.get('/system/alerts/summary'),
        api.get('/backups?limit=12').catch(() => []),
      ]);
      setHealth(h); setMetrics(m); setAlerts(a); setBackups(b);
    } catch (e: any) { setErr(e.message); } finally { setRefreshing(false); }
  }, []);

  function fmtBytes(b: any) {
    const n = Number(b);
    if (!n) return '—';
    if (n > 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  useEffect(() => {
    load();
    const t = setInterval(() => load(false), 30000); // poll cached status every 30s
    return () => clearInterval(t);
  }, [load]);

  const metricTiles = metrics ? [
    { label: 'Studies Today', value: metrics.studiesToday },
    { label: 'Studies This Month', value: metrics.studiesMonth },
    { label: 'Pending Reconciliation', value: metrics.pendingReconciliation },
    { label: 'Failed Receptions', value: metrics.failedReceptions },
    { label: 'Active Modalities', value: metrics.activeModalities },
    { label: 'MWL Queries Today', value: metrics.mwlQueriesToday },
    { label: 'Preliminary Reports', value: metrics.preliminaryReports },
    { label: 'Finalized Reports', value: metrics.finalizedReports },
    { label: 'Signed Reports', value: metrics.signedReports },
    { label: 'Open Alerts', value: alerts.open },
    { label: 'Critical Alerts', value: alerts.critical, crit: alerts.critical > 0 },
  ] : [];

  return (
    <div>
      <div className="page-head"><h1>System Monitoring</h1>
        <button className="btn sm" disabled={refreshing} onClick={() => load(true)}>{refreshing ? 'Checking…' : 'Run health check'}</button>
      </div>
      {err && <div className="error">{err}</div>}

      {alerts.critical > 0 && (
        <div className="error">
          ⚠ {alerts.critical} CRITICAL alert{alerts.critical > 1 ? 's' : ''} open — see Alert Management.
        </div>
      )}

      <h3>Service Health</h3>
      <div className="card ops-table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Service</th><th>Status</th><th>Response</th><th>Last Success</th><th>Last Failure</th><th>Detail</th></tr></thead>
          <tbody>
            {health.map((s) => (
              <tr key={s.service}>
                <td><strong>{s.service}</strong></td>
                <td><StatusDot status={s.status} /></td>
                <td>{s.responseMs != null ? `${s.responseMs} ms` : '—'}</td>
                <td>{s.lastSuccessAt ? new Date(s.lastSuccessAt).toLocaleString() : '—'}</td>
                <td>{s.lastFailureAt ? new Date(s.lastFailureAt).toLocaleString() : '—'}</td>
                <td className="muted">{s.detail ?? '—'}</td>
              </tr>
            ))}
            {health.length === 0 && <tr><td colSpan={6} className="muted">No health data yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h3>Backup Status</h3>
      <div className="card ops-table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Component</th><th>Status</th><th>Verified</th><th>Size</th><th>Duration</th><th>Started</th><th>Detail</th></tr></thead>
          <tbody>
            {backups.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.component}</strong></td>
                <td><span className={`badge ${r.status === 'SUCCESS' ? 'ok' : r.status === 'RUNNING' ? 'status-neutral' : 'off'}`}>{r.status}</span></td>
                <td>{r.verified ? '✓' : '—'}</td>
                <td>{fmtBytes(r.bytes)}</td>
                <td>{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                <td>{r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}</td>
                <td className="muted">{r.error ?? r.verifyDetail ?? '—'}</td>
              </tr>
            ))}
            {backups.length === 0 && <tr><td colSpan={7} className="muted">No backup runs recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h3>Operational Metrics</h3>
      <div className="ops-kpi-row">
        {metricTiles.map((t) => (
          <KpiCard key={t.label} label={t.label} value={t.value ?? '—'} color={t.crit ? 'var(--status-danger)' : undefined} />
        ))}
      </div>
      {metrics && <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Generated {new Date(metrics.generatedAt).toLocaleString()}</div>}
    </div>
  );
}

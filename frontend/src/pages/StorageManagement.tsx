import React, { useEffect, useState, useCallback } from 'react';
import { api, qs, getAccess } from '../lib/api';
import { useAuth } from '../lib/auth';
import { KpiCard } from '../components/KpiCard';

const fmtBytes = (b: any) => {
  if (b == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let n = Number(b), i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const LEVEL_COLOR: Record<string, string> = {
  INFO: 'var(--status-info)', WARNING: 'var(--status-warning)', HIGH: '#f97316', CRITICAL: 'var(--status-danger)',
};

/** Disk-utilization gauge — kept as its own component (a progress bar is a
 * genuinely different visual from a plain KpiCard), but now built on top of
 * KpiCard's card/label/value shape instead of duplicating it from scratch. */
function Gauge({ label, pct, sub }: { label: string; pct: number; sub?: string }) {
  const color = pct >= 95 ? 'var(--status-danger)' : pct >= 90 ? '#f97316' : pct >= 80 ? 'var(--status-warning)' : pct >= 70 ? 'var(--status-info)' : 'var(--status-success)';
  return (
    <KpiCard label={label} value={`${pct}%`} color={color} sub={
      <>
        <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', margin: '6px 0' }}>
          <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color }} />
        </div>
        {sub}
      </>
    } />
  );
}

export function StorageManagement() {
  const { can } = useAuth();
  const [d, setD] = useState<any>(null);
  const [hist, setHist] = useState<any[]>([]);
  const [cfg, setCfg] = useState<any>(null);
  const [tab, setTab] = useState<'overview' | 'modality' | 'growth' | 'history' | 'config'>('overview');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [dash, h, c] = await Promise.all([
        api.get('/pacs/storage/dashboard'),
        api.get('/pacs/storage/history?pageSize=30'),
        api.get('/pacs/storage/config'),
      ]);
      setD(dash); setHist(h.data); setCfg(c);
    } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const snapshot = async () => { setBusy(true); setErr(''); try { await api.post('/pacs/storage/snapshot'); load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const saveCfg = async () => { setBusy(true); setErr(''); try { await api.patch('/pacs/storage/config', { thresholds: cfg.thresholds }); load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const exportCsv = async () => {
    try {
      const res = await fetch('/api/pacs/storage/history/export', { headers: { Authorization: `Bearer ${getAccess()}` } });
      if (!res.ok) { setErr(`Export failed (${res.status})`); return; }
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `storage-history-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <div>
      <div className="page-head"><h1>Storage Management</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {can('pacs.storage.manage') && <button className="btn sm" disabled={busy} onClick={snapshot}>Capture Snapshot</button>}
          <button className="btn sm" onClick={load}>Refresh</button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      {d?.alertLevel && (
        <div className="error" style={{ background: '#fff7ed', borderColor: LEVEL_COLOR[d.alertLevel], color: '#9a3412' }}>
          ⚠ Storage {d.alertLevel}: disk utilization {d.disk.usedPercent}% (threshold reached). See Alert Management.
        </div>
      )}

      <div className="toolbar">
        {(['overview', 'modality', 'growth', 'history', 'config'] as const).map((t) => (
          <button key={t} className={`btn sm ${tab === t ? 'primary' : ''}`} onClick={() => setTab(t)}>{t.toUpperCase()}</button>
        ))}
        <span className="muted" style={{ marginLeft: 'auto' }}>Real-time from Orthanc + filesystem</span>
      </div>

      {tab === 'overview' && d && (
        <>
          <h3>Capacity</h3>
          <div className="ops-kpi-row">
            <Gauge label="Disk Utilization" pct={d.disk.usedPercent} sub={`${fmtBytes(d.disk.usedBytes)} / ${fmtBytes(d.disk.totalBytes)}`} />
            <KpiCard label="Available" value={fmtBytes(d.disk.availableBytes)} />
            <KpiCard label="Orthanc Storage" value={fmtBytes(d.orthanc.bytes)} />
            <KpiCard label="Archive Storage" value={fmtBytes(d.archive.bytes)} />
          </div>
          <h3>PACS Statistics</h3>
          <div className="ops-kpi-row">
            <KpiCard label="Patients" value={d.orthanc.patients} />
            <KpiCard label="Studies" value={d.orthanc.studies} />
            <KpiCard label="Series" value={d.orthanc.series} />
            <KpiCard label="Instances" value={d.orthanc.instances} />
          </div>
        </>
      )}

      {tab === 'modality' && d && (
        <div className="card ops-table-wrap"><table>
          <thead><tr><th>Modality</th><th>Studies</th><th>Storage</th><th>Share</th></tr></thead>
          <tbody>
            {d.modalityBreakdown.map((m: any) => {
              const totalBytes = d.modalityBreakdown.reduce((s: number, x: any) => s + x.bytes, 0) || 1;
              return (<tr key={m.modality}><td><strong>{m.modality}</strong></td><td>{m.count}</td><td>{fmtBytes(m.bytes)}</td><td>{((m.bytes / totalBytes) * 100).toFixed(1)}%</td></tr>);
            })}
            {d.modalityBreakdown.length === 0 && <tr><td colSpan={4} className="muted">No stored studies.</td></tr>}
          </tbody>
        </table></div>
      )}

      {tab === 'growth' && d && (
        <>
          <h3>Growth</h3>
          <div className="ops-kpi-row">
            <KpiCard label="Daily Growth" value={d.growth.dailyGrowthBytes != null ? fmtBytes(d.growth.dailyGrowthBytes) : '—'} />
            <KpiCard label="Monthly Growth" value={d.growth.monthlyGrowthBytes != null ? fmtBytes(d.growth.monthlyGrowthBytes) : '—'} />
          </div>
          <h3>Forecast (days until threshold)</h3>
          {d.growth.forecast ? (
            <div className="card">
              <div className="ops-kpi-row">
                {['p70', 'p80', 'p90', 'p95'].map((k) => (
                  <KpiCard key={k} label={`${k.slice(1)}% in`} value={d.growth.forecast.daysUntil[k] != null ? `${d.growth.forecast.daysUntil[k]} d` : 'n/a'} />
                ))}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>{d.growth.forecast.basis}</div>
            </div>
          ) : <div className="card muted">{d.growth.note ?? 'Forecast needs more snapshots.'}</div>}
        </>
      )}

      {tab === 'history' && (
        <div>
          <div className="toolbar"><button className="btn sm primary" onClick={exportCsv}>Export CSV</button></div>
          <div className="card ops-table-wrap"><table>
            <thead><tr><th>Captured</th><th>Disk Used</th><th>Used %</th><th>Orthanc</th><th>Archive</th><th>Instances</th></tr></thead>
            <tbody>
              {hist.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.capturedAt).toLocaleString()}</td>
                  <td>{fmtBytes(r.diskUsedBytes)}</td>
                  <td>{r.diskTotalBytes > 0 ? ((r.diskUsedBytes / r.diskTotalBytes) * 100).toFixed(1) : '0'}%</td>
                  <td>{fmtBytes(r.orthancBytes)}</td>
                  <td>{fmtBytes(r.archiveBytes)}</td>
                  <td>{r.instances}</td>
                </tr>
              ))}
              {hist.length === 0 && <tr><td colSpan={6} className="muted">No snapshots yet.</td></tr>}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === 'config' && cfg && (
        <div className="card" style={{ maxWidth: 420 }}>
          <h3>Storage Alert Thresholds (% disk used)</h3>
          {(['info', 'warning', 'high', 'critical'] as const).map((k) => (
            <div key={k}><label>{k.charAt(0).toUpperCase() + k.slice(1)}</label>
              <input type="number" min={1} max={100} value={cfg.thresholds[k]} disabled={!can('pacs.storage.manage')}
                onChange={(e) => setCfg({ ...cfg, thresholds: { ...cfg.thresholds, [k]: Number(e.target.value) } })} />
            </div>
          ))}
          <div className="muted" style={{ fontSize: 12 }}>Crossing a threshold raises a system alert + notification (Phase 8).</div>
          {can('pacs.storage.manage') && <div style={{ marginTop: 14 }}><button className="btn primary" disabled={busy} onClick={saveCfg}>Save</button></div>}
        </div>
      )}
    </div>
  );
}

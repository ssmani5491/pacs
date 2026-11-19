import React, { useEffect, useState, useCallback } from 'react';
import { api, qs } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { KpiCard } from '../components/KpiCard';

export function MwlMonitor() {
  const [mon, setMon] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');

  const loadMon = useCallback(() => api.get('/pacs/mwl/monitor').then(setMon).catch((e) => setErr(e.message)), []);
  const loadLogs = useCallback(async () => {
    try {
      const res = await api.get('/pacs/mwl/logs' + qs({ page, pageSize: 20, status: status || undefined }));
      setLogs(res.data); setMeta({ total: res.total, page: res.page, totalPages: res.totalPages });
    } catch (e: any) { setErr(e.message); }
  }, [page, status]);

  useEffect(() => { loadMon(); const t = setInterval(() => { loadMon(); loadLogs(); }, 10000); return () => clearInterval(t); }, [loadMon, loadLogs]);
  useEffect(() => { loadLogs(); }, [loadLogs]);

  const fmt = (d: string) => d ? new Date(d).toLocaleString() : '—';

  return (
    <div>
      <div className="page-head"><h1>Modality Worklist (MWL)</h1><button className="btn sm" onClick={() => { loadMon(); loadLogs(); }}>Refresh</button></div>
      {err && <div className="error">{err}</div>}
      <p className="muted">MWL SCP: AE Title <strong>GGHMWL</strong>, port <strong>4243</strong>. Modalities query scheduled orders via DICOM C-FIND.</p>

      <h3>Query Statistics</h3>
      <div className="ops-kpi-row">
        <KpiCard label="Total Queries" value={mon ? (mon.total ?? 0) : '—'} />
        <KpiCard label="Success" value={mon ? (mon.success ?? 0) : '—'} color="var(--status-success)" />
        <KpiCard label="No Match" value={mon ? (mon.noMatch ?? 0) : '—'} color={mon?.noMatch ? 'var(--status-warning)' : undefined} />
        <KpiCard label="Rejected" value={mon ? (mon.rejected ?? 0) : '—'} />
        <KpiCard label="Failed" value={mon ? (mon.failed ?? 0) : '—'} color={mon?.failed ? 'var(--status-danger)' : undefined} />
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Last query: {fmt(mon?.lastQueryAt)}</p>

      {mon?.byCallingAet?.length > 0 && (
        <>
          <h3 style={{ marginTop: 20 }}>By Calling AE</h3>
          <div className="card ops-table-wrap">
            <table><thead><tr><th>Calling AE Title</th><th>Queries</th></tr></thead>
              <tbody>{mon.byCallingAet.map((a: any) => (
                <tr key={a.callingAet}><td>{a.callingAet}</td><td>{a.count}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      <h3 style={{ marginTop: 20 }}>Query Logs</h3>
      <div className="toolbar">
        {['', 'SUCCESS', 'NO_MATCH', 'REJECTED', 'FAILED'].map((s) => (
          <button key={s || 'ALL'} className={`btn sm ${status === s ? 'primary' : ''}`}
            onClick={() => { setStatus(s); setPage(1); }}>{s || 'ALL'}</button>
        ))}
      </div>
      <div className="card ops-table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Status</th><th>Calling AE</th><th>Matches</th><th>Filters</th></tr></thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan={5} className="muted">No MWL queries yet.</td></tr>}
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{fmt(l.createdAt)}</td>
                <td><StatusBadge status={l.status} /></td>
                <td>{l.callingAet ?? '—'}</td>
                <td>{l.matchCount}</td>
                <td className="muted" style={{ fontSize: 12 }}>{l.filters ? JSON.stringify(l.filters) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pager">
          <span className="muted">{meta.total} total · page {meta.page}/{meta.totalPages}</span>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <button className="btn sm" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}

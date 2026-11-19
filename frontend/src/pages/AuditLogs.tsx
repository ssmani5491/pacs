import React, { useEffect, useState, useCallback } from 'react';
import { api, qs, getAccess } from '../lib/api';
import { useAuth } from '../lib/auth';

export function AuditLogs() {
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [username, setUsername] = useState('');
  const [action, setAction] = useState('');
  const [status, setStatus] = useState('');
  const [ip, setIp] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const params = useCallback(() => ({
    page, pageSize: 25,
    username: username || undefined, action: action || undefined, status: status || undefined,
    ip: ip || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
  }), [page, username, action, status, ip, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await api.get('/audit-logs' + qs(params())); setRows(r.data); setMeta({ total: r.total, page: r.page, totalPages: r.totalPages }); }
    catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  const search = () => { setPage(1); load(); };
  const clear = () => { setUsername(''); setAction(''); setStatus(''); setIp(''); setDateFrom(''); setDateTo(''); setPage(1); };

  const exportCsv = async () => {
    // Export respects the same filters + server-side auth. Fetch with the bearer
    // token (download endpoints don't go through the JSON api client).
    try {
      const res = await fetch('/api/audit-logs/export' + qs({ ...params(), page: undefined, pageSize: undefined }), {
        headers: { Authorization: `Bearer ${getAccess()}` },
      });
      if (!res.ok) { setErr(`Export failed (${res.status})`); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `audit-export-${Date.now()}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <div>
      <div className="page-head"><h1>Audit Logs</h1>
        {can('audit.export') && <button className="btn sm primary" onClick={exportCsv}>Export CSV</button>}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="grid2">
          <div><label>Username</label><input value={username} onChange={(e) => setUsername(e.target.value)} /></div>
          <div><label>Action</label><input value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. REPORT_SIGN" /></div>
          <div><label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option><option value="SUCCESS">Success</option><option value="FAILURE">Failure</option>
            </select>
          </div>
          <div><label>IP</label><input value={ip} onChange={(e) => setIp(e.target.value)} /></div>
          <div><label>From / To</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn primary" onClick={search}>Search</button>
          <button className="btn" onClick={clear}>Clear</button>
        </div>
      </div>

      {err && <div className="error">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Status</th><th>Entity</th><th>IP</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="muted">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6} className="muted">No audit records.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>{r.username ?? r.fullName ?? <span className="muted">system</span>}</td>
                <td>{r.action}</td>
                <td><span className={`badge ${r.status === 'FAILURE' ? 'draft' : 'ready'}`}>{r.status}</span></td>
                <td>{r.entityType ? `${r.entityType}${r.entityId ? ` (${String(r.entityId).slice(0, 8)}…)` : ''}` : '—'}</td>
                <td>{r.ip ?? '—'}</td>
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

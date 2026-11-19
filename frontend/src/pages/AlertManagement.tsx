import React, { useEffect, useState, useCallback } from 'react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { StatusBadge } from '../components/StatusBadge';

export function AlertManagement() {
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [level, setLevel] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const params = useCallback(() => ({ page, pageSize: 25, status: status || undefined, level: level || undefined }), [page, status, level]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await api.get('/system/alerts' + qs(params())); setRows(r.data); setMeta({ total: r.total, page: r.page, totalPages: r.totalPages }); }
    catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  const ack = async (id: string) => { try { await api.post(`/system/alerts/${id}/acknowledge`); load(); } catch (e: any) { setErr(e.message); } };
  const resolve = async (id: string) => {
    if (!window.confirm('Resolve this alert? Record the resolution.')) return;
    try { await api.post(`/system/alerts/${id}/resolve`); load(); } catch (e: any) { setErr(e.message); }
  };

  return (
    <div>
      <div className="page-head"><h1>Alert Management</h1></div>

      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        {['', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'].map((s) => (
          <button key={s} className={`btn sm ${status === s ? 'primary' : ''}`} onClick={() => { setStatus(s); setPage(1); }}>{s || 'ALL'}</button>
        ))}
        <select style={{ width: 'auto', marginLeft: 'auto' }} value={level} onChange={(e) => { setLevel(e.target.value); setPage(1); }}>
          <option value="">All levels</option><option>INFO</option><option>WARNING</option><option>HIGH</option><option>CRITICAL</option>
        </select>
      </div>

      {err && <div className="error">{err}</div>}
      <div className="card ops-table-wrap">
        <table>
          <thead><tr><th>Level</th><th>Status</th><th>Title</th><th>Source</th><th>Occurrences</th><th>First Seen</th><th>Actions</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="muted">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="muted">No alerts.</td></tr>}
            {!loading && rows.map((a) => (
              <tr key={a.id} style={a.level === 'CRITICAL' && a.status !== 'RESOLVED' ? { background: 'color-mix(in srgb, var(--status-danger) 8%, transparent)' } : undefined}>
                <td><StatusBadge status={a.level} /></td>
                <td><StatusBadge status={a.status} /></td>
                <td>{a.title}{a.detail && <div className="muted" style={{ fontSize: 12 }}>{a.detail}</div>}</td>
                <td>{a.source ?? '—'}</td>
                <td>{a.occurrences}</td>
                <td>{new Date(a.firstSeenAt).toLocaleString()}</td>
                <td>
                  <div className="row-actions">
                    {a.status === 'OPEN' && can('system.alert.acknowledge') && <button className="btn sm" onClick={() => ack(a.id)}>Acknowledge</button>}
                    {a.status !== 'RESOLVED' && can('system.alert.resolve') && <button className="btn sm primary" onClick={() => resolve(a.id)}>Resolve</button>}
                    {a.status === 'RESOLVED' && <span className="muted" style={{ fontSize: 12 }}>by {a.resolvedBy === 'SYSTEM' ? 'auto-recovery' : 'operator'}</span>}
                  </div>
                </td>
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

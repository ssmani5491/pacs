import React, { useEffect, useState, useCallback } from 'react';
import { api, qs } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';

export function ReceptionLogs() {
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/pacs/reception-logs' + qs({ page, pageSize: 25, status: status || undefined }));
      setRows(res.data); setMeta({ total: res.total, page: res.page, totalPages: res.totalPages });
    } catch (e: any) { setErr(e.message); }
  }, [page, status]);
  useEffect(() => { load(); }, [load]);

  const fmt = (d: string) => new Date(d).toLocaleString();

  return (
    <div>
      <div className="page-head"><h1>DICOM Reception Logs</h1></div>
      {err && <div className="error">{err}</div>}
      <div className="toolbar">
        {['', 'INGESTED', 'MATCHED', 'ORPHAN', 'FAILED', 'DUPLICATE'].map((s) => (
          <button key={s || 'ALL'} className={`btn sm ${status === s ? 'primary' : ''}`}
            onClick={() => { setStatus(s); setPage(1); }}>{s || 'ALL'}</button>
        ))}
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={load}>Refresh</button>
      </div>
      <div className="card ops-table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Status</th><th>Accession</th><th>Modality</th><th>Series</th><th>Images</th><th>Message</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No reception events yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{fmt(r.createdAt)}</td>
                <td><StatusBadge status={r.status} /></td>
                <td>{r.accessionNumber ?? '—'}</td>
                <td>{r.modality ?? '—'}</td>
                <td>{r.seriesCount}</td>
                <td>{r.instanceCount}</td>
                <td className="muted">{r.message ?? '—'}</td>
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

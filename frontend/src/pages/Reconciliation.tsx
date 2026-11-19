import React, { useEffect, useState, useCallback } from 'react';
import { api, qs } from '../lib/api';

// Unmatched/orphan studies awaiting manual reconciliation to a patient.
export function Reconciliation() {
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [err, setErr] = useState('');
  const [picking, setPicking] = useState<any | null>(null);
  const [mrn, setMrn] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/pacs/reconciliation/unmatched' + qs({ page, pageSize: 20 }));
      setRows(res.data); setMeta({ total: res.total, page: res.page, totalPages: res.totalPages });
    } catch (e: any) { setErr(e.message); }
  }, [page]);
  useEffect(() => { load(); }, [load]);

  async function reconcile() {
    setMsg('');
    try {
      // resolve MRN -> patient id
      const pr = await api.get('/patients' + qs({ search: mrn, pageSize: 5 }));
      const match = pr.data.find((p: any) => p.mrn === mrn) ?? pr.data[0];
      if (!match) { setMsg('No patient found for that MRN'); return; }
      await api.post(`/pacs/reconciliation/${picking.id}/reconcile`, { patientId: match.id });
      setPicking(null); setMrn(''); load();
    } catch (e: any) { setMsg(e.message); }
  }

  return (
    <div>
      <div className="page-head"><h1>Study Reconciliation</h1><button className="btn sm" onClick={load}>Refresh</button></div>
      {err && <div className="error">{err}</div>}
      <p className="muted">Studies that arrived without a matching order or patient. Attach each to the correct patient.</p>
      <div className="card">
        <table>
          <thead><tr><th>Study UID</th><th>Accession</th><th>Modality</th><th>Description</th><th>Provisional Patient</th><th>Images</th><th>Action</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No unmatched studies. 🎉</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.studyInstanceUid?.slice(-20)}</td>
                <td>{r.accessionNumber ?? '—'}</td>
                <td>{r.modality ?? '—'}</td>
                <td>{r.description ?? '—'}</td>
                <td>{r.patient ? `${r.patient.mrn} — ${r.patient.name}` : '—'}</td>
                <td>{r.imageCount}</td>
                <td><button className="btn sm primary" onClick={() => { setPicking(r); setMrn(''); setMsg(''); }}>Reconcile</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pager">
          <span className="muted">{meta.total} unmatched · page {meta.page}/{meta.totalPages}</span>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <button className="btn sm" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>

      {picking && (
        <div className="modal-bg" onClick={() => setPicking(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="page-head"><h1 style={{ fontSize: 17 }}>Reconcile Study</h1>
              <button className="btn sm" onClick={() => setPicking(null)}>✕</button></div>
            {msg && <div className="error">{msg}</div>}
            <p className="muted">Attach this study to a patient by Patient ID (MRN).</p>
            <label>Patient ID (MRN)</label>
            <input value={mrn} onChange={(e) => setMrn(e.target.value)} placeholder="e.g. GG00001001" />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn primary" onClick={reconcile} disabled={!mrn}>Reconcile</button>
              <button className="btn" onClick={() => setPicking(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

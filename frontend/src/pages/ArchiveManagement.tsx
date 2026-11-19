import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Modal } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { KpiCard } from '../components/KpiCard';

const fmtBytes = (b: any) => {
  if (b == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB']; let n = Number(b), i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};

export function ArchiveManagement() {
  const { can } = useAuth();
  const [mon, setMon] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [cfg, setCfg] = useState<any>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'monitor' | 'jobs' | 'config'>('monitor');
  const [showArchive, setShowArchive] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [form, setForm] = useState<any>({ compressionLevel: 6 });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, j, c] = await Promise.all([
        api.get('/pacs/archive/monitor'),
        api.get('/pacs/archive/jobs?pageSize=25'),
        api.get('/pacs/archive/config'),
      ]);
      setMon(m); setJobs(j.data); setCfg(c);
    } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const createJob = async () => {
    setBusy(true); setErr('');
    try { await api.post('/pacs/archive/jobs', { studyInstanceUid: form.studyInstanceUid, compressionLevel: Number(form.compressionLevel) }); setShowArchive(false); setForm({ compressionLevel: 6 }); setTab('jobs'); load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const jobAction = async (id: string, action: string) => {
    setBusy(true); setErr('');
    try { const r = await api.post(`/pacs/archive/jobs/${id}/${action}`); if (action === 'restore') window.alert(`Restored to ${r.restoredTo}\n${r.zipEntries} entries.\n${r.note}`); load(); if (detail) setDetail(await api.get(`/pacs/archive/jobs/${id}`)); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const saveCfg = async () => {
    setBusy(true); setErr('');
    try { await api.patch('/pacs/archive/config', { compressionLevel: Number(cfg.defaultCompressionLevel), workerThreads: Number(cfg.workerThreads) }); load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="page-head"><h1>Archive Compression</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {can('pacs.archive.manage') && <button className="btn sm primary" onClick={() => setShowArchive(true)}>+ Archive Study</button>}
          <button className="btn sm" onClick={load}>Refresh</button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="toolbar">
        {(['monitor', 'jobs', 'config'] as const).map((t) => (
          <button key={t} className={`btn sm ${tab === t ? 'primary' : ''}`} onClick={() => setTab(t)}>{t.toUpperCase()}</button>
        ))}
        <span className="muted" style={{ marginLeft: 'auto' }}>Container: ZIP + gzip (lossless, copy-only)</span>
      </div>

      {tab === 'monitor' && mon && (
        <>
          <h3>Job Queue</h3>
          <div className="ops-kpi-row">
            <KpiCard label="Queued" value={mon.queue.queued} />
            <KpiCard label="Running" value={mon.queue.running} />
            <KpiCard label="Completed" value={mon.queue.completed} color="var(--status-success)" />
            <KpiCard label="Verified" value={mon.queue.verified} color="var(--status-success)" />
            <KpiCard label="Failed" value={mon.queue.failed} color={mon.queue.failed ? 'var(--status-danger)' : undefined} />
            <KpiCard label="Cancelled" value={mon.queue.cancelled} />
          </div>
          <h3>Storage Savings</h3>
          <div className="ops-kpi-row">
            <KpiCard label="Archive Used" value={fmtBytes(mon.storage.archiveBytesUsed)} />
            <KpiCard label="Original Total" value={fmtBytes(mon.storage.totalOriginalBytes)} />
            <KpiCard label="Compressed Total" value={fmtBytes(mon.storage.totalCompressedBytes)} />
            <KpiCard label="Saved" value={fmtBytes(mon.storage.totalSavingsBytes)} color="var(--status-success)" />
            <KpiCard label="Overall Savings" value={`${mon.storage.overallSavingsPercent}%`} />
          </div>
        </>
      )}

      {tab === 'jobs' && (
        <div className="card ops-table-wrap"><table>
          <thead><tr><th>Status</th><th>Study UID</th><th>Level</th><th>Original</th><th>Compressed</th><th>Savings</th><th>Verified</th><th>Actions</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td><StatusBadge status={j.status} /></td>
                <td title={j.studyInstanceUid}>…{String(j.studyInstanceUid).slice(-12)}</td>
                <td>{j.compressionLevel}</td>
                <td>{fmtBytes(j.originalBytes)}</td>
                <td>{fmtBytes(j.compressedBytes)}</td>
                <td>{j.savingsPercent != null ? `${j.savingsPercent}%` : '—'}</td>
                <td>{j.verified ? '✓' : '—'}</td>
                <td><div className="row-actions">
                  <button className="btn sm" onClick={() => api.get(`/pacs/archive/jobs/${j.id}`).then(setDetail)}>View</button>
                  {can('pacs.archive.manage') && ['QUEUED', 'RUNNING'].includes(j.status) && <button className="btn sm" onClick={() => jobAction(j.id, 'cancel')}>Cancel</button>}
                  {can('pacs.archive.manage') && ['COMPLETED', 'VERIFIED'].includes(j.status) && <button className="btn sm" onClick={() => jobAction(j.id, 'verify')}>Verify</button>}
                </div></td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={8} className="muted">No archive jobs.</td></tr>}
          </tbody>
        </table></div>
      )}

      {tab === 'config' && cfg && (
        <div className="card" style={{ maxWidth: 480 }}>
          <div><label>Source</label><div className="muted">{cfg.source} (studies pulled from Orthanc)</div></div>
          <div><label>Destination archive root</label><div className="muted">{cfg.destinationRoot}</div></div>
          <label>Default compression level (0–9)</label>
          <input type="number" min={0} max={9} value={cfg.defaultCompressionLevel} onChange={(e) => setCfg({ ...cfg, defaultCompressionLevel: e.target.value })} disabled={!can('pacs.archive.manage')} />
          <label>Worker threads</label>
          <input type="number" min={1} max={8} value={cfg.workerThreads} onChange={(e) => setCfg({ ...cfg, workerThreads: e.target.value })} disabled={!can('pacs.archive.manage')} />
          {can('pacs.archive.manage') && <div style={{ marginTop: 14 }}><button className="btn primary" disabled={busy} onClick={saveCfg}>Save</button></div>}
        </div>
      )}

      {showArchive && (
        <Modal title="Archive a Study" onClose={() => setShowArchive(false)}>
          <label>Study Instance UID</label>
          <input value={form.studyInstanceUid ?? ''} onChange={(e) => setForm({ ...form, studyInstanceUid: e.target.value })} placeholder="1.2.826..." />
          <label>Compression level (0–9)</label>
          <input type="number" min={0} max={9} value={form.compressionLevel} onChange={(e) => setForm({ ...form, compressionLevel: e.target.value })} />
          <div className="muted" style={{ fontSize: 12 }}>Copy-only: the study is pulled from Orthanc as a lossless ZIP and gzip-wrapped. Originals are never modified or deleted. A verified archive is never overwritten.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn primary" disabled={busy || !form.studyInstanceUid} onClick={createJob}>Create Archive Job</button>
            <button className="btn" onClick={() => setShowArchive(false)}>Cancel</button>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={`Archive Job — ${detail.status}`} onClose={() => setDetail(null)}>
          <div className="grid2">
            <div><label>Study UID</label><div style={{ wordBreak: 'break-all' }}>{detail.studyInstanceUid}</div></div>
            <div><label>Compression level</label><div>{detail.compressionLevel}</div></div>
            <div><label>Original size</label><div>{fmtBytes(detail.originalBytes)}</div></div>
            <div><label>Compressed size</label><div>{fmtBytes(detail.compressedBytes)}</div></div>
            <div><label>Savings</label><div>{detail.savingsPercent != null ? `${detail.savingsPercent}%` : '—'}</div></div>
            <div><label>Verified</label><div>{detail.verified ? `✓ ${detail.verifyDetail ?? ''}` : '—'}</div></div>
            <div><label>SHA-256</label><div style={{ wordBreak: 'break-all', fontSize: 11 }}>{detail.sha256 ?? '—'}</div></div>
            <div><label>Archive path</label><div style={{ wordBreak: 'break-all', fontSize: 11 }}>{detail.archivePath ?? '—'}</div></div>
          </div>
          {detail.error && <div className="error" style={{ marginTop: 10 }}>{detail.error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {can('pacs.archive.manage') && ['COMPLETED', 'VERIFIED'].includes(detail.status) && <button className="btn" onClick={() => jobAction(detail.id, 'verify')}>Re-verify</button>}
            {can('pacs.archive.manage') && ['COMPLETED', 'VERIFIED'].includes(detail.status) && <button className="btn" onClick={() => jobAction(detail.id, 'restore')}>Restore / Extract</button>}
            <button className="btn" onClick={() => setDetail(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

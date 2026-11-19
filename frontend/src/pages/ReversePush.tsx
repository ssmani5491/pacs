import React, { useEffect, useState, useCallback } from 'react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Modal } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { KpiCard } from '../components/KpiCard';

export function ReversePush() {
  const { can } = useAuth();
  const [mon, setMon] = useState<any>(null);
  const [dests, setDests] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'monitor' | 'destinations' | 'jobs'>('monitor');
  const [showDest, setShowDest] = useState(false);
  const [showPush, setShowPush] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [form, setForm] = useState<any>({ port: 104, callingAet: 'GGHPACS' });
  const [push, setPush] = useState<any>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, d, j] = await Promise.all([
        api.get('/pacs/reverse-push/monitor'),
        api.get('/pacs/destinations?pageSize=100'),
        api.get('/pacs/reverse-push/jobs?pageSize=25'),
      ]);
      setMon(m); setDests(d.data); setJobs(j.data);
    } catch (e: any) { setErr(e.message); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const createDest = async () => {
    setBusy(true); setErr('');
    try { await api.post('/pacs/destinations', { ...form, port: Number(form.port) }); setShowDest(false); setForm({ port: 104, callingAet: 'GGHPACS' }); load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const testDest = async (id: string) => {
    setBusy(true); setErr('');
    try { const r = await api.post(`/pacs/destinations/${id}/test`); window.alert(`C-ECHO: ${r.ok ? 'SUCCESS — ' : 'FAILED — '}${r.detail}`); load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const createPush = async () => {
    setBusy(true); setErr('');
    try { await api.post('/pacs/reverse-push/jobs', push); setShowPush(false); setPush({}); setTab('jobs'); load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const jobAction = async (id: string, action: string) => {
    try { await api.post(`/pacs/reverse-push/jobs/${id}/${action}`); load(); if (detail) setDetail(await api.get(`/pacs/reverse-push/jobs/${id}`)); }
    catch (e: any) { setErr(e.message); }
  };
  const openDetail = async (id: string) => { try { setDetail(await api.get(`/pacs/reverse-push/jobs/${id}`)); } catch (e: any) { setErr(e.message); } };

  return (
    <div>
      <div className="page-head"><h1>DICOM Reverse Push</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {can('pacs.destination.manage') && <button className="btn sm" onClick={() => setShowDest(true)}>+ Destination</button>}
          {can('pacs.reverse-push.manage') && <button className="btn sm primary" onClick={() => setShowPush(true)}>+ Push Study</button>}
          <button className="btn sm" onClick={load}>Refresh</button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="toolbar">
        {(['monitor', 'destinations', 'jobs'] as const).map((t) => (
          <button key={t} className={`btn sm ${tab === t ? 'primary' : ''}`} onClick={() => setTab(t)}>{t.toUpperCase()}</button>
        ))}
        <span className="muted" style={{ marginLeft: 'auto' }}>Engine: {mon?.engine ?? '—'}</span>
      </div>

      {tab === 'monitor' && mon && (
        <>
          <h3>Queue Summary</h3>
          <div className="ops-kpi-row">
            <KpiCard label="Pending" value={mon.queue.pending} />
            <KpiCard label="Queued" value={mon.queue.queued} />
            <KpiCard label="Active" value={mon.queue.active} />
            <KpiCard label="Completed" value={mon.queue.completed} color="var(--status-success)" />
            <KpiCard label="Partial" value={mon.queue.partiallyCompleted} color={mon.queue.partiallyCompleted ? 'var(--status-warning)' : undefined} />
            <KpiCard label="Failed" value={mon.queue.failed} color={mon.queue.failed ? 'var(--status-danger)' : undefined} />
            <KpiCard label="Cancelled" value={mon.queue.cancelled} />
          </div>
          <h3>Transmission Summary</h3>
          <div className="ops-kpi-row">
            <KpiCard label="Total Files" value={mon.transmission.totalFiles} />
            <KpiCard label="Successful" value={mon.transmission.successFiles} color="var(--status-success)" />
            <KpiCard label="Failed" value={mon.transmission.failedFiles} color={mon.transmission.failedFiles ? 'var(--status-danger)' : undefined} />
            <KpiCard label="Success %" value={`${mon.transmission.successPercent}%`} />
          </div>
          <h3>Destinations</h3>
          <div className="card ops-table-wrap"><table>
            <thead><tr><th>Name</th><th>AE Title</th><th>Host:Port</th><th>Active</th><th>Last Test</th></tr></thead>
            <tbody>
              {mon.destinations.map((d: any) => (
                <tr key={d.id}><td>{d.name}</td><td>{d.aeTitle}</td><td>{d.host}:{d.port}</td>
                  <td>{d.active ? '✓' : '—'}</td>
                  <td>{d.lastTestStatus ? <StatusBadge status={d.lastTestStatus} /> : <span className="muted">never</span>}</td>
                </tr>
              ))}
              {mon.destinations.length === 0 && <tr><td colSpan={5} className="muted">No destinations configured.</td></tr>}
            </tbody>
          </table></div>
        </>
      )}

      {tab === 'destinations' && (
        <div className="card ops-table-wrap"><table>
          <thead><tr><th>Name</th><th>AE Title</th><th>Host:Port</th><th>Calling AE</th><th>Active</th><th>Last Test</th><th>Actions</th></tr></thead>
          <tbody>
            {dests.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td><td>{d.aeTitle}</td><td>{d.host}:{d.port}</td><td>{d.callingAet}</td>
                <td>{d.active ? '✓' : '—'}</td>
                <td>{d.lastTestStatus ? <StatusBadge status={d.lastTestStatus} /> : <span className="muted">—</span>}</td>
                <td>{can('pacs.destination.manage') && <button className="btn sm" disabled={busy} onClick={() => testDest(d.id)}>Test C-ECHO</button>}</td>
              </tr>
            ))}
            {dests.length === 0 && <tr><td colSpan={7} className="muted">No destinations.</td></tr>}
          </tbody>
        </table></div>
      )}

      {tab === 'jobs' && (
        <div className="card ops-table-wrap"><table>
          <thead><tr><th>Status</th><th>Destination</th><th>Study UID</th><th>Progress</th><th>Speed</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td><StatusBadge status={j.status} /></td>
                <td>{j.destination?.name ?? '—'}</td>
                <td title={j.studyInstanceUid}>…{String(j.studyInstanceUid).slice(-12)}</td>
                <td>{j.successInstances}/{j.totalInstances}{j.failedInstances > 0 && <span style={{ color: 'var(--status-danger)' }}> ({j.failedInstances} failed)</span>}</td>
                <td>{j.transferSpeedKbps ? `${j.transferSpeedKbps} Kbps` : '—'}</td>
                <td>{new Date(j.createdAt).toLocaleString()}</td>
                <td>
                  <div className="row-actions">
                    <button className="btn sm" onClick={() => openDetail(j.id)}>View</button>
                    {can('pacs.reverse-push.manage') && ['QUEUED', 'RUNNING', 'PENDING'].includes(j.status) && <button className="btn sm" onClick={() => jobAction(j.id, 'cancel')}>Cancel</button>}
                    {can('pacs.reverse-push.manage') && ['FAILED', 'PARTIALLY_COMPLETED'].includes(j.status) && <button className="btn sm" onClick={() => jobAction(j.id, 'retry')}>Retry</button>}
                  </div>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={7} className="muted">No transfer jobs.</td></tr>}
          </tbody>
        </table></div>
      )}

      {/* Create destination */}
      {showDest && (
        <Modal title="Add Destination PACS" onClose={() => setShowDest(false)}>
          {[['name', 'Name'], ['aeTitle', 'AE Title'], ['host', 'Host / IP'], ['port', 'Port'], ['callingAet', 'Calling AE Title'], ['description', 'Description']].map(([k, label]) => (
            <div key={k}><label>{label}</label>
              <input value={form[k] ?? ''} type={k === 'port' ? 'number' : 'text'} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn primary" disabled={busy || !form.name || !form.aeTitle || !form.host} onClick={createDest}>Create</button>
            <button className="btn" onClick={() => setShowDest(false)}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* Create push job */}
      {showPush && (
        <Modal title="Push Study to PACS" onClose={() => setShowPush(false)}>
          <label>Destination</label>
          <select value={push.destinationId ?? ''} onChange={(e) => setPush({ ...push, destinationId: e.target.value })}>
            <option value="">— select —</option>
            {dests.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name} ({d.aeTitle})</option>)}
          </select>
          <label>Study Instance UID</label>
          <input value={push.studyInstanceUid ?? ''} onChange={(e) => setPush({ ...push, studyInstanceUid: e.target.value })} placeholder="1.2.826..." />
          <div className="muted" style={{ fontSize: 12 }}>Tip: copy the Study UID from the worklist. Only studies in your organization with stored images can be pushed.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn primary" disabled={busy || !push.destinationId || !push.studyInstanceUid} onClick={createPush}>Create Transfer Job</button>
            <button className="btn" onClick={() => setShowPush(false)}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* Job detail */}
      {detail && (
        <Modal title={`Transfer Job — ${detail.status}`} onClose={() => setDetail(null)}>
          <div className="grid2">
            <div><label>Destination</label><div>{detail.destination?.name} ({detail.destination?.aeTitle})</div></div>
            <div><label>Study UID</label><div style={{ wordBreak: 'break-all' }}>{detail.studyInstanceUid}</div></div>
            <div><label>Progress</label><div>{detail.successInstances}/{detail.totalInstances} success, {detail.failedInstances} failed</div></div>
            <div><label>Speed</label><div>{detail.transferSpeedKbps ? `${detail.transferSpeedKbps} Kbps` : '—'}</div></div>
            <div><label>Started</label><div>{detail.startedAt ? new Date(detail.startedAt).toLocaleString() : '—'}</div></div>
            <div><label>Completed</label><div>{detail.completedAt ? new Date(detail.completedAt).toLocaleString() : '—'}</div></div>
          </div>
          {detail.lastError && <div className="error" style={{ marginTop: 10 }}>{detail.lastError}</div>}
          <h3 style={{ marginTop: 14 }}>Instances ({detail.instances?.length ?? 0} shown)</h3>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            <table><thead><tr><th>SOP Instance UID</th><th>Status</th></tr></thead>
              <tbody>{(detail.instances ?? []).slice(0, 100).map((i: any) => (
                <tr key={i.id}><td title={i.sopInstanceUid}>…{String(i.sopInstanceUid).slice(-16)}</td>
                  <td><StatusBadge status={i.status} /></td></tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {can('pacs.reverse-push.manage') && ['QUEUED', 'RUNNING', 'PENDING'].includes(detail.status) && <button className="btn" onClick={() => jobAction(detail.id, 'cancel')}>Cancel</button>}
            {can('pacs.reverse-push.manage') && ['FAILED', 'PARTIALLY_COMPLETED'].includes(detail.status) && <button className="btn primary" onClick={() => jobAction(detail.id, 'retry')}>Retry Failed</button>}
            <button className="btn" onClick={() => setDetail(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

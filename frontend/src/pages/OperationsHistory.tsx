import React, { useEffect, useState, useCallback } from 'react';
import { api, qs, getAccess } from '../lib/api';
import { useAuth } from '../lib/auth';
import { StatusBadge, TypeTag } from '../components/StatusBadge';
import { KpiCard } from '../components/KpiCard';

const fmtBytes = (b: any) => {
  if (b == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let n = Number(b), i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const fmtDate = (s: any) => (s ? new Date(s).toLocaleString() : '—');
const fmtDur = (ms: any) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

// Badge/TypeBadge now come from the shared StatusBadge component (Phase 2) —
// same colours, same labels, same conditional behaviour as before.
const Badge = ({ s }: { s: string }) => <StatusBadge status={s} />;
const TypeBadge = ({ t }: { t: string }) => (
  <TypeTag
    value={t}
    labels={{ REVERSE_PUSH: 'PUSH', ARCHIVE: 'ARCHIVE' }}
    variants={{ REVERSE_PUSH: 'indigo', ARCHIVE: 'cyan' }}
  />
);

const RANGES = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['all', 'All'], ['custom', 'Custom']] as const;

export function OperationsHistory() {
  const { can } = useAuth();
  const seePatient = can('patient.view');
  const [tab, setTab] = useState<'dashboard' | 'unified' | 'reverse-push' | 'archive'>('dashboard');
  const [dash, setDash] = useState<any>(null);
  const [list, setList] = useState<any>({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 1 });
  const [detail, setDetail] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // filters
  const [range, setRange] = useState('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [status, setStatus] = useState(''); const [modality, setModality] = useState('');
  const [patientMrn, setPatientMrn] = useState(''); const [studyUid, setStudyUid] = useState('');
  const [createdBy, setCreatedBy] = useState(''); const [verified, setVerified] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('createdAt'); const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filterParams = () => ({ range, from, to, status, modality, patientMrn, studyUid, createdBy,
    ...(tab === 'archive' ? { verified } : {}), page, pageSize: 25, sortBy, sortDir });

  const loadDash = useCallback(async () => {
    try { setDash(await api.get(`/pacs/operations/history/dashboard${qs({ range, from, to })}`)); }
    catch (e: any) { setErr(e.message); }
  }, [range, from, to]);

  const loadList = useCallback(async () => {
    const endpoint = tab === 'unified' ? 'list' : tab;
    try { setList(await api.get(`/pacs/operations/history/${endpoint}${qs(filterParams())}`)); }
    catch (e: any) { setErr(e.message); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, range, from, to, status, modality, patientMrn, studyUid, createdBy, verified, page, sortBy, sortDir]);

  useEffect(() => { setErr(''); if (tab === 'dashboard') loadDash(); else loadList(); }, [tab, loadDash, loadList]);

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir('desc'); }
  };

  const openDetail = async (row: any) => {
    setBusy(true); setErr('');
    try {
      const d = row.type === 'REVERSE_PUSH'
        ? await api.get(`/pacs/operations/history/reverse-push/${row.id}`)
        : await api.get(`/pacs/operations/history/archive/${row.id}`);
      setDetail(d);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const reverify = async (id: string) => {
    setBusy(true); setErr('');
    try { const r = await api.post(`/pacs/operations/history/archive/${id}/verify`); setErr(''); alert(`Integrity re-check: ${r.ok ? 'OK' : 'FAILED'} — ${r.detail}`); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const exportCsv = async () => {
    const kind = tab === 'dashboard' ? 'summary' : tab === 'unified' ? 'unified' : tab;
    try {
      const res = await fetch(`/api/pacs/operations/history/export${qs({ ...filterParams(), kind })}`, { headers: { Authorization: `Bearer ${getAccess()}` } });
      if (!res.ok) { setErr(`Export failed (${res.status})`); return; }
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `ops-history-${kind}-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <div>
      <div className="page-head"><h1>Transfer & Archive History</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sm" onClick={exportCsv}>Export CSV</button>
          <button className="btn sm" onClick={() => (tab === 'dashboard' ? loadDash() : loadList())}>Refresh</button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="toolbar">
        {(['dashboard', 'unified', 'reverse-push', 'archive'] as const).map((t) => (
          <button key={t} className={`btn sm ${tab === t ? 'primary' : ''}`} onClick={() => { setTab(t); setPage(1); setDetail(null); }}>{t.replace('-', ' ').toUpperCase()}</button>
        ))}
        <span className="muted" style={{ marginLeft: 'auto' }}>Real records from reverse-push + archive</span>
      </div>

      {/* Date range (all tabs) */}
      <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap' }}>
        {RANGES.map(([v, l]) => (
          <button key={v} className={`btn sm ${range === v ? 'primary' : ''}`} onClick={() => { setRange(v); setPage(1); }}>{l}</button>
        ))}
        {range === 'custom' && (
          <>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </>
        )}
      </div>

      {tab === 'dashboard' && dash && (
        <>
          {dash.reversePush && (<><h3>Reverse Push</h3>
            <div className="ops-kpi-row">
              <KpiCard label="Total Jobs" value={dash.reversePush.total} />
              <KpiCard label="Successful" value={dash.reversePush.success} color="var(--status-success)" />
              <KpiCard label="Failed" value={dash.reversePush.failed} color="var(--status-danger)" />
              <KpiCard label="Pending" value={dash.reversePush.pending} color="var(--status-info)" />
            </div></>)}
          {dash.archive && (<><h3>Archive</h3>
            <div className="ops-kpi-row">
              <KpiCard label="Total Jobs" value={dash.archive.total} />
              <KpiCard label="Verified" value={dash.archive.verified} color="var(--status-success)" />
              <KpiCard label="Failed" value={dash.archive.failed} color="var(--status-danger)" />
              <KpiCard label="Original Size" value={fmtBytes(dash.archive.originalBytes)} />
              <KpiCard label="Compressed" value={fmtBytes(dash.archive.compressedBytes)} />
              <KpiCard label="Savings" value={`${fmtBytes(dash.archive.savingsBytes)} (${dash.archive.savingsPercent}%)`} color="var(--status-success)" />
            </div></>)}
          <h3>Recent Operations</h3>
          <div className="card ops-table-wrap"><table>
            <thead><tr><th>Type</th><th>Study UID</th>{seePatient && <th>Patient</th>}<th>Modality</th><th>Status</th><th>When</th></tr></thead>
            <tbody>
              {dash.recent.map((r: any) => (
                <tr key={`${r.type}-${r.id}`} style={{ cursor: 'pointer' }} onClick={() => openDetail(r)}>
                  <td><TypeBadge t={r.type} /></td><td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.studyInstanceUid}</td>
                  {seePatient && <td>{r.patientMrn ?? '—'}</td>}<td>{r.modality ?? '—'}</td><td><Badge s={r.status} /></td><td>{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
              {dash.recent.length === 0 && <tr><td colSpan={seePatient ? 6 : 5} className="muted">No operations in range.</td></tr>}
            </tbody>
          </table></div>
        </>
      )}

      {tab !== 'dashboard' && (
        <>
          {/* Filter panel */}
          <div className="card" style={{ padding: 12, marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 8 }}>
            <input placeholder="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
            <input placeholder="Modality" value={modality} onChange={(e) => { setModality(e.target.value); setPage(1); }} />
            {seePatient && <input placeholder="Patient MRN" value={patientMrn} onChange={(e) => { setPatientMrn(e.target.value); setPage(1); }} />}
            <input placeholder="Study UID" value={studyUid} onChange={(e) => { setStudyUid(e.target.value); setPage(1); }} />
            <input placeholder="Created by (userId)" value={createdBy} onChange={(e) => { setCreatedBy(e.target.value); setPage(1); }} />
            {tab === 'archive' && (
              <select value={verified} onChange={(e) => { setVerified(e.target.value); setPage(1); }}>
                <option value="">Any verification</option><option value="true">Verified</option><option value="false">Not verified</option>
              </select>
            )}
          </div>

          <div className="card ops-table-wrap"><table>
            <thead><tr>
              <th>Type</th>
              <th onClick={() => toggleSort('status')} style={{ cursor: 'pointer' }}>Status</th>
              <th>Study UID</th>{seePatient && <th>Patient</th>}<th>Modality</th>
              <th>Summary</th>
              <th onClick={() => toggleSort('createdAt')} style={{ cursor: 'pointer' }}>Created {sortBy === 'createdAt' ? (sortDir === 'desc' ? '▼' : '▲') : ''}</th>
              <th onClick={() => toggleSort('completedAt')} style={{ cursor: 'pointer' }}>Completed</th>
            </tr></thead>
            <tbody>
              {list.data.map((r: any) => (
                <tr key={`${r.type}-${r.id}`} style={{ cursor: 'pointer' }} onClick={() => openDetail(r)}>
                  <td><TypeBadge t={r.type} /></td><td><Badge s={r.status} /></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.studyInstanceUid}</td>
                  {seePatient && <td>{r.patientMrn ?? '—'}</td>}<td>{r.modality ?? '—'}</td>
                  <td style={{ fontSize: 12 }}>
                    {r.type === 'REVERSE_PUSH'
                      ? `${r.summary.successInstances}/${r.summary.totalInstances} ok${r.summary.failedInstances ? `, ${r.summary.failedInstances} failed` : ''}`
                      : `${fmtBytes(r.summary.originalBytes)} → ${fmtBytes(r.summary.compressedBytes)}${r.summary.savingsPercent != null ? ` (${r.summary.savingsPercent}%)` : ''}`}
                  </td>
                  <td>{fmtDate(r.createdAt)}</td><td>{fmtDate(r.completedAt)}</td>
                </tr>
              ))}
              {list.data.length === 0 && <tr><td colSpan={seePatient ? 8 : 7} className="muted">No operations match.</td></tr>}
            </tbody>
          </table></div>

          <div className="toolbar" style={{ marginTop: 8 }}>
            <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
            <span className="muted">Page {list.page} / {list.totalPages} · {list.total} records</span>
            <button className="btn sm" disabled={page >= list.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </>
      )}

      {/* Detail drawer */}
      {detail && (
        <div className="modal-bg" onClick={() => setDetail(null)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div className="page-head"><h2>{detail.type === 'REVERSE_PUSH' ? 'Reverse Push' : 'Archive'} — {detail.id.slice(0, 8)}</h2>
              <button className="btn sm" onClick={() => setDetail(null)}>Close</button></div>
            {detail.type === 'REVERSE_PUSH' ? (
              <>
                <p><strong>Destination:</strong> {detail.destination?.name} ({detail.destination?.aeTitle}@{detail.destination?.host}:{detail.destination?.port})</p>
                <p><strong>Status:</strong> <Badge s={detail.status} /> · {detail.successInstances}/{detail.totalInstances} ok, {detail.failedInstances} failed, {detail.pendingInstances} pending · retries {detail.retryCount}</p>
                {seePatient && <p><strong>Patient:</strong> {detail.patientMrn ?? '—'} · <strong>Modality:</strong> {detail.modality ?? '—'}</p>}
                {detail.lastError && <p className="error">Last error: {detail.lastError}</p>}
                <h3>Instances ({detail.instances.length})</h3>
                <div style={{ maxHeight: 260, overflow: 'auto' }}><table>
                  <thead><tr><th>SOP Instance UID</th><th>Status</th><th>Error</th><th>Sent</th></tr></thead>
                  <tbody>{detail.instances.map((i: any) => (
                    <tr key={i.sopInstanceUid}><td style={{ fontFamily: 'monospace', fontSize: 10 }}>{i.sopInstanceUid}</td><td><Badge s={i.status} /></td><td style={{ fontSize: 11, color: 'var(--status-danger)' }}>{i.error ?? ''}</td><td>{fmtDate(i.sentAt)}</td></tr>
                  ))}</tbody>
                </table></div>
              </>
            ) : (
              <>
                <p><strong>Study:</strong> <span style={{ fontFamily: 'monospace' }}>{detail.studyInstanceUid}</span></p>
                {seePatient && <p><strong>Patient:</strong> {detail.patientMrn ?? '—'} · <strong>Modality:</strong> {detail.modality ?? '—'}</p>}
                <p><strong>Status:</strong> <Badge s={detail.status} /> · verified: {String(detail.verified)}</p>
                <p><strong>Size:</strong> {fmtBytes(detail.originalBytes)} → {fmtBytes(detail.compressedBytes)} {detail.savingsPercent != null && `(${detail.savingsPercent}% saved)`}</p>
                <p><strong>Compression level:</strong> {detail.compressionLevel} · <strong>Workers:</strong> {detail.workerCount} · <strong>Instances:</strong> {detail.instanceCount}</p>
                <p><strong>SHA-256:</strong> <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{detail.sha256 ?? '—'}</span></p>
                {detail.archivePath !== undefined && <p><strong>Archive path:</strong> <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{detail.archivePath}</span></p>}
                {detail.verifyDetail && <p className="muted">Verify detail: {detail.verifyDetail}</p>}
                <p className="muted">Durations — created {fmtDate(detail.createdAt)}, completed {fmtDate(detail.completedAt)}</p>
                <button className="btn sm" disabled={busy} onClick={() => reverify(detail.id)}>Re-verify integrity (read-only)</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

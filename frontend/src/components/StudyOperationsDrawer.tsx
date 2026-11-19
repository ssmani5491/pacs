import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const fmtBytes = (b: any) => {
  if (b == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let n = Number(b), i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const fmtDate = (s: any) => (s ? new Date(s).toLocaleString() : '—');

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: '#16a34a', VERIFIED: '#16a34a', FAILED: '#ef4444', CANCELLED: '#6b7280',
  PARTIALLY_COMPLETED: '#f59e0b', RUNNING: '#3b82f6', QUEUED: '#3b82f6', PENDING: '#6b7280',
};
function Badge({ s }: { s: string }) {
  const c = STATUS_COLOR[s] ?? '#6b7280';
  return <span style={{ background: c + '22', color: c, border: `1px solid ${c}55`, borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{s}</span>;
}

/**
 * Study Operations drawer — study-level operational visibility (Module 5).
 * Reads GET /pacs/operations/history/study/:uid (org-isolated, patient-gated,
 * source-RBAC enforced server-side). Where the user has reverse-push.manage, it
 * can launch the EXISTING reverse-push create-job workflow (POST
 * /pacs/reverse-push/jobs) for this study — reusing the API, not duplicating it.
 */
export function StudyOperationsDrawer({ uid, onClose }: { uid: string; onClose: () => void }) {
  const { can } = useAuth();
  const seePatient = can('patient.view');
  const canPush = can('pacs.reverse-push.manage');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // push launcher (reuses existing destinations + create-job API)
  const [showPush, setShowPush] = useState(false);
  const [dests, setDests] = useState<any[]>([]);
  const [destId, setDestId] = useState('');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNote, setPushNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setData(await api.get(`/pacs/operations/history/study/${uid}`)); }
    catch (e: any) { setErr(e.message); setData(null); }
    finally { setLoading(false); }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const openPush = async () => {
    setShowPush(true); setPushNote('');
    try { const r = await api.get('/pacs/destinations?pageSize=100'); setDests(r.data ?? []); }
    catch (e: any) { setErr(e.message); }
  };
  const launchPush = async () => {
    if (!destId) return;
    setPushBusy(true); setPushNote('');
    try {
      // EXISTING reverse-push create-job API — not duplicated here.
      await api.post('/pacs/reverse-push/jobs', { destinationId: destId, studyInstanceUid: uid });
      setPushNote('Reverse-push job created. Track it in the Reverse Push Monitor.');
      setShowPush(false);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setPushBusy(false); }
  };

  const s = data?.study;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 820, width: '92%' }} onClick={(e) => e.stopPropagation()}>
        <div className="page-head" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Study Operations</h2>
          <button className="btn sm" onClick={onClose}>Close</button>
        </div>

        {err && <div className="error">{err}</div>}
        {pushNote && <div className="card" style={{ padding: 10, borderLeft: '3px solid #16a34a', marginBottom: 10 }}>{pushNote}</div>}
        {loading && <div className="muted">Loading study operations…</div>}

        {data && s && (
          <>
            {/* identity */}
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 8, fontSize: 13 }}>
                <div><div className="muted" style={{ fontSize: 11 }}>Study UID</div><div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{s.studyInstanceUid}</div></div>
                {seePatient && <div><div className="muted" style={{ fontSize: 11 }}>Patient</div><div>{s.patientMrn ?? '—'}</div></div>}
                <div><div className="muted" style={{ fontSize: 11 }}>Modality</div><div>{s.modality ?? '—'}</div></div>
                <div><div className="muted" style={{ fontSize: 11 }}>Instances</div><div>{s.instanceCount ?? '—'}</div></div>
                <div><div className="muted" style={{ fontSize: 11 }}>Accession</div><div>{s.accessionNumber ?? '—'}</div></div>
                <div><div className="muted" style={{ fontSize: 11 }}>Study Storage</div><div>{data.storage ? fmtBytes(data.storage.studyBytes) : '—'}</div></div>
              </div>
            </div>

            {/* summary counts */}
            {data.summary && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 8, marginBottom: 12 }}>
                <div className="card" style={{ padding: 10 }}><div className="muted" style={{ fontSize: 11 }}>Transfers</div><div style={{ fontSize: 18, fontWeight: 700 }}>{data.summary.transferCount}</div></div>
                <div className="card" style={{ padding: 10 }}><div className="muted" style={{ fontSize: 11 }}>Archives</div><div style={{ fontSize: 18, fontWeight: 700 }}>{data.summary.archiveCount}</div></div>
                <div className="card" style={{ padding: 10 }}><div className="muted" style={{ fontSize: 11 }}>Verified</div><div style={{ fontSize: 18, fontWeight: 700, color: '#16a34a' }}>{data.summary.archiveVerified}</div></div>
                <div className="card" style={{ padding: 10 }}><div className="muted" style={{ fontSize: 11 }}>Failures</div><div style={{ fontSize: 18, fontWeight: 700, color: (data.summary.transferFailed + data.summary.archiveFailed) ? '#ef4444' : undefined }}>{data.summary.transferFailed + data.summary.archiveFailed}</div></div>
              </div>
            )}

            {/* push launcher (manage only) */}
            {canPush && (
              <div style={{ marginBottom: 12 }}>
                {!showPush
                  ? <button className="btn sm primary" onClick={openPush}>Push study to destination…</button>
                  : (
                    <div className="card" style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <select value={destId} onChange={(e) => setDestId(e.target.value)} style={{ width: 'auto' }}>
                        <option value="">Select destination…</option>
                        {dests.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.aeTitle})</option>)}
                      </select>
                      <button className="btn sm primary" disabled={pushBusy || !destId} onClick={launchPush}>{pushBusy ? 'Creating…' : 'Create transfer job'}</button>
                      <button className="btn sm" onClick={() => setShowPush(false)}>Cancel</button>
                      <span className="muted" style={{ fontSize: 11 }}>Uses the existing reverse-push workflow</span>
                    </div>
                  )}
              </div>
            )}

            {/* transfers */}
            <h3 style={{ marginBottom: 6 }}>Reverse Push History</h3>
            <div className="card" style={{ overflowX: 'auto', marginBottom: 12 }}>
              <table>
                <thead><tr><th>Status</th><th>Destination</th><th>Instances</th><th>Created</th><th>Completed</th></tr></thead>
                <tbody>
                  {data.transfers.map((t: any) => (
                    <tr key={t.id}>
                      <td><Badge s={t.status} /></td>
                      <td>{t.summary?.destination?.name ?? '—'}</td>
                      <td style={{ fontSize: 12 }}>{t.summary?.successInstances ?? 0}/{t.summary?.totalInstances ?? 0}{t.summary?.failedInstances ? ` (${t.summary.failedInstances} failed)` : ''}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(t.createdAt)}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(t.completedAt)}</td>
                    </tr>
                  ))}
                  {data.transfers.length === 0 && <tr><td colSpan={5} className="muted">No reverse-push history{can('pacs.reverse-push.view') ? '' : ' (no permission)'}.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* archives + integrity */}
            <h3 style={{ marginBottom: 6 }}>Archive History &amp; Integrity</h3>
            <div className="card" style={{ overflowX: 'auto', marginBottom: 8 }}>
              <table>
                <thead><tr><th>Status</th><th>Original → Compressed</th><th>Verified</th><th>Created</th><th>Completed</th></tr></thead>
                <tbody>
                  {data.archives.map((a: any) => (
                    <tr key={a.id}>
                      <td><Badge s={a.status} /></td>
                      <td style={{ fontSize: 12 }}>{fmtBytes(a.summary?.originalBytes)} → {fmtBytes(a.summary?.compressedBytes)}{a.summary?.savingsPercent != null ? ` (${a.summary.savingsPercent}%)` : ''}</td>
                      <td>{a.summary?.verified ? <span style={{ color: '#16a34a' }}>✓</span> : <span className="muted">—</span>}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(a.createdAt)}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(a.completedAt)}</td>
                    </tr>
                  ))}
                  {data.archives.length === 0 && <tr><td colSpan={5} className="muted">No archive history{can('pacs.archive.view') ? '' : ' (no permission)'}.</td></tr>}
                </tbody>
              </table>
            </div>
            {data.latestIntegrity && (
              <div className="muted" style={{ fontSize: 12 }}>
                Latest integrity: {data.latestIntegrity.verified ? 'VERIFIED' : 'NOT VERIFIED'} · {data.latestIntegrity.detail ?? '—'} · {fmtDate(data.latestIntegrity.verifiedAt)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

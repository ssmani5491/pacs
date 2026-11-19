import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { StatusBadge, StatusDot, TypeTag } from '../components/StatusBadge';
import { KpiCard } from '../components/KpiCard';

const fmtBytes = (b: any) => {
  if (b == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let n = Number(b), i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const fmtDate = (s: any) => (s ? new Date(s).toLocaleString() : '—');

// Badge/HealthDot/TypeBadge now come from the shared StatusBadge component
// (Phase 2) — same colours, same labels, same conditional behaviour.
const Badge = ({ s }: { s: string }) => <StatusBadge status={s} />;
const HealthDot = ({ status }: { status: string }) => <StatusDot status={status} label={null} />;
const TypeBadge = ({ t }: { t: string }) => (
  <TypeTag
    value={t}
    labels={{ REVERSE_PUSH: 'PUSH', ARCHIVE: 'ARCHIVE' }}
    variants={{ REVERSE_PUSH: 'indigo', ARCHIVE: 'cyan' }}
  />
);

// Tile now comes from the shared KpiCard component (Phase 3) — size="compact"
// reproduces this page's original literal 22px/14px sizing exactly, so reuse
// does not resize this page's grid.
const Tile = (props: any) => <KpiCard {...props} size="compact" />;

export function OperationalCommandCentre() {
  const nav = useNavigate();
  const { can } = useAuth();
  const seePatient = can('patient.view');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setData(await api.get('/pacs/operations/overview')); }
    catch (e: any) { setErr(e.message); setData(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Refresh periodically (reuses the app's polling convention).
  useEffect(() => {
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const t = data?.transfer, a = data?.archive, s = data?.storage, h = data?.health, al = data?.alerts;

  return (
    <div>
      <div className="page-head"><h1>Operations Command Centre</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {data?.generatedAt && <span className="muted" style={{ fontSize: 12 }}>as of {fmtDate(data.generatedAt)}</span>}
          <button className="btn sm" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      {err && <div className="error">Could not load operations overview: {err}</div>}
      {loading && !data && <div className="card muted" style={{ padding: 20 }}>Loading operational overview…</div>}
      {!loading && !err && !data && <div className="card" style={{ padding: 20 }}>No operational data available.</div>}

      {data && (
        <>
          {/* Reverse Push summary */}
          {t && (<>
            <h3>Reverse Push</h3>
            <div className="ops-kpi-row">
              <Tile label="Total Jobs" value={t.total} />
              <Tile label="Completed" value={t.completed} color="#16a34a" />
              <Tile label="Failed" value={t.failed} color={t.failed ? '#ef4444' : undefined} />
              <Tile label="Partial" value={t.partial} color={t.partial ? '#f59e0b' : undefined} />
              <Tile label="Running" value={t.running} color={t.running ? '#3b82f6' : undefined} />
              <Tile label="Queued" value={t.queued} color={t.queued ? '#3b82f6' : undefined} />
            </div>
          </>)}

          {/* Archive summary */}
          {a && (<>
            <h3>Archive</h3>
            <div className="ops-kpi-row">
              <Tile label="Total Jobs" value={a.total} />
              <Tile label="Verified" value={a.verified} color="#16a34a" />
              <Tile label="Failed" value={a.failed} color={a.failed ? '#ef4444' : undefined} />
              <Tile label="Running" value={a.running} color={a.running ? '#3b82f6' : undefined} />
              <Tile label="Queued" value={a.queued} color={a.queued ? '#3b82f6' : undefined} />
            </div>
          </>)}

          {/* Storage utilization + capacity */}
          {s && (<>
            <h3>Storage</h3>
            <div className="ops-kpi-row" style={{ marginBottom: 8 }}>
              <Tile label="Disk Used" value={`${s.disk.usedPercent}%`}
                color={s.disk.usedPercent >= (s.thresholds?.critical ?? 95) ? 'var(--status-danger)' : s.disk.usedPercent >= (s.thresholds?.high ?? 90) ? 'var(--status-warning)' : 'var(--status-success)'}
                sub={`${fmtBytes(s.disk.usedBytes)} / ${fmtBytes(s.disk.totalBytes)}`} />
              <Tile label="Available" value={fmtBytes(s.disk.availableBytes)} />
              <Tile label="Orthanc" value={fmtBytes(s.orthanc?.bytes)} sub={`${s.orthanc?.instances ?? '—'} instances`} />
              <Tile label="Archive" value={fmtBytes(s.archiveBytes)} />
              <Tile label="Alert Level" value={s.alertLevel ?? 'OK'} color={s.alertLevel ? 'var(--status-warning)' : 'var(--status-success)'} />
            </div>
          </>)}

          {/* Service health + alerts side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12, marginTop: 8 }}>
            {h && (
              <div className="card" style={{ padding: 14 }}>
                <h3 style={{ marginTop: 0 }}>Service Health</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {h.map((svc: any) => (
                    <div key={svc.service} style={{ fontSize: 13, display: 'flex', alignItems: 'center' }}>
                      <HealthDot status={svc.status} />{svc.service}
                      <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{svc.responseMs != null ? `${svc.responseMs}ms` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {al && (
              <div className="card" style={{ padding: 14 }}>
                <h3 style={{ marginTop: 0 }}>Active Alerts</h3>
                <div style={{ display: 'flex', gap: 24, alignItems: 'baseline' }}>
                  <div><div className="muted" style={{ fontSize: 12 }}>Open</div><div style={{ fontSize: 26, fontWeight: 700, color: al.open ? 'var(--status-warning)' : 'var(--status-success)' }}>{al.open}</div></div>
                  <div><div className="muted" style={{ fontSize: 12 }}>Critical</div><div style={{ fontSize: 26, fontWeight: 700, color: al.critical ? 'var(--status-danger)' : 'var(--status-success)' }}>{al.critical}</div></div>
                  <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => nav('/pacs/operations/exceptions')}>View exceptions →</button>
                </div>
              </div>
            )}
          </div>

          {/* Recent operational activity */}
          <h3>Recent Operational Activity</h3>
          <div className="card ops-table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Study UID</th>{seePatient && <th>Patient</th>}<th>Modality</th><th>Status</th><th>When</th></tr></thead>
              <tbody>
                {(data.recent ?? []).map((r: any) => (
                  <tr key={`${r.type}-${r.id}`}>
                    <td><TypeBadge t={r.type} /></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 11 }} title={r.studyInstanceUid}>…{String(r.studyInstanceUid).slice(-16)}</td>
                    {seePatient && <td>{r.patientMrn ?? '—'}</td>}
                    <td>{r.modality ?? '—'}</td>
                    <td><Badge s={r.status} /></td>
                    <td>{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
                {(data.recent ?? []).length === 0 && <tr><td colSpan={seePatient ? 6 : 5} className="muted">No recent operations.</td></tr>}
              </tbody>
            </table>
          </div>

          {!t && !a && !s && !h && !al && (
            <div className="card" style={{ padding: 20 }}>You do not have permission to view any operational section.</div>
          )}
        </>
      )}
    </div>
  );
}

import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { StatusBadge } from '../components/StatusBadge';
import { KpiCard } from '../components/KpiCard';

const fmtDate = (s: any) => (s ? new Date(s).toLocaleString() : '—');

// ClassBadge now comes from the shared StatusBadge component (Phase 2) — same
// colours (CONFIRMED=danger/red, HEURISTIC=heuristic/amber,
// INFRASTRUCTURE=indigo), same labels, same conditional behaviour.
const ClassBadge = ({ c }: { c: string }) => <StatusBadge status={c} />;
const KIND_LABEL: Record<string, string> = {
  TRANSFER_FAILED: 'Transfer failed', TRANSFER_PARTIAL: 'Transfer partial',
  TRANSFER_INTERRUPTED_HEURISTIC: 'Transfer interrupted (inferred)',
  ARCHIVE_FAILED: 'Archive failed', STORAGE_ALERT: 'Storage alert',
  SYSTEM_ALERT: 'System alert', SERVICE_UNHEALTHY: 'Service unhealthy',
};

const FILTERS = [
  ['ALL', 'All'], ['CONFIRMED', 'Confirmed'], ['HEURISTIC', 'Heuristic'], ['INFRASTRUCTURE', 'Infrastructure'],
] as const;

export function OperationsExceptions() {
  const { can } = useAuth();
  const seePatient = can('patient.view');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState<string>('ALL');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setData(await api.get('/pacs/operations/exceptions')); }
    catch (e: any) { setErr(e.message); setData(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Recovery reuses EXISTING backend endpoints only — the row tells us which one.
  const recover = async (row: any) => {
    if (!row.recovery) return;
    setBusy(row.id); setNote('');
    try {
      await api.post(row.recovery.endpoint.replace(/^\/api/, ''));
      setNote(`${row.recovery.action} requested for ${KIND_LABEL[row.kind] ?? row.kind}.`);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(''); }
  };

  const rows = (data?.data ?? []).filter((r: any) => filter === 'ALL' || r.classification === filter);
  const c = data?.counts;

  return (
    <div>
      <div className="page-head"><h1>Operations Exceptions</h1>
        <button className="btn sm" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {err && <div className="error">{err}</div>}
      {note && <div className="card" style={{ padding: 10, borderLeft: '3px solid var(--status-success)', marginBottom: 10 }}>{note}</div>}

      {c && (
        <div className="ops-kpi-row" style={{ marginBottom: 12 }}>
          <KpiCard label="Total" value={c.total} />
          <KpiCard label="Confirmed" value={c.confirmed} color={c.confirmed ? 'var(--status-danger)' : undefined} />
          <KpiCard label="Heuristic" value={c.heuristic} color={c.heuristic ? 'var(--status-heuristic)' : undefined} />
          <KpiCard label="Infrastructure" value={c.infrastructure} color={c.infrastructure ? 'var(--status-indigo)' : undefined} />
        </div>
      )}

      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        {FILTERS.map(([v, l]) => (
          <button key={v} className={`btn sm ${filter === v ? 'primary' : ''}`} onClick={() => setFilter(v)}>{l}</button>
        ))}
        <span className="muted" style={{ marginLeft: 'auto' }}>Read-only; recovery uses existing module actions</span>
      </div>

      <div className="card ops-table-wrap">
        <table>
          <thead><tr>
            <th>Class</th><th>Exception</th><th>Study / Target</th>{seePatient && <th>Patient</th>}
            <th>Detail</th><th>When</th><th>Recovery</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={seePatient ? 7 : 6} className="muted">Loading exceptions…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={seePatient ? 7 : 6} className="muted">No operational exceptions{filter !== 'ALL' ? ` in ${filter.toLowerCase()}` : ''}. All clear.</td></tr>}
            {!loading && rows.map((r: any) => (
              <tr key={r.id} style={r.classification === 'HEURISTIC' ? { background: 'color-mix(in srgb, var(--status-warning) 6%, transparent)' } : undefined}>
                <td><ClassBadge c={r.classification} /></td>
                <td>{KIND_LABEL[r.kind] ?? r.kind}{r.status && <span className="muted" style={{ fontSize: 11 }}> · {r.status}</span>}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }} title={r.studyInstanceUid ?? r.service ?? r.id}>
                  {r.studyInstanceUid ? `…${String(r.studyInstanceUid).slice(-14)}` : (r.service ?? r.errorDetail ?? '—')}
                </td>
                {seePatient && <td>{r.patientMrn ?? '—'}</td>}
                <td style={{ fontSize: 12, maxWidth: 320, whiteSpace: 'normal' }}>{r.errorDetail}</td>
                <td style={{ fontSize: 12 }}>{fmtDate(r.timestamp)}</td>
                <td>
                  {r.recovery && r.canRecover ? (
                    <button className="btn sm primary" disabled={busy === r.id} onClick={() => recover(r)}
                      title={`Calls existing ${r.recovery.endpoint} (requires ${r.recovery.requiredPermission})`}>
                      {busy === r.id ? '…' : r.recovery.action}
                    </button>
                  ) : r.recovery && !r.canRecover ? (
                    <span className="muted" style={{ fontSize: 11 }} title={`Requires ${r.recovery.requiredPermission}`}>{r.recovery.action} (no permission)</span>
                  ) : (
                    <span className="muted" style={{ fontSize: 11 }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

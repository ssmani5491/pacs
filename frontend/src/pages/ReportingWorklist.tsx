import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { KpiCard } from '../components/KpiCard';
import { openStudyInViewer } from '../lib/viewer';

const BUCKETS = ['ALL', 'UNREPORTED', 'DRAFT', 'PRELIMINARY', 'FINAL', 'ADDENDUM'];
const BUCKET_LABEL: Record<string, string> = {
  ALL: 'All', UNREPORTED: 'Unreported', DRAFT: 'Draft', PRELIMINARY: 'Preliminary',
  FINAL: 'Final', ADDENDUM: 'Addendum',
};
const MODALITIES = ['CT', 'MR', 'CR', 'DX', 'US', 'MG', 'NM', 'PT'];

/** Reporting worklist / dashboard (Phase 7, Module 4; redesigned Phase 6C). */
export function ReportingWorklist() {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [bucket, setBucket] = useState('ALL');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [viewerErr, setViewerErr] = useState('');
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [accession, setAccession] = useState('');
  const [modality, setModality] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [myAssignment, setMyAssignment] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const params = useCallback(() => ({
    bucket, page, pageSize: 20,
    patientId: patientId || undefined, patientName: patientName || undefined,
    accession: accession || undefined,
    modality: modality.length ? modality.join(',') : undefined,
    dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    myAssignment: myAssignment ? 'true' : undefined,
  }), [bucket, page, patientId, patientName, accession, modality, dateFrom, dateTo, myAssignment]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const res = await api.get('/reporting-worklist' + qs(params()));
      setRows(res.data); setMeta({ total: res.total, page: res.page, totalPages: res.totalPages });
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [params]);

  const loadCounts = useCallback(async () => {
    try { setCounts(await api.get('/reporting-worklist/counts' + qs({ ...params(), bucket: undefined, page: undefined }))); } catch { /* ignore */ }
  }, [params]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCounts(); }, [bucket]); // eslint-disable-line

  const toggleMod = (m: string) => setModality((c) => c.includes(m) ? c.filter((x) => x !== m) : [...c, m]);
  const search = () => { setPage(1); load(); loadCounts(); };
  const clear = () => { setPatientId(''); setPatientName(''); setAccession(''); setModality([]); setDateFrom(''); setDateTo(''); setMyAssignment(false); setPage(1); };
  const refresh = () => { load(); loadCounts(); };
  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString() : '—';
  const openStudy = (r: any) => openStudyInViewer(r.studyInstanceUid).catch((e) => setViewerErr(e.message));

  return (
    <div>
      <div className="page-head">
        <div className="rw-head-row" style={{ width: '100%' }}>
          <div>
            <h1>Reporting Worklist</h1>
            <p>Track and action radiology reports across the organisation.</p>
          </div>
          <div className="rw-head-meta">
            {!loading && <span>{meta.total} studies</span>}
            {loading && <span>Loading…</span>}
            <button className="btn sm" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
            <label style={{ margin: 0 }}>
              <input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={myAssignment}
                onChange={(e) => { setMyAssignment(e.target.checked); setPage(1); }} /> My Assignment
            </label>
          </div>
        </div>
      </div>

      {err && <div className="error">{err}</div>}
      {viewerErr && <div className="error">{viewerErr}</div>}

      {/* Bucket KPI tabs */}
      <div className="rw-kpi-row">
        {BUCKETS.map((b) => (
          <KpiCard key={b} size="compact" label={BUCKET_LABEL[b]} value={counts[b] ?? '—'}
            onClick={() => { setBucket(b); setPage(1); }}
            color={bucket === b ? 'var(--primary)' : undefined} />
        ))}
      </div>

      {/* Search + filters panel */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="grid2 rw-filter-grid">
          <div><label>Patient ID</label><input value={patientId} onChange={(e) => setPatientId(e.target.value)} /></div>
          <div><label>Patient Name</label><input value={patientName} onChange={(e) => setPatientName(e.target.value)} /></div>
          <div><label>Accession No</label><input value={accession} onChange={(e) => setAccession(e.target.value)} /></div>
          <div><label>From / To</label>
            <div className="rw-date-range" style={{ display: 'flex', gap: 6 }}>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        </div>

        <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setFiltersOpen((v) => !v)}>
          {filtersOpen ? 'Hide modality filter' : 'Filter by modality'}
        </button>

        {filtersOpen && (
          <div style={{ marginTop: 10 }}>
            <label>Modality</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {MODALITIES.map((m) => (
                <label key={m} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={modality.includes(m)} onChange={() => toggleMod(m)} /> {m}
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn primary" onClick={search}>Apply Filters</button>
          <button className="btn" onClick={clear}>Clear</button>
        </div>
      </div>

      {/* Desktop/tablet table */}
      <div className="card rw-table-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table className="rw-table">
            <thead><tr>
              <th>Patient</th><th>Accession</th><th>Modality / Description</th><th>Study Date</th>
              <th>Assigned</th><th>Status</th><th>Images</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="muted">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={8} className="muted">No studies found.</td></tr>}
              {!loading && rows.map((r) => (
                <tr key={r.studyId}>
                  <td>
                    <div className="rw-patient-name">{r.patientName}</div>
                    <div className="rw-patient-id">{r.patientId}</div>
                  </td>
                  <td>{r.accessionNumber}</td>
                  <td>
                    <div><span className="badge status-neutral">{r.modality}</span></div>
                    <div className="rw-study-desc" title={r.description}>{r.description}</div>
                  </td>
                  <td>{fmtDate(r.studyDate)}</td>
                  <td>{r.assignedRadiologist ?? <span className="muted">—</span>}</td>
                  <td>
                    <StatusBadge status={r.reportStatus} />
                    {r.reportLocked && ' 🔒'}
                    {r.addendumCount > 0 && <span className="muted"> +{r.addendumCount} addendum</span>}
                  </td>
                  <td>{r.imageCount}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn sm primary" onClick={() => nav(`/reports/study/${r.studyId}`)}>
                        {r.reportStatus === 'UNREPORTED' ? 'Report' : 'Open Report'}
                      </button>
                      <button className="btn sm"
                        title={r.hasImages ? 'Open study in the DICOM viewer' : 'No images stored for this study yet'}
                        disabled={!r.hasImages || !r.studyInstanceUid} onClick={() => openStudy(r)}>Open Study</button>
                      <button className="btn sm" title="View full study details"
                        onClick={() => nav(`/studies/${r.studyId}`)}>Details</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span className="muted">{meta.total} total · page {meta.page}/{meta.totalPages}</span>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <button className="btn sm" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>

      {/* Mobile card list */}
      <div className="rw-cards">
        {loading && <div className="card muted" style={{ padding: 16 }}>Loading…</div>}
        {!loading && rows.length === 0 && <div className="card muted" style={{ padding: 16 }}>No studies found.</div>}
        {!loading && rows.map((r) => (
          <div className="rw-card" key={r.studyId}>
            <div className="rw-card-top">
              <div>
                <div className="rw-patient-name">{r.patientName}</div>
                <div className="rw-patient-id">{r.patientId} · {r.accessionNumber}</div>
              </div>
              <StatusBadge status={r.reportStatus} />
            </div>
            <div className="rw-card-row"><span>Modality</span><span className="badge status-neutral">{r.modality}</span></div>
            <div className="rw-card-row"><span>Description</span><span>{r.description}</span></div>
            <div className="rw-card-row"><span>Study Date</span><span>{fmtDate(r.studyDate)}</span></div>
            <div className="rw-card-row"><span>Assigned</span><span>{r.assignedRadiologist ?? '—'}</span></div>
            <div className="rw-card-row"><span>Images</span><span>{r.imageCount}</span></div>
            {r.addendumCount > 0 && <div className="rw-card-row"><span>Addenda</span><span>{r.addendumCount}</span></div>}
            <div className="rw-card-actions">
              <button className="btn sm primary" onClick={() => nav(`/reports/study/${r.studyId}`)}>
                {r.reportStatus === 'UNREPORTED' ? 'Report' : 'Open Report'}
              </button>
              <button className="btn sm" disabled={!r.hasImages || !r.studyInstanceUid} onClick={() => openStudy(r)}>Open Study</button>
              <button className="btn sm" onClick={() => nav(`/studies/${r.studyId}`)}>Details</button>
            </div>
          </div>
        ))}
        <div className="pager">
          <span className="muted">{meta.total} total · page {meta.page}/{meta.totalPages}</span>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <button className="btn sm" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}

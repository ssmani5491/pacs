import React, { useEffect, useState, useCallback } from 'react';
import { api, qs } from '../lib/api';
import { openStudyInViewer } from '../lib/viewer';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { StudyOperationsDrawer } from '../components/StudyOperationsDrawer';
import { StatusBadge } from '../components/StatusBadge';

const STATUS_TABS = ['ALL', 'READY', 'DRAFT', 'PRELIMINARY', 'FINAL', 'CANCELLED', 'PENDING'];
const MODALITIES = ['CT', 'MR', 'CR', 'DX', 'US', 'MG', 'NM', 'PT', 'XA'];
const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'studyDate', label: 'Study Date' },
  { value: 'accessionNumber', label: 'Accession' },
  { value: 'modality', label: 'Modality' },
  { value: 'reportStatus', label: 'Status' },
  { value: 'createdAt', label: 'Date Added' },
];

export function Worklist() {
  const nav = useNavigate();
  const { can } = useAuth();
  // Show the operations affordance only when the user can see some operational source.
  const canOps = can('pacs.reverse-push.view') || can('pacs.archive.view');
  const [opsUid, setOpsUid] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  // filters
  const [search, setSearch] = useState('');
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [accession, setAccession] = useState('');
  const [modality, setModality] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [myAssignment, setMyAssignment] = useState(false);
  const [sortBy, setSortBy] = useState('studyDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const params = useCallback(() => ({
    status, page, pageSize, sortBy, sortDir,
    search: search || undefined,
    patientId: patientId || undefined, patientName: patientName || undefined,
    accession: accession || undefined,
    modality: modality.length ? modality.join(',') : undefined,
    dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    myAssignment: myAssignment ? 'true' : undefined,
  }), [status, page, pageSize, sortBy, sortDir, search, patientId, patientName, accession, modality, dateFrom, dateTo, myAssignment]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const res = await api.get('/worklist' + qs(params()));
      setRows(res.data);
      setMeta({ total: res.total, page: res.page, totalPages: res.totalPages });
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [params]);

  const loadCounts = useCallback(async () => {
    try {
      const c = await api.get('/worklist/counts' + qs({ ...params(), status: undefined, page: undefined }));
      setCounts(c);
    } catch { /* ignore */ }
  }, [params]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCounts(); }, [status]); // refresh counts on tab change

  const toggleMod = (m: string) =>
    setModality((cur) => cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]);

  const search_ = () => { setPage(1); load(); loadCounts(); };
  const clear = () => {
    setSearch(''); setPatientId(''); setPatientName(''); setAccession(''); setModality([]);
    setDateFrom(''); setDateTo(''); setMyAssignment(false); setPage(1);
  };
  const refresh = () => { load(); loadCounts(); };

  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString() : '—';
  const fmtTime = (d?: string) => d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

  const openStudy = (r: any) => openStudyInViewer(r.studyInstanceUid).catch((e) => setErr(e.message));
  const openStudy3D = (r: any) => openStudyInViewer(r.studyInstanceUid, 'mpr').catch((e) => setErr(e.message));

  return (
    <div>
      <div className="page-head">
        <div className="wl-head-row" style={{ width: '100%' }}>
          <div>
            <h1>RIS Worklist</h1>
            <p>Search, filter and action radiology studies across the organisation.</p>
          </div>
          <div className="wl-head-meta">
            {!loading && <span>{meta.total} studies</span>}
            {loading && <span>Loading…</span>}
            <button className="btn sm" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
            <label style={{ margin: 0 }}>
              <input type="checkbox" style={{ width: 'auto', marginRight: 6 }}
                checked={myAssignment} onChange={(e) => { setMyAssignment(e.target.checked); setPage(1); }} />
              My Assignment
            </label>
          </div>
        </div>
      </div>

      {err && <div className="error">{err}</div>}

      {/* Search + filters panel */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="toolbar">
          <input placeholder="Search patient, accession or description…" style={{ maxWidth: 320 }}
            value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') search_(); }} />
          <button className="btn sm primary" onClick={search_}>Search</button>
          <span style={{ marginLeft: 'auto' }} className="muted">Sort:</span>
          <select style={{ width: 'auto' }} value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(1); }}>
            {SORT_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button className="btn sm" title="Toggle sort direction"
            onClick={() => setSortDir((d) => d === 'asc' ? 'desc' : 'asc')}>
            {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
          </button>
        </div>

        <div className="grid2" style={{ marginTop: 14 }}>
          <div><label>Patient ID</label><input value={patientId} onChange={(e) => setPatientId(e.target.value)} /></div>
          <div><label>Patient Name</label><input value={patientName} onChange={(e) => setPatientName(e.target.value)} /></div>
          <div><label>Accession No</label><input value={accession} onChange={(e) => setAccession(e.target.value)} /></div>
          <div><label>From / To</label>
            <div style={{ display: 'flex', gap: 6 }}>
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
          <button className="btn primary" onClick={search_}>Apply Filters</button>
          <button className="btn" onClick={clear}>Clear</button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        {STATUS_TABS.map((t) => (
          <button key={t} className={`btn sm ${status === t ? 'primary' : ''}`}
            onClick={() => { setStatus(t); setPage(1); }}>
            {t}{counts[t] !== undefined ? ` (${counts[t]})` : ''}
          </button>
        ))}
        <span style={{ marginLeft: 'auto' }} className="muted">Rows:</span>
        <select style={{ width: 'auto' }} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
          {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {/* Desktop/tablet table */}
      <div className="card wl-table-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table className="wl-table">
            <colgroup>
              <col className="wl-col-expand" />
              <col /><col /><col /><col /><col /><col /><col />
              <col className="wl-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th></th>
                <th>Patient</th><th>Accession</th><th>Study Date</th><th>Modality / Description</th>
                <th>Assigned</th><th>Status</th><th>Images</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="muted">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={9} className="muted">No studies found.</td></tr>}
              {!loading && rows.map((r) => (
                <React.Fragment key={r.id}>
                  <tr>
                    <td className="wl-expand-toggle">
                      <button className="wl-expand-btn" title="Show more details"
                        onClick={() => setExpanded((cur) => cur === r.id ? null : r.id)}>
                        {expanded === r.id ? '▾' : '▸'}
                      </button>
                    </td>
                    <td>
                      <div className="wl-patient-name">{r.patientName}</div>
                      <div className="wl-patient-id">{r.patientId}</div>
                    </td>
                    <td>{r.accessionNumber}</td>
                    <td>{fmtDate(r.studyDate)} <span className="muted">{fmtTime(r.studyDate)}</span></td>
                    <td>
                      <div><span className="badge status-neutral">{r.modality}</span></div>
                      <div className="wl-study-desc" title={r.description}>{r.description}</div>
                    </td>
                    <td>{r.assignedRadiologist ?? <span className="muted">—</span>}</td>
                    <td><StatusBadge status={r.reportStatus} /></td>
                    <td>{r.imageCount}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn sm primary"
                          title={r.hasImages ? 'Open study in the DICOM viewer' : 'No images stored for this study yet'}
                          disabled={!r.hasImages || !r.studyInstanceUid}
                          onClick={() => openStudy(r)}
                        >Open Study</button>
                        <button
                          className="btn sm"
                          title={r.hasImages ? 'Open study directly in 3D/MPR view' : 'No images stored for this study yet'}
                          disabled={!r.hasImages || !r.studyInstanceUid}
                          onClick={() => openStudy3D(r)}
                        >3D View</button>
                        <button className="btn sm" title="Open the radiology report editor"
                          onClick={() => nav(`/reports/study/${r.id}`)}>Report</button>
                        <button className="btn sm" title="View full study details"
                          onClick={() => nav(`/studies/${r.id}`)}>Details</button>
                        {canOps && r.studyInstanceUid && (
                          <button className="btn sm" title="View transfer / archive operations for this study"
                            onClick={() => setOpsUid(r.studyInstanceUid)}>Operations</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr className="wl-detail-row">
                      <td colSpan={9}>
                        <div className="wl-detail-grid">
                          <div><span>Sl No</span>{r.slNo}</div>
                          <div><span>Accession No</span>{r.accessionNumber}</div>
                          <div><span>Study Date</span>{fmtDate(r.studyDate)} {fmtTime(r.studyDate)}</div>
                          <div><span>Images</span>{r.imageCount}</div>
                          <div><span>Referring Doctor</span>{r.referringDoctor}</div>
                          <div><span>Assigned Radiologist</span>{r.assignedRadiologist ?? '—'}</div>
                          <div><span>Study Instance UID</span><span style={{ fontFamily: 'monospace', fontSize: 11 }} title={r.studyInstanceUid}>…{String(r.studyInstanceUid ?? '').slice(-20)}</span></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
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
      <div className="wl-cards">
        {loading && <div className="card muted" style={{ padding: 16 }}>Loading…</div>}
        {!loading && rows.length === 0 && <div className="card muted" style={{ padding: 16 }}>No studies found.</div>}
        {!loading && rows.map((r) => (
          <div className="wl-card" key={r.id}>
            <div className="wl-card-top">
              <div>
                <div className="wl-patient-name">{r.patientName}</div>
                <div className="wl-patient-id">{r.patientId} · {r.accessionNumber}</div>
              </div>
              <StatusBadge status={r.reportStatus} />
            </div>
            <div className="wl-card-row"><span>Study Date</span><span>{fmtDate(r.studyDate)} {fmtTime(r.studyDate)}</span></div>
            <div className="wl-card-row"><span>Modality</span><span className="badge status-neutral">{r.modality}</span></div>
            <div className="wl-card-row"><span>Description</span><span>{r.description}</span></div>
            <div className="wl-card-row"><span>Assigned</span><span>{r.assignedRadiologist ?? '—'}</span></div>
            <div className="wl-card-row"><span>Referring Doctor</span><span>{r.referringDoctor}</span></div>
            <div className="wl-card-row"><span>Images</span><span>{r.imageCount}</span></div>
            <div className="wl-card-actions">
              <button className="btn sm primary" disabled={!r.hasImages || !r.studyInstanceUid} onClick={() => openStudy(r)}>Open Study</button>
              <button className="btn sm" disabled={!r.hasImages || !r.studyInstanceUid} onClick={() => openStudy3D(r)}>3D View</button>
              <button className="btn sm" onClick={() => nav(`/reports/study/${r.id}`)}>Report</button>
              <button className="btn sm" onClick={() => nav(`/studies/${r.id}`)}>Details</button>
              {canOps && r.studyInstanceUid && (
                <button className="btn sm" onClick={() => setOpsUid(r.studyInstanceUid)}>Operations</button>
              )}
            </div>
          </div>
        ))}
        <div className="pager">
          <span className="muted">{meta.total} total · page {meta.page}/{meta.totalPages}</span>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <button className="btn sm" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>

      {opsUid && <StudyOperationsDrawer uid={opsUid} onClose={() => setOpsUid(null)} />}
    </div>
  );
}

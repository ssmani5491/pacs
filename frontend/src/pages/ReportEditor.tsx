import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { openStudyInViewer } from '../lib/viewer';
import { Dictation, dictationSupported } from '../lib/dictation';
import { Modal } from '../components/DataTable';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const EDITABLE = ['clinicalHistory', 'technique', 'comparison', 'findings', 'impression', 'recommendations'] as const;
type Content = Record<(typeof EDITABLE)[number], string>;

const BLANK: Content = { clinicalHistory: '', technique: '', comparison: '', findings: '', impression: '', recommendations: '' };
const GENDER_LABEL: Record<string, string> = { M: 'Male', F: 'Female', O: 'Other', U: 'Unknown' };

/** Mirrors the backend's calcAge (patients.service.ts) exactly — same algorithm, computed
 * client-side since this page's existing endpoint returns raw dob, not a precomputed age. */
function calcAge(dob?: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

/**
 * Radiology Report Editor (Phase 7). Opened per study: /reports/study/:studyId
 * Auto-populates patient/study, auto-saves drafts, drives the lifecycle, signs
 * (with password step-up), shows versions + addenda, dictation + macros + PDF.
 */
export function ReportEditor() {
  const { studyId, id: reportIdParam } = useParams();
  const nav = useNavigate();
  const { can, me } = useAuth();

  const [study, setStudy] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [content, setContent] = useState<Content>(BLANK);
  const [templates, setTemplates] = useState<any[]>([]);
  const [macros, setMacros] = useState<any[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<any[]>([]);
  const [showSign, setShowSign] = useState(false);
  const [signPw, setSignPw] = useState('');
  const [dictateField, setDictateField] = useState<string | null>(null);
  const dictationRef = useRef<Dictation>(new Dictation());

  const locked = report?.locked || report?.status === 'FINAL';
  const canEdit = can('report.edit') && report && !locked;

  const loadReport = useCallback(async () => {
    if (reportIdParam) {
      // Load a specific report (e.g. an addendum) by id.
      const rep = await api.get('/reports/' + reportIdParam);
      setStudy(rep.study);
      setReport(rep);
      setContent(pick(rep));
      loadVersions(rep.id);
      return;
    }
    const r = await api.get('/reports/study/' + studyId);
    setStudy(r.study);
    if (r.report) {
      setReport(r.report);
      setContent(pick(r.report));
      loadVersions(r.report.id);
    }
  }, [studyId, reportIdParam]);

  const loadVersions = async (id: string) => {
    try { setVersions(await api.get(`/reports/${id}/versions`)); } catch { /* ignore */ }
  };

  useEffect(() => {
    loadReport().catch((e) => setErr(e.message));
    api.get('/report-templates?pageSize=100').then((r) => setTemplates(r.data)).catch(() => {});
    api.get('/report-macros').then(setMacros).catch(() => {});
  }, [loadReport]);

  // Warn on unload with unsaved changes (prevent accidental loss).
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // Debounced auto-save.
  const saveTimer = useRef<any>(null);
  const scheduleSave = useCallback((next: Content) => {
    if (!report || locked) return;
    setDirty(true);
    setSaveState('idle');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => doSave(next), 1200);
  }, [report, locked]);

  const doSave = async (next: Content) => {
    if (!report || locked) return;
    setSaveState('saving');
    try {
      const updated = await api.patch(`/reports/${report.id}`, next);
      setReport((r: any) => ({ ...r, ...updated }));
      setSaveState('saved'); setDirty(false);
      loadVersions(report.id);
    } catch (e: any) { setSaveState('error'); setErr(e.message); }
  };

  const onField = (name: keyof Content, value: string) => {
    const next = { ...content, [name]: value };
    setContent(next);
    scheduleSave(next);
  };

  const createReport = async (templateId?: string) => {
    setBusy(true); setErr('');
    try {
      const r = await api.post('/reports', { studyId, templateId });
      setReport(r); setContent(pick(r)); loadVersions(r.id);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const transition = async (path: string) => {
    setBusy(true); setErr('');
    try {
      await api.post(`/reports/${report.id}/${path}`);
      await loadReport();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const sign = async () => {
    setBusy(true); setErr('');
    try {
      await api.post(`/reports/${report.id}/sign`, { password: signPw });
      setShowSign(false); setSignPw('');
      await loadReport();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const addendum = async () => {
    const reason = window.prompt('Reason for addendum (required):');
    if (!reason) return;
    setBusy(true); setErr('');
    try {
      const a = await api.post(`/reports/${report.id}/addendum`, { reason });
      // open the addendum for editing (it is a new DRAFT report)
      nav(`/reports/study/${studyId}`); // reload shows it; edit via its own report
      await loadReport();
      window.alert('Addendum created (DRAFT). The original signed report is unchanged.');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const applyMacro = (m: any) => {
    const next = { ...content };
    if (m.findings) next.findings = (next.findings ? next.findings + '\n' : '') + m.findings;
    if (m.impression) next.impression = (next.impression ? next.impression + '\n' : '') + m.impression;
    if (m.recommendations) next.recommendations = (next.recommendations ? next.recommendations + '\n' : '') + m.recommendations;
    setContent(next); scheduleSave(next);
  };

  const toggleDictation = (field: keyof Content) => {
    const d = dictationRef.current;
    if (dictateField === field) { d.stop(); setDictateField(null); return; }
    if (d.active) d.stop();
    const started = d.start((text, isFinal) => {
      if (!isFinal) return; // only commit finalized phrases
      setContent((c) => {
        const next = { ...c, [field]: (c[field] ? c[field] + ' ' : '') + text };
        scheduleSave(next);
        return next;
      });
    }, () => setDictateField(null));
    if (started) setDictateField(field); else window.alert('Speech recognition is not available in this browser.');
  };

  const openPdf = () => window.open(`/api/reports/${report.id}/pdf`, '_blank');

  if (err && !study) return <div className="error">{err}</div>;
  if (!study) return <div style={{ padding: 40 }}>Loading…</div>;

  const patient = study.patient;
  const age = calcAge(patient?.dob);
  const genderLabel = patient?.gender ? (GENDER_LABEL[patient.gender] ?? patient.gender) : null;
  const statusBadge: Record<string, string> = { DRAFT: 'draft', PRELIMINARY: 'prelim', FINAL: 'final' };

  return (
    <div>
      <div className="page-head">
        <h1>Radiology Report</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {study.orthancStudyId && (
            <button className="btn sm" onClick={() => openStudyInViewer(study.studyInstanceUid).catch((e) => setErr(e.message))}>
              🖼 Open in Viewer
            </button>
          )}
          <button className="btn sm" onClick={() => nav('/reporting')}>← Reporting Worklist</button>
        </div>
      </div>

      {err && <div className="error">{err}</div>}

      {/* Patient / study header, auto-populated — read-only context for the editor below */}
      <div className="card re-header" style={{ marginBottom: 12 }}>
        <div className="re-header-grid">
          <div className="re-field"><span>Patient</span><strong>{patient?.name ?? '—'}</strong></div>
          <div className="re-field"><span>Patient ID</span>{patient?.mrn ?? '—'}</div>
          <div className="re-field"><span>Age / Gender</span>{age !== null ? age : '—'}{genderLabel ? ` / ${genderLabel}` : ''}</div>
          <div className="re-field"><span>Accession</span>{study.accessionNumber ?? '—'}</div>
          <div className="re-field"><span>Modality</span>{study.modality ? <span className="badge status-neutral">{study.modality}</span> : '—'}</div>
          <div className="re-field"><span>Study Description</span>{study.description ?? '—'}</div>
          <div className="re-field"><span>Study Date</span>{study.studyDate ? new Date(study.studyDate).toLocaleString() : '—'}</div>
          {/* GET /reports/study/:studyId does not include the referringDoctor relation on
              study (only on patient, which has none here) — renders '—' until that changes. */}
          <div className="re-field"><span>Referring Physician</span>{study.referringDoctor?.name ?? '—'}</div>
        </div>
      </div>

      {!report ? (
        <div className="card">
          <p className="muted">No report yet for this study.</p>
          {can('report.create') ? (
            <div className="re-create-row">
              <div>
                <label>Start from template</label>
                <select id="tplSel" defaultValue="">
                  <option value="">— No template —</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.code ? ` (${t.code})` : ''}</option>)}
                </select>
              </div>
              <button className="btn primary" disabled={busy} onClick={() => {
                const sel = (document.getElementById('tplSel') as HTMLSelectElement)?.value || undefined;
                createReport(sel);
              }}>Create Report</button>
            </div>
          ) : <p className="muted">You do not have permission to create reports.</p>}
        </div>
      ) : (
        <>
          {/* Status + lifecycle actions */}
          <div className="card re-status-bar">
            <div className="re-status-left">
              <span className={`badge ${statusBadge[report.status] ?? 'off'}`}>{report.status}</span>
              {report.locked && <span className="badge final">🔒 Signed &amp; Locked</span>}
              <span className="muted">v{report.version}</span>
              <span className="muted re-save-state">
                {saveState === 'saving' ? '● Saving…' : saveState === 'saved' ? '✓ Saved' : saveState === 'error' ? '⚠ Save failed' : dirty ? '○ Unsaved changes' : ''}
              </span>
            </div>
            <div className="re-status-actions">
              {report.status === 'DRAFT' && can('report.preliminary') && !locked &&
                <button className="btn sm" disabled={busy} onClick={() => transition('preliminary')}>Submit Preliminary</button>}
              {['DRAFT', 'PRELIMINARY'].includes(report.status) && can('report.finalize') && !locked &&
                <button className="btn sm primary" disabled={busy} onClick={() => transition('finalize')}>Finalize</button>}
              {report.status === 'FINAL' && !report.locked && can('report.sign') &&
                <button className="btn sm primary" disabled={busy} onClick={() => setShowSign(true)}>Sign</button>}
              {report.locked && can('report.amend') &&
                <button className="btn sm" disabled={busy} onClick={addendum}>Create Addendum</button>}
              {can('report.download') &&
                <button className="btn sm" onClick={openPdf}>Preview / PDF</button>}
            </div>
          </div>

          {/* Macros */}
          {macros.length > 0 && canEdit && (
            <div className="card" style={{ marginBottom: 10 }}>
              <label>Insert Macro</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {macros.map((m) => <button key={m.id} className="btn sm" onClick={() => applyMacro(m)}>{m.name}</button>)}
              </div>
            </div>
          )}

          {/* Report sections */}
          <div className="card re-sections">
            {sectionDefs.map((s) => (
              <div key={s.key} className="re-section">
                <label className="re-section-label">
                  {s.label}
                  {s.dictatable && canEdit && dictationSupported() && (
                    <button type="button" className={`btn sm ${dictateField === s.key ? 'primary' : ''}`}
                      title="Dictate (local browser speech; off by default)"
                      onClick={() => toggleDictation(s.key as keyof Content)}>
                      {dictateField === s.key ? '● Stop' : '🎙 Dictate'}
                    </button>
                  )}
                </label>
                <textarea
                  rows={s.rows}
                  value={content[s.key as keyof Content]}
                  disabled={!canEdit}
                  onChange={(e) => onField(s.key as keyof Content, e.target.value)}
                />
              </div>
            ))}
          </div>

          {/* Addenda */}
          {report.addenda?.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3 style={{ marginTop: 0 }}>Addenda</h3>
              {report.addenda.map((a: any) => (
                <div key={a.id} className="re-addendum-row">
                  <span className={`badge ${statusBadge[a.status] ?? 'off'}`}>{a.status}</span> v{a.version}
                  <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => nav(`/reports/${a.id}`)}>Open addendum</button>
                </div>
              ))}
            </div>
          )}

          {/* Version history */}
          <div className="card re-version-history" style={{ marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Version History ({versions.length})</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="re-version-table">
                <thead><tr><th>Ver</th><th>Status</th><th>Reason</th><th>By</th><th>When</th></tr></thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id}>
                      <td>{v.version}</td><td>{v.status}</td><td>{v.reason ?? '—'}</td>
                      <td>{v.createdBy ?? '—'}</td><td>{new Date(v.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Signature info */}
          {report.signatures?.length > 0 && (
            <div className="card re-signature" style={{ marginTop: 12 }}>
              <h3 style={{ marginTop: 0 }}>Signature</h3>
              {report.signatures.map((s: any) => (
                <div key={s.id} className="muted re-signature-row">
                  Signed by <strong>{s.user?.fullName ?? s.userId}</strong> at {new Date(s.signedAt).toLocaleString()} ·
                  v{s.reportVersion} · {s.method} · hash {String(s.signatureHash).slice(0, 16)}…
                  <div style={{ fontSize: 11, marginTop: 2 }}>Authenticated electronic approval — not a legally recognised digital signature.</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Sign dialog — password step-up */}
      {showSign && (
        <Modal title="Sign Report" onClose={() => setShowSign(false)}>
          <p className="muted" style={{ fontSize: 13 }}>
            Re-enter your password to sign. This records an authenticated electronic approval,
            locks the report, and cannot be undone.
          </p>
          <label>Password</label>
          <input type="password" value={signPw} onChange={(e) => setSignPw(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') sign(); }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn primary" disabled={busy || !signPw} onClick={sign}>Sign &amp; Lock</button>
            <button className="btn" onClick={() => setShowSign(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const sectionDefs = [
  { key: 'clinicalHistory', label: 'Clinical History', rows: 2, dictatable: false },
  { key: 'technique', label: 'Technique', rows: 2, dictatable: false },
  { key: 'comparison', label: 'Comparison', rows: 1, dictatable: false },
  { key: 'findings', label: 'Findings', rows: 8, dictatable: true },
  { key: 'impression', label: 'Impression', rows: 4, dictatable: true },
  { key: 'recommendations', label: 'Recommendations', rows: 2, dictatable: false },
];

function pick(r: any): Content {
  return {
    clinicalHistory: r.clinicalHistory ?? '', technique: r.technique ?? '', comparison: r.comparison ?? '',
    findings: r.findings ?? '', impression: r.impression ?? '', recommendations: r.recommendations ?? '',
  };
}

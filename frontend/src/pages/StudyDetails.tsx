import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { StatusBadge } from '../components/StatusBadge';
import { openStudyInViewer } from '../lib/viewer';

const GENDER_LABEL: Record<string, string> = { M: 'Male', F: 'Female', O: 'Other', U: 'Unknown' };

export function StudyDetails() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [data, setData] = useState<any>(null);
  const [order, setOrder] = useState<any>(null);
  const [err, setErr] = useState('');
  const [viewerErr, setViewerErr] = useState('');

  useEffect(() => {
    api.get(`/reports/study/${id}`).then(setData).catch((e) => setErr(e.message));
  }, [id]);

  useEffect(() => {
    if (!data?.study?.accessionNumber || !can('order.manage')) return;
    api.get('/orders' + qs({ search: data.study.accessionNumber, page: 1, pageSize: 5 }))
      .then((res) => {
        const match = res.data?.find((o: any) => o.accessionNumber === data.study.accessionNumber);
        setOrder(match ?? null);
      })
      .catch(() => { /* order lookup is best-effort; study details still render without it */ });
  }, [data, can]);

  if (err) return <div className="error">{err}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  const { study, report } = data;
  const p = study.patient;
  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString() : '—';
  const fmtDateTime = (d?: string) => d ? new Date(d).toLocaleString() : '—';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Study Details</h1>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Accession {study.accessionNumber ?? '—'}</p>
        </div>
        <button className="btn" onClick={() => nav(-1 as any)}>← Back</button>
      </div>

      {viewerErr && <div className="error">{viewerErr}</div>}

      <div className="sd-grid">
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Patient Information</h3>
          {p ? (
            <>
              <div className="sd-field"><span>Name</span><Link to={`/patients/${p.id}`}>{p.name}</Link></div>
              <div className="sd-field"><span>Patient ID</span>{p.mrn}</div>
              <div className="sd-field"><span>Gender</span>{p.gender ? (GENDER_LABEL[p.gender] ?? p.gender) : '—'}</div>
              <div className="sd-field"><span>Date of Birth</span>{fmtDate(p.dob)}</div>
            </>
          ) : <div className="muted">No patient linked to this study.</div>}
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Examination Information</h3>
          <div className="sd-field"><span>Modality</span>{study.modality ? <span className="badge status-neutral">{study.modality}</span> : '—'}</div>
          <div className="sd-field"><span>Description</span>{study.description ?? '—'}</div>
          <div className="sd-field"><span>Study Date</span>{fmtDateTime(study.studyDate)}</div>
          <div className="sd-field"><span>Referring Doctor</span>{study.referringDoctor?.name ?? '—'}</div>
          <div className="sd-field"><span>Reporting Status</span><StatusBadge status={study.reportStatus} /></div>
          <div className="sd-field"><span>Image Count</span>{study.imageCount}</div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>DICOM Study Information</h3>
          <div className="sd-field"><span>Study Instance UID</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11 }} title={study.studyInstanceUid}>{study.studyInstanceUid ?? '—'}</span>
          </div>
          <div className="sd-field"><span>Accession Number</span>{study.accessionNumber ?? '—'}</div>
          <div className="sd-field"><span>Images in PACS</span>{study.orthancStudyId ? 'Yes' : 'No'}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            Series and instance-level detail is not currently exposed by the API and is not shown here.
          </div>
        </div>

        {order && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Order Details</h3>
            <div className="sd-field"><span>Procedure</span>{order.procedureDesc}</div>
            <div className="sd-field"><span>Priority</span>{order.priority}</div>
            <div className="sd-field"><span>Scheduled</span>{fmtDateTime(order.scheduledAt)}</div>
            <div className="sd-field"><span>Order Status</span><span className="badge status-neutral">{order.status}</span></div>
          </div>
        )}

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Reporting Information</h3>
          {report ? (
            <>
              <div className="sd-field"><span>Author</span>{report.author?.fullName ?? '—'}</div>
              <div className="sd-field"><span>Status</span><StatusBadge status={study.reportStatus} /></div>
              {report.addenda?.length > 0 && (
                <div className="sd-field"><span>Addenda</span>{report.addenda.length}</div>
              )}
            </>
          ) : <div className="muted">No report started for this study yet.</div>}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Quick Actions</h3>
        <div className="row-actions">
          <button className="btn primary"
            title={study.orthancStudyId ? 'Open study in the DICOM viewer' : 'No images stored for this study yet'}
            disabled={!study.orthancStudyId || !study.studyInstanceUid}
            onClick={() => openStudyInViewer(study.studyInstanceUid).catch((e) => setViewerErr(e.message))}>
            Open Study
          </button>
          <button className="btn" onClick={() => nav(`/reports/study/${study.id}`)}>Open Report</button>
          {p && <button className="btn" onClick={() => nav(`/patients/${p.id}`)}>View Patient</button>}
        </div>
      </div>
    </div>
  );
}

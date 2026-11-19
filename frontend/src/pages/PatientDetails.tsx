import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { openStudyInViewer } from '../lib/viewer';

const GENDER_LABEL: Record<string, string> = { M: 'Male', F: 'Female', O: 'Other', U: 'Unknown' };

export function PatientDetails() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [viewerErr, setViewerErr] = useState('');

  useEffect(() => {
    api.get(`/patients/${id}/history`).then(setData).catch((e) => setErr(e.message));
  }, [id]);

  if (err) return <div className="error">{err}</div>;
  if (!data) return <div className="muted">Loading…</div>;
  const p = data.patient;
  const fmt = (d?: string) => d ? new Date(d).toLocaleDateString() : '—';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{p.name}</h1>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Patient ID {p.mrn}</p>
        </div>
        <button className="btn" onClick={() => nav('/patients')}>← Back to Patient List</button>
      </div>

      <div className="pd-grid">
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Demographics</h3>
          <div className="pd-field"><span>Gender</span>{p.gender ? (GENDER_LABEL[p.gender] ?? p.gender) : '—'}</div>
          <div className="pd-field"><span>Age</span>{p.age ?? '—'}</div>
          <div className="pd-field"><span>Date of Birth</span>{fmt(p.dob)}</div>
          <div className="pd-field"><span>Status</span><StatusBadge status={p.status} /></div>
          <div className="pd-field"><span>Referring Doctor</span>{p.referringDoctor?.name ?? '—'}</div>
          <div className="pd-field"><span>Registered</span>{fmt(p.registrationDate)}</div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Contact Information</h3>
          <div className="pd-field"><span>Mobile</span>{p.mobile ?? '—'}</div>
          <div className="pd-field"><span>Email</span>{p.email ?? '—'}</div>
          <div className="pd-field"><span>Address</span>{p.address ?? '—'}</div>
        </div>
      </div>

      {viewerErr && <div className="error">{viewerErr}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Previous Examinations ({data.studies.length})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="pd-studies-table">
            <thead><tr><th>Accession</th><th>Date</th><th>Modality</th><th>Description</th><th>Status</th><th>Images</th><th>Actions</th></tr></thead>
            <tbody>
              {data.studies.length === 0 && <tr><td colSpan={7} className="muted">No studies yet.</td></tr>}
              {data.studies.map((s: any) => (
                <tr key={s.id}>
                  <td>{s.accessionNumber ?? '—'}</td>
                  <td>{fmt(s.studyDate)}</td>
                  <td>{s.modality ?? '—'}</td>
                  <td>{s.description ?? '—'}</td>
                  <td><StatusBadge status={s.reportStatus} /></td>
                  <td>{s.imageCount}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn sm primary" disabled={!s.studyInstanceUid}
                        onClick={() => openStudyInViewer(s.studyInstanceUid).catch((e) => setViewerErr(e.message))}>
                        Open Study
                      </button>
                      <button className="btn sm" onClick={() => nav(`/reports/study/${s.id}`)}>Report</button>
                      <button className="btn sm" onClick={() => nav(`/studies/${s.id}`)}>Details</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Examination Orders ({data.orders.length})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="pd-orders-table">
            <thead><tr><th>Accession</th><th>Scheduled</th><th>Modality</th><th>Procedure</th><th>Priority</th><th>Status</th></tr></thead>
            <tbody>
              {data.orders.length === 0 && <tr><td colSpan={6} className="muted">No orders yet.</td></tr>}
              {data.orders.map((o: any) => (
                <tr key={o.id}>
                  <td>{o.accessionNumber}</td>
                  <td>{fmt(o.scheduledAt)}</td>
                  <td>{o.modalityType}</td>
                  <td>{o.procedureDesc}</td>
                  <td>{o.priority}</td>
                  <td><span className="badge status-neutral">{o.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

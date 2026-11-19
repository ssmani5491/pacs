import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useList } from '../components/useList';
import { useAuth } from '../lib/auth';

const GENDER_LABEL: Record<string, string> = { M: 'Male', F: 'Female', O: 'Other', U: 'Unknown' };

interface PatientForm {
  name: string; dob: string; gender: string; mobile: string; email: string; address: string;
}
const EMPTY_FORM: PatientForm = { name: '', dob: '', gender: '', mobile: '', email: '', address: '' };

export function Patients() {
  const nav = useNavigate();
  const { can } = useAuth();
  const canManage = can('patient.manage');
  const list = useList<any>('/patients');

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<PatientForm>(EMPTY_FORM);
  const [formErr, setFormErr] = useState('');
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<Array<{ id: string; mrn: string; name: string }> | null>(null);
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setForm(EMPTY_FORM); setFormErr(''); setFieldErrs({}); setDuplicates(null); setCreating(true);
  }
  function close() { setCreating(false); }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Patient name is required.';
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) errs.email = 'Enter a valid email address.';
    setFieldErrs(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit(allowDuplicate = false) {
    if (!validate()) return;
    setSaving(true); setFormErr(''); setDuplicates(null);
    try {
      const payload: Record<string, any> = { name: form.name.trim() };
      if (form.dob) payload.dob = form.dob;
      if (form.gender) payload.gender = form.gender;
      if (form.mobile) payload.mobile = form.mobile;
      if (form.email) payload.email = form.email;
      if (form.address) payload.address = form.address;
      if (allowDuplicate) payload.allowDuplicate = true;
      await api.post('/patients', payload);
      close();
      list.reload();
    } catch (e: any) {
      const err = e as ApiError;
      if (err.status === 409 && err.body?.duplicates) {
        setDuplicates(err.body.duplicates);
        setFormErr(err.body.message ?? 'Possible duplicate patient(s) found.');
      } else {
        setFormErr(err.message ?? 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  }

  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString() : '—';

  return (
    <div>
      <div className="page-head">
        <div className="pm-head-row">
          <div>
            <h1>Patient Management</h1>
            <p>Search, register and manage patients across the organisation.</p>
          </div>
          <div className="pm-head-meta">
            {!list.loading && <span>{list.meta.total} patients</span>}
            {list.loading && <span>Loading…</span>}
            <button className="btn sm" onClick={list.reload} disabled={list.loading}>
              {list.loading ? 'Refreshing…' : 'Refresh'}
            </button>
            {canManage && <button className="btn sm primary" onClick={openCreate}>+ Register Patient</button>}
          </div>
        </div>
      </div>

      {list.error && <div className="error">{list.error}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="toolbar">
          <input placeholder="Search by Patient ID, name, mobile or email…" style={{ maxWidth: 360 }}
            value={list.search} onChange={(e) => { list.setPage(1); list.setSearch(e.target.value); }} />
        </div>
      </div>

      {/* Desktop/tablet table */}
      <div className="card pm-table-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table className="pm-table">
            <thead>
              <tr>
                <th onClick={() => list.onSort('mrn')} style={{ cursor: 'pointer' }}>
                  Patient ID{list.sortBy === 'mrn' ? (list.sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th onClick={() => list.onSort('name')} style={{ cursor: 'pointer' }}>
                  Name{list.sortBy === 'name' ? (list.sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th>Age / Gender</th>
                <th>Contact</th>
                <th onClick={() => list.onSort('registrationDate')} style={{ cursor: 'pointer' }}>
                  Registered{list.sortBy === 'registrationDate' ? (list.sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.loading && <tr><td colSpan={7} className="muted">Loading…</td></tr>}
              {!list.loading && list.rows.length === 0 && <tr><td colSpan={7} className="muted">No patients found.</td></tr>}
              {!list.loading && list.rows.map((p: any) => (
                <tr key={p.id}>
                  <td>
                    <a onClick={(e) => { e.preventDefault(); nav(`/patients/${p.id}`); }} href="#">{p.mrn}</a>
                  </td>
                  <td className="pm-patient-name">{p.name}</td>
                  <td>{p.age ?? '—'}{p.gender ? ` / ${GENDER_LABEL[p.gender] ?? p.gender}` : ''}</td>
                  <td>
                    <div>{p.mobile ?? '—'}</div>
                    {p.email && <div className="muted" style={{ fontSize: 11 }}>{p.email}</div>}
                  </td>
                  <td>{fmtDate(p.registrationDate)}</td>
                  <td><span className={`badge ${p.status === 'ACTIVE' ? 'ok' : 'off'}`}>{p.status === 'ACTIVE' ? 'Active' : p.status}</span></td>
                  <td>
                    <div className="row-actions">
                      <button className="btn sm" onClick={() => nav(`/patients/${p.id}`)}>View</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span className="muted">{list.meta.total} total · page {list.meta.page}/{list.meta.totalPages}</span>
          <button className="btn sm" disabled={list.page <= 1} onClick={() => list.setPage(list.page - 1)}>Prev</button>
          <button className="btn sm" disabled={list.page >= list.meta.totalPages} onClick={() => list.setPage(list.page + 1)}>Next</button>
        </div>
      </div>

      {/* Mobile card list */}
      <div className="pm-cards">
        {list.loading && <div className="card muted" style={{ padding: 16 }}>Loading…</div>}
        {!list.loading && list.rows.length === 0 && <div className="card muted" style={{ padding: 16 }}>No patients found.</div>}
        {!list.loading && list.rows.map((p: any) => (
          <div className="pm-card" key={p.id}>
            <div className="pm-card-top">
              <div>
                <div className="pm-patient-name">{p.name}</div>
                <div className="pm-patient-mrn">{p.mrn}</div>
              </div>
              <span className={`badge ${p.status === 'ACTIVE' ? 'ok' : 'off'}`}>{p.status === 'ACTIVE' ? 'Active' : p.status}</span>
            </div>
            <div className="pm-card-row"><span>Age / Gender</span><span>{p.age ?? '—'}{p.gender ? ` / ${GENDER_LABEL[p.gender] ?? p.gender}` : ''}</span></div>
            <div className="pm-card-row"><span>Mobile</span><span>{p.mobile ?? '—'}</span></div>
            <div className="pm-card-row"><span>Email</span><span>{p.email ?? '—'}</span></div>
            <div className="pm-card-row"><span>Registered</span><span>{fmtDate(p.registrationDate)}</span></div>
            <div className="pm-card-actions">
              <button className="btn sm primary" onClick={() => nav(`/patients/${p.id}`)}>View Details</button>
            </div>
          </div>
        ))}
        <div className="pager">
          <span className="muted">{list.meta.total} total · page {list.meta.page}/{list.meta.totalPages}</span>
          <button className="btn sm" disabled={list.page <= 1} onClick={() => list.setPage(list.page - 1)}>Prev</button>
          <button className="btn sm" disabled={list.page >= list.meta.totalPages} onClick={() => list.setPage(list.page + 1)}>Next</button>
        </div>
      </div>

      {creating && (
        <div className="modal-bg" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="page-head"><h1 style={{ fontSize: 17 }}>Register Patient</h1>
              <button className="btn sm" onClick={close}>✕</button></div>

            {formErr && <div className="error">{formErr}</div>}
            {duplicates && duplicates.length > 0 && (
              <div className="pm-duplicate-warning">
                <strong>Possible existing match{duplicates.length > 1 ? 'es' : ''}:</strong>
                <ul>
                  {duplicates.map((d) => (
                    <li key={d.id}>{d.name} — Patient ID {d.mrn}</li>
                  ))}
                </ul>
                <div style={{ marginTop: 10 }}>
                  <button className="btn sm primary" onClick={() => submit(true)} disabled={saving}>
                    {saving ? 'Saving…' : 'Register as a new patient anyway'}
                  </button>
                </div>
              </div>
            )}

            <div className="pm-form-group">
              <div className="pm-form-group-title">Identity</div>
              <div>
                <label>Patient Name<span className="pm-required">*</span></label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                {fieldErrs.name && <div className="pm-field-error">{fieldErrs.name}</div>}
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  Patient ID is auto-generated. Duplicate detection runs on name + date of birth + gender.
                </div>
              </div>
              <div className="pm-form-grid" style={{ marginTop: 10 }}>
                <div><label>Date of Birth</label><input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></div>
                <div>
                  <label>Gender</label>
                  <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                    <option value="">— select —</option>
                    <option value="M">Male</option><option value="F">Female</option>
                    <option value="O">Other</option><option value="U">Unknown</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pm-form-group">
              <div className="pm-form-group-title">Contact</div>
              <div className="pm-form-grid">
                <div><label>Mobile</label><input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
                <div>
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  {fieldErrs.email && <div className="pm-field-error">{fieldErrs.email}</div>}
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label>Address</label>
                <textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button className="btn primary" onClick={() => submit(false)} disabled={saving}>{saving ? 'Saving…' : 'Register Patient'}</button>
              <button className="btn" onClick={close}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

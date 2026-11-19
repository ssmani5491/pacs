import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useList } from '../../components/useList';
import { useAuth } from '../../lib/auth';

interface DoctorForm {
  name: string; qualification: string; specialization: string; registrationNo: string; contact: string; canReport: boolean;
}
const EMPTY_FORM: DoctorForm = { name: '', qualification: '', specialization: '', registrationNo: '', contact: '', canReport: false };

export function Doctors() {
  const { can } = useAuth();
  const canManage = can('doctor.manage');
  const list = useList<any>('/doctors');

  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<DoctorForm>(EMPTY_FORM);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);

  function openCreate() { setForm(EMPTY_FORM); setFieldErrs({}); setFormErr(''); setCreating(true); setEditing(null); }
  function openEdit(row: any) {
    setForm({
      name: row.name, qualification: row.qualification ?? '', specialization: row.specialization ?? '',
      registrationNo: row.registrationNo ?? '', contact: row.contact ?? '', canReport: !!row.canReport,
    });
    setFieldErrs({}); setFormErr(''); setEditing(row); setCreating(false);
  }
  function close() { setCreating(false); setEditing(null); }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Name is required.';
    setFieldErrs(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setSaving(true); setFormErr('');
    try {
      const payload: Record<string, any> = {
        name: form.name.trim(), canReport: form.canReport,
        qualification: form.qualification || undefined, specialization: form.specialization || undefined,
        registrationNo: form.registrationNo || undefined, contact: form.contact || undefined,
      };
      if (editing) await api.patch(`/doctors/${editing.id}`, payload);
      else await api.post('/doctors', payload);
      close();
      list.reload();
    } catch (e: any) {
      setFormErr(e.message ?? 'Save failed');
    } finally { setSaving(false); }
  }

  async function toggleActive(row: any) {
    if (row.active && !window.confirm(`Deactivate doctor "${row.name}"?`)) return;
    try { await api.patch(`/doctors/${row.id}/active`, { active: !row.active }); list.reload(); }
    catch (e: any) { alert(e.message ?? 'Failed'); }
  }

  return (
    <div>
      <div className="page-head">
        <div className="adm-head-row">
          <div>
            <h1>Doctors</h1>
            <p>Manage referring and reporting physicians.</p>
          </div>
          <div className="adm-head-meta">
            {!list.loading && <span>{list.meta.total} doctors</span>}
            {list.loading && <span>Loading…</span>}
            <button className="btn sm" onClick={list.reload} disabled={list.loading}>{list.loading ? 'Refreshing…' : 'Refresh'}</button>
            {canManage && <button className="btn sm primary" onClick={openCreate}>+ New Doctor</button>}
          </div>
        </div>
      </div>

      {list.error && <div className="error">{list.error}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="toolbar">
          <input placeholder="Search by name or specialization…" style={{ maxWidth: 360 }}
            value={list.search} onChange={(e) => { list.setPage(1); list.setSearch(e.target.value); }} />
        </div>
      </div>

      <div className="card adm-table-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Name</th><th>Specialization</th><th>Reg. No</th><th>Can Report</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {list.loading && <tr><td colSpan={6} className="muted">Loading…</td></tr>}
              {!list.loading && list.rows.length === 0 && <tr><td colSpan={6} className="muted">No doctors found.</td></tr>}
              {!list.loading && list.rows.map((d: any) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.specialization ?? '—'}</td>
                  <td>{d.registrationNo ?? '—'}</td>
                  <td>{d.canReport ? 'Yes' : 'No'}</td>
                  <td><span className={`badge ${d.active ? 'ok' : 'off'}`}>{d.active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="row-actions">
                      {canManage && <button className="btn sm" onClick={() => openEdit(d)}>Edit</button>}
                      {canManage && <button className="btn sm" onClick={() => toggleActive(d)}>{d.active ? 'Deactivate' : 'Activate'}</button>}
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

      <div className="adm-cards">
        {list.loading && <div className="card muted" style={{ padding: 16 }}>Loading…</div>}
        {!list.loading && list.rows.length === 0 && <div className="card muted" style={{ padding: 16 }}>No doctors found.</div>}
        {!list.loading && list.rows.map((d: any) => (
          <div className="adm-card" key={d.id}>
            <div className="adm-card-top">
              <div><strong>{d.name}</strong><div className="muted" style={{ fontSize: 12 }}>{d.specialization ?? '—'}</div></div>
              <span className={`badge ${d.active ? 'ok' : 'off'}`}>{d.active ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="adm-card-row"><span>Reg. No</span><span>{d.registrationNo ?? '—'}</span></div>
            <div className="adm-card-row"><span>Can Report</span><span>{d.canReport ? 'Yes' : 'No'}</span></div>
            {canManage && (
              <div className="adm-card-actions">
                <button className="btn sm" onClick={() => openEdit(d)}>Edit</button>
                <button className="btn sm" onClick={() => toggleActive(d)}>{d.active ? 'Deactivate' : 'Activate'}</button>
              </div>
            )}
          </div>
        ))}
        <div className="pager">
          <span className="muted">{list.meta.total} total · page {list.meta.page}/{list.meta.totalPages}</span>
          <button className="btn sm" disabled={list.page <= 1} onClick={() => list.setPage(list.page - 1)}>Prev</button>
          <button className="btn sm" disabled={list.page >= list.meta.totalPages} onClick={() => list.setPage(list.page + 1)}>Next</button>
        </div>
      </div>

      {(creating || editing) && (
        <div className="modal-bg" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="page-head"><h1 style={{ fontSize: 17 }}>{creating ? 'New Doctor' : 'Edit Doctor'}</h1>
              <button className="btn sm" onClick={close}>✕</button></div>
            {formErr && <div className="error">{formErr}</div>}

            <div className="adm-form-group">
              <div>
                <label>Name<span className="adm-required">*</span></label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                {fieldErrs.name && <div className="adm-field-error">{fieldErrs.name}</div>}
              </div>
              <div className="adm-form-grid" style={{ marginTop: 10 }}>
                <div><label>Qualification</label><input value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} /></div>
                <div><label>Specialization</label><input value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} /></div>
              </div>
              <div className="adm-form-grid" style={{ marginTop: 10 }}>
                <div><label>Registration No</label><input value={form.registrationNo} onChange={(e) => setForm({ ...form, registrationNo: e.target.value })} /></div>
                <div><label>Contact</label><input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
              </div>
              <label style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={form.canReport} onChange={(e) => setForm({ ...form, canReport: e.target.checked })} />
                Can report studies
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button className="btn" onClick={close}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

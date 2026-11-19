import React, { useEffect, useState } from 'react';
import { api, qs } from '../../lib/api';
import { useList } from '../../components/useList';
import { useAuth } from '../../lib/auth';

interface DeptForm { organizationId: string; code: string; name: string; jobType: string; }
const EMPTY_FORM: DeptForm = { organizationId: '', code: '', name: '', jobType: '' };

export function Departments() {
  const { can } = useAuth();
  const canManage = can('dept.manage');
  const list = useList<any>('/departments');

  const [orgs, setOrgs] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    api.get('/organizations' + qs({ pageSize: 200 }))
      .then((r) => setOrgs(r.data.map((o: any) => ({ value: o.id, label: `${o.code} — ${o.name}` }))))
      .catch(() => setOrgs([]));
  }, []);

  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<DeptForm>(EMPTY_FORM);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);

  function openCreate() { setForm(EMPTY_FORM); setFieldErrs({}); setFormErr(''); setCreating(true); setEditing(null); }
  function openEdit(row: any) {
    setForm({ organizationId: row.organizationId ?? '', code: row.code, name: row.name, jobType: row.jobType ?? '' });
    setFieldErrs({}); setFormErr(''); setEditing(row); setCreating(false);
  }
  function close() { setCreating(false); setEditing(null); }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!editing && !form.organizationId) errs.organizationId = 'Organization is required.';
    if (!editing && !form.code.trim()) errs.code = 'Code is required.';
    if (!form.name.trim()) errs.name = 'Name is required.';
    setFieldErrs(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setSaving(true); setFormErr('');
    try {
      if (editing) {
        await api.patch(`/departments/${editing.id}`, { name: form.name.trim(), jobType: form.jobType || undefined });
      } else {
        await api.post('/departments', {
          organizationId: form.organizationId, code: form.code.trim(), name: form.name.trim(), jobType: form.jobType || undefined,
        });
      }
      close();
      list.reload();
    } catch (e: any) {
      setFormErr(e.message ?? 'Save failed');
    } finally { setSaving(false); }
  }

  async function toggleActive(row: any) {
    if (row.active && !window.confirm(`Deactivate department "${row.name}"?`)) return;
    try { await api.patch(`/departments/${row.id}/active`, { active: !row.active }); list.reload(); }
    catch (e: any) { alert(e.message ?? 'Failed'); }
  }

  return (
    <div>
      <div className="page-head">
        <div className="adm-head-row">
          <div>
            <h1>Departments</h1>
            <p>Manage organisational departments and job types.</p>
          </div>
          <div className="adm-head-meta">
            {!list.loading && <span>{list.meta.total} departments</span>}
            {list.loading && <span>Loading…</span>}
            <button className="btn sm" onClick={list.reload} disabled={list.loading}>{list.loading ? 'Refreshing…' : 'Refresh'}</button>
            {canManage && <button className="btn sm primary" onClick={openCreate}>+ New Department</button>}
          </div>
        </div>
      </div>

      {list.error && <div className="error">{list.error}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="toolbar">
          <input placeholder="Search by code or name…" style={{ maxWidth: 360 }}
            value={list.search} onChange={(e) => { list.setPage(1); list.setSearch(e.target.value); }} />
        </div>
      </div>

      <div className="card adm-table-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Organization</th><th>Job Type</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {list.loading && <tr><td colSpan={6} className="muted">Loading…</td></tr>}
              {!list.loading && list.rows.length === 0 && <tr><td colSpan={6} className="muted">No departments found.</td></tr>}
              {!list.loading && list.rows.map((d: any) => (
                <tr key={d.id}>
                  <td>{d.code}</td>
                  <td>{d.name}</td>
                  <td>{d.organization?.code ?? '—'}</td>
                  <td>{d.jobType ?? '—'}</td>
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
        {!list.loading && list.rows.length === 0 && <div className="card muted" style={{ padding: 16 }}>No departments found.</div>}
        {!list.loading && list.rows.map((d: any) => (
          <div className="adm-card" key={d.id}>
            <div className="adm-card-top">
              <div><strong>{d.name}</strong><div className="muted" style={{ fontSize: 12 }}>{d.code}</div></div>
              <span className={`badge ${d.active ? 'ok' : 'off'}`}>{d.active ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="adm-card-row"><span>Organization</span><span>{d.organization?.code ?? '—'}</span></div>
            <div className="adm-card-row"><span>Job Type</span><span>{d.jobType ?? '—'}</span></div>
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
            <div className="page-head"><h1 style={{ fontSize: 17 }}>{creating ? 'New Department' : 'Edit Department'}</h1>
              <button className="btn sm" onClick={close}>✕</button></div>
            {formErr && <div className="error">{formErr}</div>}

            <div className="adm-form-group">
              {creating && (
                <div className="adm-form-grid">
                  <div>
                    <label>Organization<span className="adm-required">*</span></label>
                    <select value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })}>
                      <option value="">— select —</option>
                      {orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {fieldErrs.organizationId && <div className="adm-field-error">{fieldErrs.organizationId}</div>}
                  </div>
                  <div>
                    <label>Code<span className="adm-required">*</span></label>
                    <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                    {fieldErrs.code && <div className="adm-field-error">{fieldErrs.code}</div>}
                  </div>
                </div>
              )}
              <div className="adm-form-grid" style={{ marginTop: 10 }}>
                <div>
                  <label>Name<span className="adm-required">*</span></label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  {fieldErrs.name && <div className="adm-field-error">{fieldErrs.name}</div>}
                </div>
                <div><label>Job Type</label><input value={form.jobType} onChange={(e) => setForm({ ...form, jobType: e.target.value })} /></div>
              </div>
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

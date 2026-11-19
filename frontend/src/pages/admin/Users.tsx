import React, { useEffect, useState } from 'react';
import { api, qs } from '../../lib/api';
import { useList } from '../../components/useList';
import { useAuth } from '../../lib/auth';

interface UserForm {
  username: string; fullName: string; email: string; initialPassword: string;
  mobile: string; employeeId: string; designation: string; organizationId: string; roleKey: string;
}
const EMPTY_FORM: UserForm = {
  username: '', fullName: '', email: '', initialPassword: '', mobile: '', employeeId: '', designation: '', organizationId: '', roleKey: '',
};

export function Users() {
  const { can } = useAuth();
  const canManage = can('user.manage');
  const list = useList<any>('/users');

  const [roles, setRoles] = useState<{ value: string; label: string }[]>([]);
  const [orgs, setOrgs] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    api.get('/roles').then((r) => setRoles(r.map((x: any) => ({ value: x.key, label: x.name })))).catch(() => {});
    api.get('/organizations' + qs({ pageSize: 200 }))
      .then((r) => setOrgs(r.data.map((o: any) => ({ value: o.id, label: `${o.code} — ${o.name}` })))).catch(() => {});
  }, []);

  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);

  function openCreate() { setForm(EMPTY_FORM); setFieldErrs({}); setFormErr(''); setCreating(true); setEditing(null); }
  function openEdit(row: any) {
    setForm({
      username: row.username, fullName: row.fullName, email: row.email, initialPassword: '',
      mobile: row.mobile ?? '', employeeId: row.employeeId ?? '', designation: row.designation ?? '',
      organizationId: row.organizationId ?? '', roleKey: row.roles?.[0]?.role?.key ?? '',
    });
    setFieldErrs({}); setFormErr(''); setEditing(row); setCreating(false);
  }
  function close() { setCreating(false); setEditing(null); }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.fullName.trim()) errs.fullName = 'Full name is required.';
    if (!form.email.trim()) errs.email = 'Email is required.';
    else if (!/^\S+@\S+\.\S+$/.test(form.email)) errs.email = 'Enter a valid email address.';
    if (!editing) {
      if (!form.username.trim()) errs.username = 'Username is required.';
      if (!form.initialPassword || form.initialPassword.length < 8) errs.initialPassword = 'Minimum 8 characters.';
    }
    setFieldErrs(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setSaving(true); setFormErr('');
    try {
      const payload: Record<string, any> = { fullName: form.fullName.trim(), email: form.email.trim() };
      if (form.mobile) payload.mobile = form.mobile;
      if (form.employeeId) payload.employeeId = form.employeeId;
      if (form.designation) payload.designation = form.designation;
      if (form.roleKey) payload.roleKeys = [form.roleKey];
      if (!editing) {
        payload.username = form.username.trim();
        payload.password = form.initialPassword;
        if (form.organizationId) payload.organizationId = form.organizationId;
        await api.post('/users', payload);
      } else {
        await api.patch(`/users/${editing.id}`, payload);
      }
      close();
      list.reload();
    } catch (e: any) {
      setFormErr(e.message ?? 'Save failed');
    } finally { setSaving(false); }
  }

  async function toggleActive(row: any) {
    if (row.active && !window.confirm(`Deactivate user "${row.username}"? They will no longer be able to log in.`)) return;
    try { await api.patch(`/users/${row.id}/active`, { active: !row.active }); list.reload(); }
    catch (e: any) { alert(e.message ?? 'Failed'); }
  }

  const [resetting, setResetting] = useState<any | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetErr, setResetErr] = useState('');
  const [resetSaving, setResetSaving] = useState(false);
  function openReset(row: any) { setResetting(row); setResetPassword(''); setResetErr(''); }
  function closeReset() { setResetting(null); }
  async function submitReset() {
    if (resetPassword.length < 8) { setResetErr('Minimum 8 characters.'); return; }
    setResetSaving(true); setResetErr('');
    try {
      await api.post(`/users/${resetting.id}/reset-password`, { newPassword: resetPassword });
      closeReset();
    } catch (e: any) { setResetErr(e.message ?? 'Failed to reset password'); }
    finally { setResetSaving(false); }
  }

  return (
    <div>
      <div className="page-head">
        <div className="adm-head-row">
          <div>
            <h1>Users</h1>
            <p>Manage system accounts, roles and access.</p>
          </div>
          <div className="adm-head-meta">
            {!list.loading && <span>{list.meta.total} users</span>}
            {list.loading && <span>Loading…</span>}
            <button className="btn sm" onClick={list.reload} disabled={list.loading}>{list.loading ? 'Refreshing…' : 'Refresh'}</button>
            {canManage && <button className="btn sm primary" onClick={openCreate}>+ New User</button>}
          </div>
        </div>
      </div>

      {list.error && <div className="error">{list.error}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="toolbar">
          <input placeholder="Search by username, name or email…" style={{ maxWidth: 360 }}
            value={list.search} onChange={(e) => { list.setPage(1); list.setSearch(e.target.value); }} />
        </div>
      </div>

      <div className="card adm-table-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Username</th><th>Full Name</th><th>Email</th><th>Roles</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {list.loading && <tr><td colSpan={6} className="muted">Loading…</td></tr>}
              {!list.loading && list.rows.length === 0 && <tr><td colSpan={6} className="muted">No users found.</td></tr>}
              {!list.loading && list.rows.map((u: any) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.fullName}</td>
                  <td>{u.email}</td>
                  <td>{(u.roles ?? []).map((x: any) => x.role.name).join(', ') || '—'}</td>
                  <td><span className={`badge ${u.active ? 'ok' : 'off'}`}>{u.active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="row-actions">
                      {canManage && <button className="btn sm" onClick={() => openEdit(u)}>Edit</button>}
                      {canManage && <button className="btn sm" onClick={() => toggleActive(u)}>{u.active ? 'Deactivate' : 'Activate'}</button>}
                      {canManage && <button className="btn sm" onClick={() => openReset(u)}>Reset Password</button>}
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
        {!list.loading && list.rows.length === 0 && <div className="card muted" style={{ padding: 16 }}>No users found.</div>}
        {!list.loading && list.rows.map((u: any) => (
          <div className="adm-card" key={u.id}>
            <div className="adm-card-top">
              <div><strong>{u.fullName}</strong><div className="muted" style={{ fontSize: 12 }}>{u.username}</div></div>
              <span className={`badge ${u.active ? 'ok' : 'off'}`}>{u.active ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="adm-card-row"><span>Email</span><span>{u.email}</span></div>
            <div className="adm-card-row"><span>Roles</span><span>{(u.roles ?? []).map((x: any) => x.role.name).join(', ') || '—'}</span></div>
            {canManage && (
              <div className="adm-card-actions">
                <button className="btn sm" onClick={() => openEdit(u)}>Edit</button>
                <button className="btn sm" onClick={() => toggleActive(u)}>{u.active ? 'Deactivate' : 'Activate'}</button>
                <button className="btn sm" onClick={() => openReset(u)}>Reset Password</button>
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
            <div className="page-head"><h1 style={{ fontSize: 17 }}>{creating ? 'New User' : 'Edit User'}</h1>
              <button className="btn sm" onClick={close}>✕</button></div>
            {formErr && <div className="error">{formErr}</div>}

            <div className="adm-form-group">
              <div className="adm-form-grid">
                <div>
                  <label>Username{creating && <span className="adm-required">*</span>}</label>
                  <input value={form.username} disabled={!creating} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                  {fieldErrs.username && <div className="adm-field-error">{fieldErrs.username}</div>}
                </div>
                <div>
                  <label>Full Name<span className="adm-required">*</span></label>
                  <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
                  {fieldErrs.fullName && <div className="adm-field-error">{fieldErrs.fullName}</div>}
                </div>
              </div>
              <div className="adm-form-grid" style={{ marginTop: 10 }}>
                <div>
                  <label>Email<span className="adm-required">*</span></label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  {fieldErrs.email && <div className="adm-field-error">{fieldErrs.email}</div>}
                </div>
                {creating && (
                  <div>
                    <label>Organization</label>
                    <select value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })}>
                      <option value="">— select —</option>
                      {orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
              {creating && (
                <div className="adm-form-grid" style={{ marginTop: 10 }}>
                  <div>
                    <label>Initial Password<span className="adm-required">*</span></label>
                    <input type="password" value={form.initialPassword} onChange={(e) => setForm({ ...form, initialPassword: e.target.value })} />
                    <div className="muted" style={{ fontSize: 11 }}>Minimum 8 characters. Share with the new user directly.</div>
                    {fieldErrs.initialPassword && <div className="adm-field-error">{fieldErrs.initialPassword}</div>}
                  </div>
                </div>
              )}
              {!creating && (
                <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Username is not editable after creation.
                </div>
              )}
            </div>

            <div className="adm-form-group">
              <div className="adm-form-grid">
                <div><label>Mobile</label><input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
                <div><label>Employee ID</label><input value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} /></div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label>Designation</label>
                <input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
              </div>
              <div style={{ marginTop: 10 }}>
                <label>Role</label>
                <select value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
                  <option value="">— select —</option>
                  {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  A user can hold multiple roles via the API; this form assigns one role at a time.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button className="btn" onClick={close}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {resetting && (
        <div className="modal-bg" onClick={closeReset}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="page-head"><h1 style={{ fontSize: 17 }}>Reset Password — {resetting.username}</h1>
              <button className="btn sm" onClick={closeReset}>✕</button></div>
            {resetErr && <div className="error">{resetErr}</div>}
            <div className="adm-form-group">
              <label>New Password<span className="adm-required">*</span></label>
              <input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} autoFocus />
              <div className="muted" style={{ fontSize: 11 }}>Minimum 8 characters. Share with the user directly.</div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button className="btn primary" onClick={submitReset} disabled={resetSaving || resetPassword.length < 8}>
                {resetSaving ? 'Saving…' : 'Reset Password'}
              </button>
              <button className="btn" onClick={closeReset}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

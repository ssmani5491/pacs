import React, { useEffect, useState } from 'react';
import { api, qs } from '../../lib/api';
import { useList } from '../../components/useList';
import { useAuth } from '../../lib/auth';

const MODALITY_TYPES = ['CT', 'MR', 'CR', 'DX', 'US', 'MG', 'NM', 'PT', 'XA', 'OT'];

interface ModalityForm {
  name: string; aeTitle: string; host: string; port: string; modalityType: string; organizationId: string;
}
const EMPTY_FORM: ModalityForm = { name: '', aeTitle: '', host: '', port: '', modalityType: '', organizationId: '' };

// NOTE: Modality fields are standard DICOM and remain FLEXIBLE pending the
// New Modality screenshot.
export function Modalities() {
  const { can } = useAuth();
  const canManage = can('modality.manage');
  const list = useList<any>('/modalities');

  const [orgs, setOrgs] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    api.get('/organizations' + qs({ pageSize: 200 }))
      .then((r) => setOrgs(r.data.map((o: any) => ({ value: o.id, label: `${o.code} — ${o.name}` })))).catch(() => {});
  }, []);

  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ModalityForm>(EMPTY_FORM);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  function openCreate() { setForm(EMPTY_FORM); setFieldErrs({}); setFormErr(''); setCreating(true); setEditing(null); }
  function openEdit(row: any) {
    setForm({
      name: row.name, aeTitle: row.aeTitle, host: row.host, port: String(row.port ?? ''),
      modalityType: row.modalityType, organizationId: row.organizationId ?? '',
    });
    setFieldErrs({}); setFormErr(''); setEditing(row); setCreating(false);
  }
  function close() { setCreating(false); setEditing(null); }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Device name is required.';
    if (!form.aeTitle.trim()) errs.aeTitle = 'AE Title is required.';
    else if (form.aeTitle.length > 16) errs.aeTitle = 'AE Title must be 16 characters or fewer.';
    if (!form.host.trim()) errs.host = 'Host / IP is required.';
    const portNum = Number(form.port);
    if (!form.port || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) errs.port = 'Port must be between 1 and 65535.';
    if (!form.modalityType) errs.modalityType = 'Modality type is required.';
    setFieldErrs(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setSaving(true); setFormErr('');
    try {
      const payload: Record<string, any> = {
        name: form.name.trim(), aeTitle: form.aeTitle.trim(), host: form.host.trim(),
        port: Number(form.port), modalityType: form.modalityType,
      };
      if (!editing && form.organizationId) payload.organizationId = form.organizationId;
      if (editing) await api.patch(`/modalities/${editing.id}`, payload);
      else await api.post('/modalities', payload);
      close();
      list.reload();
    } catch (e: any) {
      setFormErr(e.message ?? 'Save failed');
    } finally { setSaving(false); }
  }

  async function toggleActive(row: any) {
    if (row.active && !window.confirm(`Deactivate modality "${row.name}"?`)) return;
    try { await api.patch(`/modalities/${row.id}/active`, { active: !row.active }); list.reload(); }
    catch (e: any) { alert(e.message ?? 'Failed'); }
  }

  async function testConnection(row: any) {
    setTestingId(row.id);
    try {
      const res = await api.post(`/modalities/${row.id}/test-connection`, {});
      alert(res?.ok ? `Connection to ${row.name} succeeded.` : `Connection to ${row.name} failed: ${res?.message ?? 'unreachable'}`);
    } catch (e: any) {
      alert(`Connection test failed: ${e.message}`);
    } finally { setTestingId(null); }
  }

  return (
    <div>
      <div className="page-head">
        <div className="adm-head-row">
          <div>
            <h1>Modalities</h1>
            <p>Manage imaging device connections and DICOM settings.</p>
          </div>
          <div className="adm-head-meta">
            {!list.loading && <span>{list.meta.total} modalities</span>}
            {list.loading && <span>Loading…</span>}
            <button className="btn sm" onClick={list.reload} disabled={list.loading}>{list.loading ? 'Refreshing…' : 'Refresh'}</button>
            {canManage && <button className="btn sm primary" onClick={openCreate}>+ New Modality</button>}
          </div>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        Field set is standard DICOM and flexible — pending the New Modality screenshot. Test Connection is a TCP probe; DICOM C-ECHO arrives in Phase 4.
      </div>

      {list.error && <div className="error">{list.error}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="toolbar">
          <input placeholder="Search by name, AE title or host…" style={{ maxWidth: 360 }}
            value={list.search} onChange={(e) => { list.setPage(1); list.setSearch(e.target.value); }} />
        </div>
      </div>

      <div className="card adm-table-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Name</th><th>AE Title</th><th>Host</th><th>Port</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {list.loading && <tr><td colSpan={7} className="muted">Loading…</td></tr>}
              {!list.loading && list.rows.length === 0 && <tr><td colSpan={7} className="muted">No modalities found.</td></tr>}
              {!list.loading && list.rows.map((m: any) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.aeTitle}</td>
                  <td>{m.host}</td>
                  <td>{m.port}</td>
                  <td>{m.modalityType}</td>
                  <td><span className={`badge ${m.active ? 'ok' : 'off'}`}>{m.active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="row-actions">
                      {canManage && <button className="btn sm" onClick={() => openEdit(m)}>Edit</button>}
                      {canManage && <button className="btn sm" onClick={() => toggleActive(m)}>{m.active ? 'Deactivate' : 'Activate'}</button>}
                      {canManage && <button className="btn sm" disabled={testingId === m.id} onClick={() => testConnection(m)}>
                        {testingId === m.id ? 'Testing…' : 'Test Connection'}
                      </button>}
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
        {!list.loading && list.rows.length === 0 && <div className="card muted" style={{ padding: 16 }}>No modalities found.</div>}
        {!list.loading && list.rows.map((m: any) => (
          <div className="adm-card" key={m.id}>
            <div className="adm-card-top">
              <div><strong>{m.name}</strong><div className="muted" style={{ fontSize: 12 }}>{m.aeTitle}</div></div>
              <span className={`badge ${m.active ? 'ok' : 'off'}`}>{m.active ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="adm-card-row"><span>Host</span><span>{m.host}:{m.port}</span></div>
            <div className="adm-card-row"><span>Type</span><span>{m.modalityType}</span></div>
            {canManage && (
              <div className="adm-card-actions">
                <button className="btn sm" onClick={() => openEdit(m)}>Edit</button>
                <button className="btn sm" onClick={() => toggleActive(m)}>{m.active ? 'Deactivate' : 'Activate'}</button>
                <button className="btn sm" disabled={testingId === m.id} onClick={() => testConnection(m)}>
                  {testingId === m.id ? 'Testing…' : 'Test Connection'}
                </button>
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
            <div className="page-head"><h1 style={{ fontSize: 17 }}>{creating ? 'New Modality' : 'Edit Modality'}</h1>
              <button className="btn sm" onClick={close}>✕</button></div>
            {formErr && <div className="error">{formErr}</div>}

            <div className="adm-form-group">
              <div className="adm-form-grid">
                <div>
                  <label>Device Name<span className="adm-required">*</span></label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  {fieldErrs.name && <div className="adm-field-error">{fieldErrs.name}</div>}
                </div>
                <div>
                  <label>AE Title<span className="adm-required">*</span></label>
                  <input value={form.aeTitle} onChange={(e) => setForm({ ...form, aeTitle: e.target.value })} />
                  <div className="muted" style={{ fontSize: 11 }}>DICOM Application Entity title (≤16 chars)</div>
                  {fieldErrs.aeTitle && <div className="adm-field-error">{fieldErrs.aeTitle}</div>}
                </div>
              </div>
              <div className="adm-form-grid" style={{ marginTop: 10 }}>
                <div>
                  <label>Host / IP<span className="adm-required">*</span></label>
                  <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
                  {fieldErrs.host && <div className="adm-field-error">{fieldErrs.host}</div>}
                </div>
                <div>
                  <label>Port<span className="adm-required">*</span></label>
                  <input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
                  {fieldErrs.port && <div className="adm-field-error">{fieldErrs.port}</div>}
                </div>
              </div>
              <div className="adm-form-grid" style={{ marginTop: 10 }}>
                <div>
                  <label>Modality Type<span className="adm-required">*</span></label>
                  <select value={form.modalityType} onChange={(e) => setForm({ ...form, modalityType: e.target.value })}>
                    <option value="">— select —</option>
                    {MODALITY_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  {fieldErrs.modalityType && <div className="adm-field-error">{fieldErrs.modalityType}</div>}
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

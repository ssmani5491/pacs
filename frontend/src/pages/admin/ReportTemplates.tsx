import React, { useEffect, useState } from 'react';
import { api, qs } from '../../lib/api';
import { useList } from '../../components/useList';
import { useAuth } from '../../lib/auth';

const MODALITY_TYPES = ['CT', 'MR', 'CR', 'DX', 'US', 'MG', 'NM', 'PT', 'XA', 'OT'];

interface TplForm {
  name: string; code: string; modalityType: string; organizationId: string;
  technique: string; bodyFindings: string; bodyImpression: string; bodyRecommendations: string;
}
const EMPTY_FORM: TplForm = {
  name: '', code: '', modalityType: '', organizationId: '', technique: '', bodyFindings: '', bodyImpression: '', bodyRecommendations: '',
};

/** Report template administration (Phase 7, Module 3; redesigned Phase 6E). template.manage required to mutate. */
export function ReportTemplates() {
  const { can } = useAuth();
  const canManage = can('template.manage');
  const list = useList<any>('/report-templates');

  const [orgs, setOrgs] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    api.get('/organizations' + qs({ pageSize: 200 }))
      .then((r) => setOrgs([{ value: '', label: '— Global (all orgs) —' }, ...r.data.map((o: any) => ({ value: o.id, label: `${o.code} — ${o.name}` }))]))
      .catch(() => {});
  }, []);

  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<TplForm>(EMPTY_FORM);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);

  function openCreate() { setForm(EMPTY_FORM); setFieldErrs({}); setFormErr(''); setCreating(true); setEditing(null); }
  function openEdit(row: any) {
    setForm({
      name: row.name, code: row.code ?? '', modalityType: row.modalityType ?? '', organizationId: row.organizationId ?? '',
      technique: row.technique ?? '', bodyFindings: row.bodyFindings ?? '', bodyImpression: row.bodyImpression ?? '', bodyRecommendations: row.bodyRecommendations ?? '',
    });
    setFieldErrs({}); setFormErr(''); setEditing(row); setCreating(false);
  }
  function close() { setCreating(false); setEditing(null); }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Template name is required.';
    setFieldErrs(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setSaving(true); setFormErr('');
    try {
      const payload: Record<string, any> = {
        name: form.name.trim(), code: form.code || undefined, modalityType: form.modalityType || undefined,
        technique: form.technique || undefined, bodyFindings: form.bodyFindings || undefined,
        bodyImpression: form.bodyImpression || undefined, bodyRecommendations: form.bodyRecommendations || undefined,
      };
      if (!editing && form.organizationId) payload.organizationId = form.organizationId;
      if (editing) await api.patch(`/report-templates/${editing.id}`, payload);
      else await api.post('/report-templates', payload);
      close();
      list.reload();
    } catch (e: any) {
      setFormErr(e.message ?? 'Save failed');
    } finally { setSaving(false); }
  }

  async function toggleActive(row: any) {
    if (row.active && !window.confirm(`Deactivate template "${row.name}"?`)) return;
    try { await api.patch(`/report-templates/${row.id}/active`, { active: !row.active }); list.reload(); }
    catch (e: any) { alert(e.message ?? 'Failed'); }
  }

  return (
    <div>
      <div className="page-head">
        <div className="adm-head-row">
          <div>
            <h1>Report Templates</h1>
            <p>Default Technique / Findings / Impression / Recommendations text for new reports.</p>
          </div>
          <div className="adm-head-meta">
            {!list.loading && <span>{list.meta.total} templates</span>}
            {list.loading && <span>Loading…</span>}
            <button className="btn sm" onClick={list.reload} disabled={list.loading}>{list.loading ? 'Refreshing…' : 'Refresh'}</button>
            {canManage && <button className="btn sm primary" onClick={openCreate}>+ New Template</button>}
          </div>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        Templates seed a new report's Technique / Findings / Impression / Recommendations. Global templates (no org) are visible to all organizations.
      </div>

      {list.error && <div className="error">{list.error}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="toolbar">
          <input placeholder="Search by name or code…" style={{ maxWidth: 360 }}
            value={list.search} onChange={(e) => { list.setPage(1); list.setSearch(e.target.value); }} />
        </div>
      </div>

      <div className="card adm-table-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Name</th><th>Code</th><th>Modality</th><th>Active</th>{canManage && <th>Actions</th>}</tr></thead>
            <tbody>
              {list.loading && <tr><td colSpan={5} className="muted">Loading…</td></tr>}
              {!list.loading && list.rows.length === 0 && <tr><td colSpan={5} className="muted">No templates found.</td></tr>}
              {!list.loading && list.rows.map((t: any) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.code ?? '—'}</td>
                  <td>{t.modalityType ?? '—'}</td>
                  <td>{t.active ? '✓' : '—'}</td>
                  {canManage && (
                    <td>
                      <div className="row-actions">
                        <button className="btn sm" onClick={() => openEdit(t)}>Edit</button>
                        <button className="btn sm" onClick={() => toggleActive(t)}>{t.active ? 'Deactivate' : 'Activate'}</button>
                      </div>
                    </td>
                  )}
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
        {!list.loading && list.rows.length === 0 && <div className="card muted" style={{ padding: 16 }}>No templates found.</div>}
        {!list.loading && list.rows.map((t: any) => (
          <div className="adm-card" key={t.id}>
            <div className="adm-card-top">
              <div><strong>{t.name}</strong><div className="muted" style={{ fontSize: 12 }}>{t.code ?? '—'}</div></div>
              <span className={`badge ${t.active ? 'ok' : 'off'}`}>{t.active ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="adm-card-row"><span>Modality</span><span>{t.modalityType ?? '—'}</span></div>
            {canManage && (
              <div className="adm-card-actions">
                <button className="btn sm" onClick={() => openEdit(t)}>Edit</button>
                <button className="btn sm" onClick={() => toggleActive(t)}>{t.active ? 'Deactivate' : 'Activate'}</button>
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

      {canManage && (creating || editing) && (
        <div className="modal-bg" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="page-head"><h1 style={{ fontSize: 17 }}>{creating ? 'New Report Template' : 'Edit Report Template'}</h1>
              <button className="btn sm" onClick={close}>✕</button></div>
            {formErr && <div className="error">{formErr}</div>}

            <div className="adm-form-group">
              <div className="adm-form-grid">
                <div>
                  <label>Template Name<span className="adm-required">*</span></label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  {fieldErrs.name && <div className="adm-field-error">{fieldErrs.name}</div>}
                </div>
                <div>
                  <label>Template Code</label>
                  <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                  <div className="muted" style={{ fontSize: 11 }}>Short code, e.g. CT-CHEST</div>
                </div>
              </div>
              <div className="adm-form-grid" style={{ marginTop: 10 }}>
                <div>
                  <label>Modality</label>
                  <select value={form.modalityType} onChange={(e) => setForm({ ...form, modalityType: e.target.value })}>
                    <option value="">— any —</option>
                    {MODALITY_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                {creating && (
                  <div>
                    <label>Organization</label>
                    <select value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })}>
                      {orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="adm-form-group">
              <label>Technique (default)</label>
              <textarea rows={3} value={form.technique} onChange={(e) => setForm({ ...form, technique: e.target.value })} />
            </div>
            <div className="adm-form-group">
              <label>Findings (default)</label>
              <textarea rows={6} value={form.bodyFindings} onChange={(e) => setForm({ ...form, bodyFindings: e.target.value })} />
            </div>
            <div className="adm-form-group">
              <label>Impression (default)</label>
              <textarea rows={4} value={form.bodyImpression} onChange={(e) => setForm({ ...form, bodyImpression: e.target.value })} />
            </div>
            <div className="adm-form-group">
              <label>Recommendations (default)</label>
              <textarea rows={3} value={form.bodyRecommendations} onChange={(e) => setForm({ ...form, bodyRecommendations: e.target.value })} />
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

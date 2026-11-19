import React, { useState } from 'react';
import { api } from '../lib/api';
import { useList } from './useList';
import { DataTable, Column, Modal } from './DataTable';

export interface Field {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'password' | 'select' | 'checkbox' | 'email' | 'textarea';
  required?: boolean;
  options?: { value: string; label: string }[];
  createOnly?: boolean;  // only shown/sent on create
  help?: string;
}

interface Props {
  title: string;
  endpoint: string;            // e.g. /organizations
  columns: Column<any>[];
  fields: Field[];
  extraParams?: Record<string, any>;
  canCreate?: boolean;
  // map a row to the edit form's initial values
  toForm?: (row: any) => Record<string, any>;
  // transform the assembled payload before sending (e.g. roleKey -> roleKeys[])
  beforeSubmit?: (payload: Record<string, any>, form: Record<string, any>) => Record<string, any>;
  // extra note under the title (e.g. "fields pending screenshot")
  note?: string;
  // status model: 'active' (boolean via /:id/active) | 'status' (ACTIVE/INACTIVE via /:id/status) | 'none'
  statusMode?: 'active' | 'status' | 'none';
}

export function CrudPage(p: Props) {
  const list = useList<any>(p.endpoint, p.extraParams ?? {});
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);

  function openCreate() {
    const init: Record<string, any> = {};
    p.fields.forEach((f) => { init[f.name] = f.type === 'checkbox' ? false : ''; });
    setForm(init); setCreating(true); setEditing(null); setFormErr('');
  }
  function openEdit(row: any) {
    setForm(p.toForm ? p.toForm(row) : { ...row });
    setEditing(row); setCreating(false); setFormErr('');
  }
  function close() { setCreating(false); setEditing(null); }

  async function save() {
    setSaving(true); setFormErr('');
    try {
      const payload: Record<string, any> = {};
      for (const f of p.fields) {
        if (editing && f.createOnly) continue;
        let v = form[f.name];
        if (v === '' || v === undefined) { if (f.required && !editing) { /* let server validate */ } continue; }
        if (f.type === 'number') v = Number(v);
        payload[f.name] = v;
      }
      const finalPayload = p.beforeSubmit ? p.beforeSubmit(payload, form) : payload;
      if (editing) await api.patch(`${p.endpoint}/${editing.id}`, finalPayload);
      else await api.post(p.endpoint, finalPayload);
      close();
      list.reload();
    } catch (e: any) {
      setFormErr(e.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const mode = p.statusMode ?? 'active';
  const isActive = (r: any) => mode === 'status' ? r.status === 'ACTIVE' : !!r.active;

  async function toggleActive(row: any) {
    try {
      if (mode === 'status') {
        const next = row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
        await api.patch(`${p.endpoint}/${row.id}/status`, { status: next });
      } else {
        await api.patch(`${p.endpoint}/${row.id}/active`, { active: !row.active });
      }
      list.reload();
    } catch (e: any) {
      alert(e.message ?? 'Failed');
    }
  }

  const statusCol: Column<any>[] = mode === 'none' ? [] : [{
    key: '_status', label: 'Status',
    render: (r) => <span className={`badge ${isActive(r) ? 'ok' : 'off'}`}>{isActive(r) ? 'Active' : 'Inactive'}</span>,
  }];

  const columns: Column<any>[] = [
    ...p.columns,
    ...statusCol,
    {
      key: '_actions', label: 'Actions',
      render: (r) => (
        <div className="row-actions">
          <button className="btn sm" onClick={() => openEdit(r)}>Edit</button>
          {mode !== 'none' && (
            <button className="btn sm" onClick={() => toggleActive(r)}>{isActive(r) ? 'Deactivate' : 'Activate'}</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{p.title}</h1>
          {p.note && <div className="muted" style={{ fontSize: 12 }}>{p.note}</div>}
        </div>
        {p.canCreate !== false && <button className="btn primary" onClick={openCreate}>+ New</button>}
      </div>
      {list.error && <div className="error">{list.error}</div>}
      <div className="card">
        <div className="toolbar">
          <input placeholder="Search…" value={list.search}
            onChange={(e) => { list.setPage(1); list.setSearch(e.target.value); }} />
        </div>
        <DataTable
          columns={columns} rows={list.rows} loading={list.loading}
          total={list.meta.total} page={list.meta.page} pageSize={list.meta.pageSize}
          totalPages={list.meta.totalPages} sortBy={list.sortBy} sortDir={list.sortDir}
          onSort={list.onSort} onPage={list.setPage}
        />
      </div>

      {(creating || editing) && (
        <Modal title={creating ? `New ${p.title}` : `Edit ${p.title}`} onClose={close}>
          {formErr && <div className="error">{formErr}</div>}
          {p.fields.filter((f) => !(editing && f.createOnly)).map((f) => (
            <div key={f.name}>
              <label>{f.label}{f.required && !editing ? ' *' : ''}</label>
              {f.type === 'select' ? (
                <select value={form[f.name] ?? ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}>
                  <option value="">— select —</option>
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'checkbox' ? (
                <input type="checkbox" style={{ width: 'auto' }} checked={!!form[f.name]}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.checked })} />
              ) : f.type === 'textarea' ? (
                <textarea rows={3} value={form[f.name] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />
              ) : (
                <input type={f.type ?? 'text'} value={form[f.name] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />
              )}
              {f.help && <div className="muted" style={{ fontSize: 11 }}>{f.help}</div>}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn" onClick={close}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

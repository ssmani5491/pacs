import React, { useEffect, useState } from 'react';
import { api, qs } from '../lib/api';
import { useList } from '../components/useList';
import { useAuth } from '../lib/auth';

const MODALITIES = ['CT', 'MR', 'CR', 'DX', 'US', 'MG', 'NM', 'PT', 'XA'];
const PRIORITIES = [{ value: 'ROUTINE', label: 'Routine' }, { value: 'URGENT', label: 'Urgent' }, { value: 'STAT', label: 'STAT' }];

interface OrderForm {
  patientId: string; modalityType: string; procedureDesc: string; studyDescription: string;
  priority: string; clinicalHistory: string; scheduledAt: string;
}
const EMPTY_FORM: OrderForm = {
  patientId: '', modalityType: '', procedureDesc: '', studyDescription: '', priority: 'ROUTINE', clinicalHistory: '', scheduledAt: '',
};

export function Orders() {
  const { can } = useAuth();
  const canManage = can('order.manage');
  const list = useList<any>('/orders');

  const [patients, setPatients] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    api.get('/patients' + qs({ pageSize: 100, sortBy: 'registrationDate', sortDir: 'desc' }))
      .then((r) => setPatients(r.data.map((p: any) => ({ value: p.id, label: `${p.mrn} — ${p.name}` }))))
      .catch(() => setPatients([]));
  }, []);

  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<OrderForm>(EMPTY_FORM);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);

  function openCreate() { setForm(EMPTY_FORM); setFieldErrs({}); setFormErr(''); setCreating(true); setEditing(null); }
  function openEdit(row: any) {
    setForm({
      patientId: row.patientId, modalityType: row.modalityType, procedureDesc: row.procedureDesc,
      studyDescription: row.studyDescription ?? '', priority: row.priority ?? 'ROUTINE',
      clinicalHistory: row.clinicalHistory ?? '', scheduledAt: row.scheduledAt?.slice(0, 16) ?? '',
    });
    setFieldErrs({}); setFormErr(''); setEditing(row); setCreating(false);
  }
  function close() { setCreating(false); setEditing(null); }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!editing && !form.patientId) errs.patientId = 'Patient is required.';
    if (!form.modalityType) errs.modalityType = 'Modality is required.';
    if (!form.procedureDesc.trim()) errs.procedureDesc = 'Procedure is required.';
    if (!form.scheduledAt) errs.scheduledAt = 'Scheduled date/time is required.';
    setFieldErrs(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setSaving(true); setFormErr('');
    try {
      const payload: Record<string, any> = {
        modalityType: form.modalityType, procedureDesc: form.procedureDesc.trim(),
        studyDescription: form.studyDescription || undefined, priority: form.priority,
        clinicalHistory: form.clinicalHistory || undefined,
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined,
      };
      if (editing) {
        await api.patch(`/orders/${editing.id}`, payload);
      } else {
        payload.patientId = form.patientId;
        await api.post('/orders', payload);
      }
      close();
      list.reload();
    } catch (e: any) {
      setFormErr(e.message ?? 'Save failed');
    } finally { setSaving(false); }
  }

  async function cancelOrder(row: any) {
    if (!window.confirm(`Cancel order ${row.accessionNumber}? This cannot be undone.`)) return;
    try { await api.patch(`/orders/${row.id}/cancel`); list.reload(); }
    catch (e: any) { alert(e.message ?? 'Failed'); }
  }

  const fmtDateTime = (d?: string) => d ? new Date(d).toLocaleString() : '—';

  return (
    <div>
      <div className="page-head">
        <div className="adm-head-row">
          <div>
            <h1>Examination Orders</h1>
            <p>Schedule and manage radiology examination orders.</p>
          </div>
          <div className="adm-head-meta">
            {!list.loading && <span>{list.meta.total} orders</span>}
            {list.loading && <span>Loading…</span>}
            <button className="btn sm" onClick={list.reload} disabled={list.loading}>{list.loading ? 'Refreshing…' : 'Refresh'}</button>
            {canManage && <button className="btn sm primary" onClick={openCreate}>+ New Order</button>}
          </div>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Accession numbers are generated automatically and are unique.</div>

      {list.error && <div className="error">{list.error}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="toolbar">
          <input placeholder="Search by accession, procedure or patient…" style={{ maxWidth: 360 }}
            value={list.search} onChange={(e) => { list.setPage(1); list.setSearch(e.target.value); }} />
        </div>
      </div>

      <div className="card adm-table-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table className="ord-table">
            <thead><tr><th>Accession</th><th>Patient</th><th>Modality</th><th>Procedure</th><th>Priority</th><th>Order Status</th><th>Actions</th></tr></thead>
            <tbody>
              {list.loading && <tr><td colSpan={7} className="muted">Loading…</td></tr>}
              {!list.loading && list.rows.length === 0 && <tr><td colSpan={7} className="muted">No orders found.</td></tr>}
              {!list.loading && list.rows.map((o: any) => (
                <tr key={o.id}>
                  <td>{o.accessionNumber}</td>
                  <td>{o.patient ? `${o.patient.mrn} — ${o.patient.name}` : '—'}</td>
                  <td>{o.modalityType}</td>
                  <td>{o.procedureDesc}</td>
                  <td>{o.priority}</td>
                  <td><span className="badge status-neutral">{o.status}</span></td>
                  <td>
                    <div className="row-actions">
                      {canManage && o.status !== 'CANCELLED' && <button className="btn sm" onClick={() => openEdit(o)}>Edit</button>}
                      {canManage && !['CANCELLED', 'COMPLETED'].includes(o.status) && <button className="btn sm" onClick={() => cancelOrder(o)}>Cancel</button>}
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
        {!list.loading && list.rows.length === 0 && <div className="card muted" style={{ padding: 16 }}>No orders found.</div>}
        {!list.loading && list.rows.map((o: any) => (
          <div className="adm-card" key={o.id}>
            <div className="adm-card-top">
              <div><strong>{o.accessionNumber}</strong><div className="muted" style={{ fontSize: 12 }}>{o.patient ? `${o.patient.mrn} — ${o.patient.name}` : '—'}</div></div>
              <span className="badge status-neutral">{o.status}</span>
            </div>
            <div className="adm-card-row"><span>Modality</span><span>{o.modalityType}</span></div>
            <div className="adm-card-row"><span>Procedure</span><span>{o.procedureDesc}</span></div>
            <div className="adm-card-row"><span>Priority</span><span>{o.priority}</span></div>
            {canManage && (
              <div className="adm-card-actions">
                {o.status !== 'CANCELLED' && <button className="btn sm" onClick={() => openEdit(o)}>Edit</button>}
                {!['CANCELLED', 'COMPLETED'].includes(o.status) && <button className="btn sm" onClick={() => cancelOrder(o)}>Cancel</button>}
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
            <div className="page-head"><h1 style={{ fontSize: 17 }}>{creating ? 'New Examination Order' : 'Edit Examination Order'}</h1>
              <button className="btn sm" onClick={close}>✕</button></div>
            {formErr && <div className="error">{formErr}</div>}

            <div className="adm-form-group">
              {creating && (
                <div>
                  <label>Patient<span className="adm-required">*</span></label>
                  <select value={form.patientId} onChange={(e) => setForm({ ...form, patientId: e.target.value })}>
                    <option value="">— select —</option>
                    {patients.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  {fieldErrs.patientId && <div className="adm-field-error">{fieldErrs.patientId}</div>}
                </div>
              )}
              <div className="adm-form-grid" style={{ marginTop: 10 }}>
                <div>
                  <label>Modality<span className="adm-required">*</span></label>
                  <select value={form.modalityType} onChange={(e) => setForm({ ...form, modalityType: e.target.value })}>
                    <option value="">— select —</option>
                    {MODALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  {fieldErrs.modalityType && <div className="adm-field-error">{fieldErrs.modalityType}</div>}
                </div>
                <div>
                  <label>Priority</label>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                    {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label>Procedure<span className="adm-required">*</span></label>
                <input value={form.procedureDesc} onChange={(e) => setForm({ ...form, procedureDesc: e.target.value })} />
                {fieldErrs.procedureDesc && <div className="adm-field-error">{fieldErrs.procedureDesc}</div>}
              </div>
              <div style={{ marginTop: 10 }}>
                <label>Study Description</label>
                <input value={form.studyDescription} onChange={(e) => setForm({ ...form, studyDescription: e.target.value })} />
              </div>
              <div style={{ marginTop: 10 }}>
                <label>Clinical History</label>
                <textarea rows={2} value={form.clinicalHistory} onChange={(e) => setForm({ ...form, clinicalHistory: e.target.value })} />
              </div>
              <div style={{ marginTop: 10 }}>
                <label>Scheduled Date/Time<span className="adm-required">*</span></label>
                <input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
                {fieldErrs.scheduledAt && <div className="adm-field-error">{fieldErrs.scheduledAt}</div>}
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

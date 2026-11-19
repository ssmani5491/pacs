import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api';

const CATEGORIES = ['', 'NEW_STUDY', 'STUDY_MATCHED', 'ORPHAN_STUDY', 'RECONCILIATION', 'REPORT_PRELIMINARY', 'REPORT_FINAL', 'REPORT_SIGNED', 'REPORT_ADDENDUM', 'EXAM_ASSIGNED', 'EXAM_CANCELLED', 'DICOM_FAILURE', 'SYSTEM_ALERT'];
const PRIORITIES = ['', 'LOW', 'NORMAL', 'HIGH', 'CRITICAL'];
const PR_CLASS: Record<string, string> = { LOW: 'off', NORMAL: 'ready', HIGH: 'prelim', CRITICAL: 'draft' };

export function NotificationCentre() {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [read, setRead] = useState('');      // '', 'true', 'false'
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const params = useCallback(() => ({
    page, pageSize: 20, archived: archived ? 'true' : 'false',
    read: read || undefined, category: category || undefined, priority: priority || undefined,
  }), [page, read, category, priority, archived]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await api.get('/notifications' + qs(params())); setRows(r.data); setMeta({ total: r.total, page: r.page, totalPages: r.totalPages }); }
    catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id: string) => { try { await api.patch(`/notifications/${id}/read`); load(); } catch (e: any) { setErr(e.message); } };
  const markAll = async () => { try { await api.patch('/notifications/read-all'); load(); } catch (e: any) { setErr(e.message); } };
  const archive = async (id: string) => { try { await api.patch(`/notifications/${id}/archive`); load(); } catch (e: any) { setErr(e.message); } };
  const open = async (n: any) => { if (!n.read) await markRead(n.id); if (n.link) nav(n.link); };

  return (
    <div>
      <div className="page-head"><h1>Notification Centre</h1>
        <button className="btn sm" onClick={markAll}>Mark all read</button>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="grid2">
          <div><label>Status</label>
            <select value={read} onChange={(e) => { setRead(e.target.value); setPage(1); }}>
              <option value="">All</option><option value="false">Unread</option><option value="true">Read</option>
            </select>
          </div>
          <div><label>Category</label>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c || 'All'}</option>)}
            </select>
          </div>
          <div><label>Priority</label>
            <select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p || 'All'}</option>)}
            </select>
          </div>
          <div><label>View</label>
            <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={archived} onChange={(e) => { setArchived(e.target.checked); setPage(1); }} /> Archived</label>
          </div>
        </div>
      </div>

      {err && <div className="error">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th></th><th>Priority</th><th>Category</th><th>Title</th><th>Received</th><th>Actions</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="muted">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6} className="muted">No notifications.</td></tr>}
            {!loading && rows.map((n) => (
              <tr key={n.id} style={{ fontWeight: n.read ? 400 : 600 }}>
                <td>{n.read ? '' : '●'}</td>
                <td><span className={`badge ${PR_CLASS[n.priority] ?? 'off'}`}>{n.priority}</span></td>
                <td>{n.category}</td>
                <td><a style={{ cursor: 'pointer' }} onClick={() => open(n)}>{n.title}</a>{n.body && <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{n.body}</div>}</td>
                <td>{new Date(n.createdAt).toLocaleString()}</td>
                <td>
                  <div className="row-actions">
                    {!n.read && <button className="btn sm" onClick={() => markRead(n.id)}>Read</button>}
                    {!n.archived && <button className="btn sm" onClick={() => archive(n.id)}>Archive</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pager">
          <span className="muted">{meta.total} total · page {meta.page}/{meta.totalPages}</span>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <button className="btn sm" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
